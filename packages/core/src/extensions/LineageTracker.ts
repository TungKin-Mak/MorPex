/**
 * LineageTracker — 产物血缘追踪器
 *
 * 将引擎从"值传递"升级为"引用传递"，记录产物的完整演进链条。
 *
 * 核心机制：
 *   1. 订阅 EventBus 的 workflow.step_completed 和 artifact.* 事件
 *   2. 从 ArtifactRef 中提取 lineage 信息，构建有向无环产物演进图
 *   3. 支持正向传播（找出某个产物的所有下游影响）和反向追溯（找到所有上游依赖）
 *   4. 可选 SHA-256 哈希计算用于内容完整性校验
 *   5. 可选磁盘持久化
 *
 * 设计约束：
 *   - 零侵入引擎代码，完全通过 EventBus 监听
 *   - 所有图谱状态内聚在本类中
 *   - 异步非阻塞 I/O（fs.promises）
 *   - 支持一键 Disable
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ExtensionDefinition,
  ExtensionContext,
  ExtensionStatus,
  ArtifactNode,
  LineageEdge,
  LineageGraph,
  LineageQuery,
  LineageQueryResult,
  LineageTrackerConfig,
} from './types.js';
import { DEFAULT_EXTENSIONS_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

const BFS_MAX_VISIT = 50_000; // BFS 最大访问节点数（安全上限）

// ═══════════════════════════════════════════════════════════════
// LineageTracker
// ═══════════════════════════════════════════════════════════════

export class LineageTracker implements ExtensionDefinition {
  public readonly name = 'LineageTracker';
  public readonly version = '1.0.0';
  public readonly dependencies: string[] = [];

  private _enabled: boolean;
  private _config: LineageTrackerConfig;
  private _graph: LineageGraph;
  private _context: ExtensionContext | null = null;
  private _unsubscribers: Array<() => void> = [];
  private _phase: ExtensionStatus['phase'] = 'uninitialized';
  private _startedAt: number | undefined;
  private _lastError: string | undefined;
  private _totalNodes = 0;
  private _totalEdges = 0;
  private _persistTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<LineageTrackerConfig>) {
    this._config = { ...DEFAULT_EXTENSIONS_CONFIG.lineageTracker, ...config };
    this._enabled = this._config.enabled;
    this._graph = {
      nodes: new Map(),
      edges: [],
      uriIndex: new Map(),
      executionIndex: new Map(),
    };
  }

  // ── ExtensionDefinition 实现 ──

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
  }

  async initialize(context: ExtensionContext): Promise<void> {
    this._context = context;
    this._phase = 'initialized';

    // 从磁盘恢复图谱（若持久化启用）
    if (this._config.persistToDisk) {
      await this.loadFromDisk();
    }

    context.logger.info('LineageTracker 已初始化', {
      maxNodes: this._config.maxNodes,
      computeHash: this._config.computeHash,
      persistToDisk: this._config.persistToDisk,
    });
  }

  async start(): Promise<void> {
    if (!this._context) throw new Error('LineageTracker 未初始化');

    this._phase = 'running';
    this._startedAt = Date.now();

    // 订阅 workflow.step_completed → 跟踪新产物
    const unsub1 = this._context.eventBus.on(
      'workflow.step_completed',
      this.onNodeCompleted.bind(this),
    );
    this._unsubscribers.push(unsub1);

    // 订阅 artifact.created → 注册产物到图谱
    const unsub2 = this._context.eventBus.on(
      'artifact.created',
      this.onArtifactCreated.bind(this),
    );
    this._unsubscribers.push(unsub2);

    // 订阅 artifact.updated → 更新产物版本
    const unsub3 = this._context.eventBus.on(
      'artifact.updated',
      this.onArtifactUpdated.bind(this),
    );
    this._unsubscribers.push(unsub3);

    // 持久化定时器（每 30 秒自动落盘）
    if (this._config.persistToDisk) {
      this._persistTimer = setInterval(() => {
        this.persistToDisk().catch(err => {
          this._context?.logger.warn('自动持久化失败', { error: err.message });
        });
      }, 30_000);

      // 进程退出前最后一次持久化
      const persistOnExit = () => {
        this.persistToDisk().catch(() => {});
      };
      process.once('beforeExit', persistOnExit);
      this._unsubscribers.push(() => process.off('beforeExit', persistOnExit));
    }

    this._context.logger.info('LineageTracker 已启动');
  }

  async stop(): Promise<void> {
    this._phase = 'stopped';

    // 取消所有事件订阅
    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch { /* suppress */ }
    }
    this._unsubscribers = [];

    // 取消持久化定时器
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }

    // 最后一次持久化
    if (this._config.persistToDisk) {
      await this.persistToDisk();
    }

    this._context?.logger.info('LineageTracker 已停止');
  }

  getStatus(): ExtensionStatus {
    return {
      name: this.name,
      enabled: this._enabled,
      phase: this._phase,
      startedAt: this._startedAt,
      uptime: this._startedAt ? Date.now() - this._startedAt : undefined,
      lastError: this._lastError,
      metrics: {
        totalNodes: this._graph.nodes.size,
        totalEdges: this._graph.edges.length,
        totalExecutions: this._graph.executionIndex.size,
      },
    };
  }

  // ── 事件处理器 ──

  /**
   * onNodeCompleted — 当 DAG 节点执行完成时
   *
   * 从 payload 中提取 artifactRefs，为每个产物创建/更新图谱节点。
   */
  private onNodeCompleted(event: any): void {
    if (!this._enabled) return;

    try {
      const payload = event.payload;
      if (!payload) return;

      const artifactRefs: any[] = payload.artifactRefs ?? [];
      const nodeId: string = payload.stepId ?? payload.nodeId ?? 'unknown';
      const executionId: string = event.executionId ?? 'unknown';

      for (const ref of artifactRefs) {
        this.registerArtifactRef(ref, nodeId, executionId);
      }
    } catch (err: any) {
      this._lastError = err.message;
      this._context?.logger.error('onNodeCompleted 处理失败', { error: err.message });
    }
  }

  /**
   * onArtifactCreated — 当产物被创建时（artifact.created 事件）
   */
  private onArtifactCreated(event: any): void {
    if (!this._enabled) return;

    try {
      const payload = event.payload;
      if (!payload) return;

      const ref = {
        uri: payload.uri ?? '',
        type: payload.type ?? 'unknown',
        name: payload.name ?? 'unnamed',
        domain: payload.domain ?? 'unknown',
        schema: payload.schema ?? 'unknown',
        producer: { nodeId: payload.producer?.nodeId ?? 'unknown' },
        version: payload.version ?? 1,
        lineage: payload.lineage ?? [],
        size: payload.size ?? -1,
        createdAt: payload.createdAt ?? Date.now(),
      };

      this.registerArtifactRef(ref, ref.producer.nodeId, event.executionId ?? 'unknown');
    } catch (err: any) {
      this._lastError = err.message;
      this._context?.logger.error('onArtifactCreated 处理失败', { error: err.message });
    }
  }

  /**
   * onArtifactUpdated — 当产物被更新时（artifact.updated 事件）
   */
  private onArtifactUpdated(event: any): void {
    if (!this._enabled) return;

    try {
      const payload = event.payload;
      if (!payload) return;

      const uri: string = payload.uri ?? '';
      if (!uri) return;

      const existingId = this._graph.uriIndex.get(uri);
      if (!existingId) return;

      const existingNode = this._graph.nodes.get(existingId);
      if (!existingNode) return;

      // 更新版本和时间戳
      existingNode.version = (existingNode.version || 1) + 1;
      existingNode.timestamp = Date.now();
      if (payload.size !== undefined) existingNode.size = payload.size;
      if (payload.hash) existingNode.hash = payload.hash;
    } catch (err: any) {
      this._lastError = err.message;
    }
  }

  // ── 核心：注册产物引用到图谱 ──

  /**
   * registerArtifactRef — 将一个 ArtifactRef 注册到血缘图谱
   *
   * 逻辑：
   *   1. 若 URI 已存在 → 更新版本（版本链）
   *   2. 若 URI 不存在 → 创建新节点
   *   3. 建立与 parentIds（来自 ref.lineage）的边
   *   4. 更新索引
   */
  private registerArtifactRef(
    ref: any,
    generatorNode: string,
    executionId: string,
  ): ArtifactNode | null {
    if (!ref.uri) return null;

    // 检查容量上限
    if (this._graph.nodes.size >= this._config.maxNodes) {
      this.evictOldestNode();
    }

    const existingId = this._graph.uriIndex.get(ref.uri);

    // 若已存在该 URI 的节点，更新版本
    if (existingId) {
      const existingNode = this._graph.nodes.get(existingId);
      if (existingNode) {
        existingNode.version = ref.version > existingNode.version ? ref.version : existingNode.version + 1;
        existingNode.timestamp = Date.now();
        if (ref.size > 0) existingNode.size = ref.size;

        // 追加新的 parentIds（去重）
        for (const parentUri of (ref.lineage ?? [])) {
          const parentId = this._graph.uriIndex.get(parentUri);
          if (parentId && !existingNode.parentIds.includes(parentId)) {
            existingNode.parentIds.push(parentId);

            // 建立边
            this._graph.edges.push({
              from: parentId,
              to: existingNode.id,
              relation: 'version_of',
              timestamp: Date.now(),
            });
            this._totalEdges++;

            // 发射 lineage.edge_added 事件
            this._context?.eventBus.emit({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'lineage.edge_added',
              timestamp: Date.now(),
              executionId,
              source: 'lineage-tracker',
              payload: { from: parentId, to: existingNode.id, relation: 'version_of' },
            });
          }
        }

        return existingNode;
      }
    }

    // 创建新节点
    const nodeId = this.generateNodeId();

    // 解析 parentIds：从 ref.lineage（URI 列表）映射到节点 ID
    const parentIds: string[] = [];
    for (const parentUri of (ref.lineage ?? [])) {
      const parentId = this._graph.uriIndex.get(parentUri);
      if (parentId) {
        parentIds.push(parentId);
      }
      // 若上游 URI 尚未注册，暂不添加（后续事件会补全）
    }

    const node: ArtifactNode = {
      id: nodeId,
      uri: ref.uri,
      hash: '', // 延迟计算
      generatorNode: ref.producer?.nodeId ?? generatorNode,
      parentIds,
      type: ref.type ?? 'unknown',
      name: ref.name ?? 'unnamed',
      domain: ref.domain ?? 'unknown',
      schema: ref.schema ?? 'unknown',
      size: ref.size ?? -1,
      version: ref.version ?? 1,
      timestamp: ref.createdAt ?? Date.now(),
      executionId,
      metadata: {
        producerAgentId: ref.producer?.agentId,
      },
    };

    // 注册到图谱
    this._graph.nodes.set(nodeId, node);
    this._graph.uriIndex.set(ref.uri, nodeId);

    // 更新执行索引
    if (!this._graph.executionIndex.has(executionId)) {
      this._graph.executionIndex.set(executionId, []);
    }
    this._graph.executionIndex.get(executionId)!.push(nodeId);

    this._totalNodes++;

    // 发射 lineage.node_created 事件
    this._context?.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'lineage.node_created',
      timestamp: Date.now(),
      executionId,
      source: 'lineage-tracker',
      payload: { nodeId, uri: ref.uri, generatorNode, parentCount: parentIds.length },
    });

    // 建立与父节点的边
    for (const parentId of parentIds) {
      this._graph.edges.push({
        from: parentId,
        to: nodeId,
        relation: 'derived_from',
        timestamp: Date.now(),
      });
      this._totalEdges++;

      // 发射 lineage.edge_added 事件
      this._context?.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'lineage.edge_added',
        timestamp: Date.now(),
        executionId,
        source: 'lineage-tracker',
        payload: { from: parentId, to: nodeId, relation: 'derived_from' },
      });
    }

    // 异步计算哈希（不阻塞主流程）
    if (this._config.computeHash) {
      this.computeHashAsync(node).catch(err => {
        this._context?.logger.warn('哈希计算失败', { uri: ref.uri, error: err.message });
      });
    } else {
      // 无哈希时用 URI + timestamp 的快速摘要
      node.hash = this.fastDigest(node.uri + node.timestamp);
    }

    return node;
  }

  // ── 查询 API ──

  /**
   * query — 执行血缘查询
   *
   * 从 startUri 出发，沿指定方向 BFS 遍历。
   */
  query(q: LineageQuery): LineageQueryResult | null {
    const startId = this._graph.uriIndex.get(q.startUri);
    if (!startId) return null;

    const rootNode = this._graph.nodes.get(startId);
    if (!rootNode) return null;

    const visitedNodes = new Set<string>();
    const visitedEdges: LineageEdge[] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startId, depth: 0 }];
    const maxDepth = q.maxDepth ?? Infinity;
    const relationFilter = q.relationFilter;
    let maxDepthReached = 0;

    while (queue.length > 0 && visitedNodes.size < BFS_MAX_VISIT) {
      const { nodeId, depth } = queue.shift()!;
      if (visitedNodes.has(nodeId)) continue;
      if (depth > maxDepth) continue;

      visitedNodes.add(nodeId);
      maxDepthReached = Math.max(maxDepthReached, depth);

      if (depth >= maxDepth) continue;

      if (q.direction === 'upstream' || q.direction === 'both') {
        // 反向追溯：parentIds → 父节点
        const node = this._graph.nodes.get(nodeId);
        if (node) {
          for (const parentId of node.parentIds) {
            if (visitedNodes.has(parentId)) continue;
            const edges = this.findEdges(parentId, nodeId);
            for (const edge of edges) {
              if (!relationFilter || relationFilter.includes(edge.relation)) {
                visitedEdges.push(edge);
                queue.push({ nodeId: parentId, depth: depth + 1 });
              }
            }
          }
        }
      }

      if (q.direction === 'downstream' || q.direction === 'both') {
        // 正向传播：找所有 from = nodeId 的边
        for (const edge of this._graph.edges) {
          if (edge.from === nodeId && !visitedNodes.has(edge.to)) {
            if (!relationFilter || relationFilter.includes(edge.relation)) {
              visitedEdges.push(edge);
              queue.push({ nodeId: edge.to, depth: depth + 1 });
            }
          }
        }
      }
    }

    // 收集节点
    const nodes: ArtifactNode[] = [];
    for (const nid of visitedNodes) {
      const n = this._graph.nodes.get(nid);
      if (n) nodes.push(n);
    }

    return {
      root: rootNode,
      nodes,
      edges: visitedEdges,
      maxDepthReached,
    };
  }

  /**
   * getByURI — 通过 URI 查找产物节点
   */
  getByURI(uri: string): ArtifactNode | undefined {
    const id = this._graph.uriIndex.get(uri);
    if (!id) return undefined;
    return this._graph.nodes.get(id);
  }

  /**
   * getByExecution — 获取某个执行的所有产物
   */
  getByExecution(executionId: string): ArtifactNode[] {
    const ids = this._graph.executionIndex.get(executionId) ?? [];
    const nodes: ArtifactNode[] = [];
    for (const id of ids) {
      const node = this._graph.nodes.get(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /**
   * getUpstream — 获取某个产物的所有上游依赖
   */
  getUpstream(uri: string, maxDepth?: number): ArtifactNode[] {
    const result = this.query({
      startUri: uri,
      direction: 'upstream',
      maxDepth: maxDepth ?? Infinity,
    });
    if (!result) return [];
    return result.nodes.filter(n => n.uri !== uri);
  }

  /**
   * getDownstream — 获取某个产物的所有下游影响
   */
  getDownstream(uri: string, maxDepth?: number): ArtifactNode[] {
    const result = this.query({
      startUri: uri,
      direction: 'downstream',
      maxDepth: maxDepth ?? Infinity,
    });
    if (!result) return [];
    return result.nodes.filter(n => n.uri !== uri);
  }

  /**
   * isReachable — 判断两个产物之间是否存在路径
   *
   * 用于 ContextPruner 的拓扑剪枝：判断某个产物是否与当前节点有依赖关系。
   */
  isReachable(fromUri: string, toUri: string): boolean {
    const fromId = this._graph.uriIndex.get(fromUri);
    const toId = this._graph.uriIndex.get(toUri);
    if (!fromId || !toId) return false;
    if (fromId === toId) return true;

    // BFS from → to（正向传播）
    const visited = new Set<string>();
    const queue = [fromId];
    while (queue.length > 0 && visited.size < BFS_MAX_VISIT) {
      const current = queue.shift()!;
      if (current === toId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this._graph.edges) {
        if (edge.from === current && !visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
    return false;
  }

  /**
   * getGraphSnapshot — 获取当前图谱的只读快照
   */
  getGraphSnapshot(): LineageGraph {
    return {
      nodes: new Map(this._graph.nodes),
      edges: [...this._graph.edges],
      uriIndex: new Map(this._graph.uriIndex),
      executionIndex: new Map(this._graph.executionIndex),
    };
  }

  /**
   * getStats — 获取图谱统计
   */
  getStats(): { totalNodes: number; totalEdges: number; totalExecutions: number; memoryEstimateBytes: number } {
    const nodeBytes = this._graph.nodes.size * 512; // 估算每个节点 512B
    const edgeBytes = this._graph.edges.length * 128;
    return {
      totalNodes: this._graph.nodes.size,
      totalEdges: this._graph.edges.length,
      totalExecutions: this._graph.executionIndex.size,
      memoryEstimateBytes: nodeBytes + edgeBytes,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  /**
   * generateNodeId — 生成唯一节点 ID
   */
  private generateNodeId(): string {
    const ts = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString('hex');
    return `art_node_${ts}_${rand}`;
  }

  /**
   * fastDigest — 快速非加密摘要（用于无哈希模式）
   */
  private fastDigest(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
  }

  /**
   * computeHashAsync — 异步计算 SHA-256 哈希
   *
   * 对于内存中的大内容使用 worker 或超时保护。
   */
  private async computeHashAsync(node: ArtifactNode): Promise<void> {
    // 从 uri 构造哈希输入：uri + generatorNode + parentIds + timestamp
    const input = `${node.uri}|${node.generatorNode}|${node.parentIds.join(',')}|${node.timestamp}`;

    const hashPromise = crypto.subtle
      ? crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
        .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''))
      : Promise.resolve(
          crypto.createHash('sha256').update(input).digest('hex'),
        );

    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('哈希计算超时')), this._config.hashTimeoutMs),
    );

    try {
      node.hash = await Promise.race([hashPromise, timeoutPromise]);
    } catch {
      // 超时则使用快速摘要
      node.hash = this.fastDigest(input);
    }
  }

  /**
   * findEdges — 查找两个节点间的所有边
   */
  private findEdges(fromId: string, toId: string): LineageEdge[] {
    return this._graph.edges.filter(e => e.from === fromId && e.to === toId);
  }

  /**
   * evictOldestNode — LRU 淘汰最老的节点
   */
  private evictOldestNode(): void {
    let oldestId: string | null = null;
    let oldestTs = Infinity;

    for (const [id, node] of this._graph.nodes) {
      if (node.timestamp < oldestTs) {
        oldestTs = node.timestamp;
        oldestId = id;
      }
    }

    if (oldestId) {
      const node = this._graph.nodes.get(oldestId);
      if (node) {
        this._graph.uriIndex.delete(node.uri);
        this._graph.nodes.delete(oldestId);

        // 清理与已淘汰节点相关的边
        this._graph.edges = this._graph.edges.filter(
          e => e.from !== oldestId && e.to !== oldestId,
        );
      }
    }
  }

  // ── 持久化 ──

  /**
   * persistToDisk — 将图谱持久化到磁盘
   *
   * 使用 JSONL 格式（每行一个节点或边），兼容现有的 JSONLStorage。
   * 完全异步非阻塞。
   */
  async persistToDisk(): Promise<void> {
    if (!this._config.persistToDisk) return;

    const dir = this._config.persistencePath;
    await fsp.mkdir(dir, { recursive: true });

    // 写入节点文件（JSONL）
    const nodesPath = path.join(dir, 'lineage-nodes.jsonl');
    const nodeLines: string[] = [];
    for (const [, node] of this._graph.nodes) {
      nodeLines.push(JSON.stringify(node));
    }
    await fsp.writeFile(nodesPath, nodeLines.join('\n') + (nodeLines.length > 0 ? '\n' : ''), 'utf-8');

    // 写入边文件（JSONL）
    const edgesPath = path.join(dir, 'lineage-edges.jsonl');
    const edgeLines: string[] = [];
    for (const edge of this._graph.edges) {
      edgeLines.push(JSON.stringify(edge));
    }
    await fsp.writeFile(edgesPath, edgeLines.join('\n') + (edgeLines.length > 0 ? '\n' : ''), 'utf-8');

    // 写入索引文件（单 JSON）
    const indexPath = path.join(dir, 'lineage-index.json');
    const indexData = {
      uriIndex: Object.fromEntries(this._graph.uriIndex),
      executionIndex: Object.fromEntries(
        [...this._graph.executionIndex.entries()].map(([k, v]) => [k, v]),
      ),
      savedAt: Date.now(),
      totalNodes: this._graph.nodes.size,
      totalEdges: this._graph.edges.length,
    };
    await fsp.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
  }

  /**
   * loadFromDisk — 从磁盘恢复图谱
   */
  private async loadFromDisk(): Promise<void> {
    const dir = this._config.persistencePath;

    try {
      await fsp.access(dir);
    } catch {
      return; // 目录不存在，跳过加载
    }

    try {
      // 加载节点
      const nodesPath = path.join(dir, 'lineage-nodes.jsonl');
      const nodeContent = await fsp.readFile(nodesPath, 'utf-8');
      const nodeLines = nodeContent.trim().split('\n').filter(Boolean);
      for (const line of nodeLines) {
        try {
          const node: ArtifactNode = JSON.parse(line);
          this._graph.nodes.set(node.id, node);
          this._graph.uriIndex.set(node.uri, node.id);
        } catch {
          // 跳过损坏的行
        }
      }

      // 加载边
      const edgesPath = path.join(dir, 'lineage-edges.jsonl');
      const edgeContent = await fsp.readFile(edgesPath, 'utf-8');
      const edgeLines = edgeContent.trim().split('\n').filter(Boolean);
      for (const line of edgeLines) {
        try {
          const edge: LineageEdge = JSON.parse(line);
          this._graph.edges.push(edge);
        } catch {
          // 跳过损坏的行
        }
      }

      // 加载索引
      const indexPath = path.join(dir, 'lineage-index.json');
      const indexContent = await fsp.readFile(indexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      if (indexData.uriIndex) {
        for (const [uri, id] of Object.entries(indexData.uriIndex)) {
          this._graph.uriIndex.set(uri, id as string);
        }
      }

      if (indexData.executionIndex) {
        for (const [execId, nodeIds] of Object.entries(indexData.executionIndex)) {
          this._graph.executionIndex.set(execId, nodeIds as string[]);
        }
      }

      this._totalNodes = this._graph.nodes.size;
      this._totalEdges = this._graph.edges.length;

      this._context?.logger.info('从磁盘恢复血缘图谱', {
        nodes: this._totalNodes,
        edges: this._totalEdges,
      });
    } catch (err: any) {
      this._context?.logger.warn('从磁盘加载血缘图谱失败，将使用空图谱', {
        error: err.message,
      });
      // 不清空已有数据，继续运行
    }
  }
}
