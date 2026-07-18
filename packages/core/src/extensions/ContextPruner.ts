/**
 * ContextPruner — 上下文智能引擎
 *
 * 解决长任务下的模型失忆与 Token 爆窗问题，实现动态语义流控。
 *
 * 核心机制：
 *   1. 血缘修剪：通过逆向追溯产物血缘，剔除所有与当前节点无拓扑依赖的无关历史产物
 *   2. 大对象 Offload：超过阈值的产物内容自动转储到 .morpex/artifacts/ 目录，
 *      并在上下文中替换为摘要指针
 *   3. Token 预算控制：限制总上下文不超过 maxTokensBudget
 *   4. 可审计：每次剪枝生成完整的 PruningResult，记录所有决策
 *
 * 集成方式（非侵入式）：
 *   通过 createPrunedWakeAgent() 包装原始的 wakeAgent 函数，
 *   在每次 LLM 调用前自动执行剪枝。
 *
 *   const pruner = new ContextPruner(config, lineageTracker);
 *   const prunedWakeAgent = pruner.createPrunedWakeAgent(originalWakeAgent, nodeId);
 *   const handoff = createHandoffContext({ ..., wakeAgent: prunedWakeAgent });
 *
 * 设计约束：
 *   - 零侵入引擎代码
 *   - 所有 I/O 异步非阻塞（fs.promises）
 *   - 剪枝决策可追溯（日志 + PruningResult）
 *   - 支持一键 Disable
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ExtensionDefinition,
  ExtensionContext,
  ExtensionStatus,
  ContextPrunerConfig,
  ContextSegment,
  ContextSnapshot,
  PruningDecision,
  PruningResult,
  LineageGraph,
  BeforeLLMCallPayload,
} from './types.js';
import { DEFAULT_EXTENSIONS_CONFIG } from './types.js';
import type { LineageTracker } from './LineageTracker.js';
import type { ArtifactRef } from '../domains/types.js';
import type { CompactionPolicy } from '../compaction/CompactionPolicy.js';
import { estimateTokens, SlidingWindowCompaction } from '../compaction/CompactionPolicy.js';

/** Agent 执行结果（最小接口定义） */
type AgentResult = Record<string, any>;

// estimateTokens 已迁移至 CompactionPolicy.estimateTokens()

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 系统提示默认重要性 */
const SYSTEM_PROMPT_IMPORTANCE = 10;
/** 最近 N 条消息最低保留 */
const RECENT_MESSAGES_KEEP = 10;

// ═══════════════════════════════════════════════════════════════
// ContextPruner
// ═══════════════════════════════════════════════════════════════

export class ContextPruner implements ExtensionDefinition {
  public readonly name = 'ContextPruner';
  public readonly version = '1.0.0';
  public readonly dependencies: string[] = ['LineageTracker'];

  private _enabled: boolean;
  private _config: ContextPrunerConfig;
  private _context: ExtensionContext | null = null;
  private _lineageTracker: LineageTracker | null = null;
  private _unsubscribers: Array<() => void> = [];
  private _phase: ExtensionStatus['phase'] = 'uninitialized';
  private _startedAt: number | undefined;
  private _lastError: string | undefined;
  private _totalPrunes = 0;
  private _totalTokensSaved = 0;
  private _totalOffloads = 0;
  private _snapshots: Map<string, ContextSnapshot> = new Map();
  private _offloadDirInitialized = false;
  /** 注入的压缩策略接口（策略模式，默认滑窗截断） */
  private _compactionPolicy: CompactionPolicy;

  constructor(
    config?: Partial<ContextPrunerConfig>,
    lineageTracker?: LineageTracker,
    compactionPolicy?: CompactionPolicy,
  ) {
    this._config = { ...DEFAULT_EXTENSIONS_CONFIG.contextPruner, ...config };
    this._enabled = this._config.enabled;
    this._lineageTracker = lineageTracker ?? null;
    this._compactionPolicy = compactionPolicy ?? new SlidingWindowCompaction();
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

    // 解析 LineageTracker 依赖
    if (!this._lineageTracker) {
      this._lineageTracker = context.registry.get<LineageTracker>('LineageTracker') ?? null;
    }

    // 确保卸载目录存在
    if (this._config.enabled) {
      await this.ensureOffloadDir();
    }

    context.logger.info('ContextPruner 已初始化', {
      offloadThreshold: this._config.offloadThresholdBytes,
      maxTokensBudget: this._config.maxTokensBudget,
      topologicalPruning: this._config.enableTopologicalPruning,
      lineageTrackerAvailable: !!this._lineageTracker,
    });
  }

  async start(): Promise<void> {
    if (!this._context) throw new Error('ContextPruner 未初始化');

    this._phase = 'running';
    this._startedAt = Date.now();

    // 订阅剪枝审计事件
    const unsub = this._context.eventBus.on(
      'context.prune.completed',
      this.onPruneCompleted.bind(this),
    );
    this._unsubscribers.push(unsub);

    this._context.logger.info('ContextPruner 已启动');
  }

  async stop(): Promise<void> {
    this._phase = 'stopped';

    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch { /* suppress */ }
    }
    this._unsubscribers = [];

    // 清理快照
    this._snapshots.clear();

    this._context?.logger.info('ContextPruner 已停止');
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
        totalPrunes: this._totalPrunes,
        totalTokensSaved: this._totalTokensSaved,
        totalOffloads: this._totalOffloads,
        snapshotsCount: this._snapshots.size,
      },
    };
  }

  // ── 核心 API：上下文剪枝 ──

  /**
   * pruneContext — 对上下文执行智能剪枝
   *
   * 这是 ContextPruner 的核心方法。接收原始上下文片段列表，
   * 返回剪枝后的片段列表 + 完整的剪枝决策记录。
   *
   * 剪枝策略（按优先级）：
   *   1. 系统提示 → 绝对保留
   *   2. 最近 N 条消息 → 保留（防止上下文断裂）
   *   3. 高重要性片段（importance >= 8）→ 保留
   *   4. 拓扑剪枝：与当前节点无依赖的产物 → 剔除或 offload
   *   5. 大对象 Offload：>10KB 的产物 → 转储磁盘，替换为指针
   *   6. Token 预算：若仍超标，按 (importance, recency) 排序剔除
   *
   * @param segments     - 原始上下文片段
   * @param currentNodeId - 当前 DAG 节点 ID（用于拓扑剪枝）
   * @param executionId   - 执行 ID（用于审计）
   * @returns 剪枝结果
   */
  async pruneContext(
    segments: ContextSegment[],
    currentNodeId: string,
    executionId: string,
  ): Promise<PruningResult> {
    const startTime = Date.now();

    if (!this._enabled) {
      return this.passthroughResult(segments, startTime);
    }

    // 计算剪枝前 token
    const tokensBefore = this.estimateTotalTokens(segments);

    // 创建快照（剪枝前）
    const snapshotId = `ctx_snap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const snapshot: ContextSnapshot = {
      id: snapshotId,
      executionId,
      nodeId: currentNodeId,
      segments: this.deepCloneSegments(segments),
      timestamp: Date.now(),
    };
    this._snapshots.set(snapshotId, snapshot);

    // 限制快照数量
    if (this._snapshots.size > 50) {
      const oldest = this._snapshots.keys().next().value;
      if (oldest) this._snapshots.delete(oldest);
    }

    const decisions: PruningDecision[] = [];
    const offloadedArtifacts: PruningResult['offloadedArtifacts'] = [];

    // Phase 1: 分类并标记基础保护
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // 系统提示 → 绝对保留
      if (seg.type === 'system_prompt') {
        decisions.push({
          segmentId: seg.id,
          keep: true,
          reason: 'system_prompt',
        });
        continue;
      }

      // 最近 N 条消息 → 保留
      if (i >= segments.length - RECENT_MESSAGES_KEEP) {
        decisions.push({
          segmentId: seg.id,
          keep: true,
          reason: 'recent_message',
        });
        continue;
      }

      // 高重要性 → 保留
      if (seg.importance >= 8) {
        decisions.push({
          segmentId: seg.id,
          keep: true,
          reason: 'high_importance',
        });
        continue;
      }

      // 标记为待定（后续阶段筛选）
      decisions.push({
        segmentId: seg.id,
        keep: true,
        reason: 'explicitly_protected', // 临时标记，后续可能更改
      });
    }

    // Phase 2: 拓扑剪枝（如果启用且有 LineageTracker）
    if (this._config.enableTopologicalPruning && this._lineageTracker) {
      await this.applyTopologicalPruning(segments, decisions, currentNodeId);
    }

    // Phase 3: 大对象 Offload
    if (this._config.offloadThresholdBytes > 0) {
      await this.applyOffloading(segments, decisions, offloadedArtifacts);
    }

    // Phase 4: Token 预算控制
    await this.applyTokenBudget(segments, decisions, this._config.maxTokensBudget);

    // 构建剪枝后的片段列表
    const prunedSegments: ContextSegment[] = [];
    for (let i = 0; i < segments.length; i++) {
      const decision = decisions[i];
      if (!decision || !decision.keep) continue;

      const seg = segments[i];
      if (decision.replacementContent) {
        // 替换为摘要指针
        prunedSegments.push({
          ...seg,
          content: decision.replacementContent,
          estimatedTokens: this.estimateTokens(decision.replacementContent),
          metadata: {
            ...seg.metadata,
            originalSize: seg.content.length,
            offloaded: true,
            offloadPath: decision.offloadPath,
          },
        });
      } else {
        prunedSegments.push(seg);
      }
    }

    // 可选：追加血缘摘要
    let lineageSummary: string | undefined;
    if (this._config.includeLineageSummary && this._lineageTracker) {
      lineageSummary = this.buildLineageSummary(currentNodeId);
      if (lineageSummary) {
        prunedSegments.push({
          id: `lineage_summary_${snapshotId}`,
          type: 'lineage_summary',
          content: lineageSummary,
          estimatedTokens: this.estimateTokens(lineageSummary),
          timestamp: Date.now(),
          prunable: false,
          importance: 5,
        });
      }
    }

    const tokensAfter = this.estimateTotalTokens(prunedSegments);
    const durationMs = Date.now() - startTime;

    this._totalPrunes++;
    this._totalTokensSaved += Math.max(0, tokensBefore - tokensAfter);

    const result: PruningResult = {
      tokensBefore,
      tokensAfter,
      pruningRatio: tokensBefore > 0 ? (tokensBefore - tokensAfter) / tokensBefore : 0,
      decisions,
      prunedSegments,
      offloadedArtifacts,
      lineageSummary,
      durationMs,
    };

    // 发射剪枝完成事件（审计）
    if (this._context) {
      this._context.eventBus.emit({
        id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        type: 'context.prune.completed',
        timestamp: Date.now(),
        executionId,
        source: 'context-pruner',
        payload: {
          tokensBefore,
          tokensAfter,
          pruningRatio: result.pruningRatio,
          decisionsCount: decisions.length,
          keptCount: decisions.filter(d => d.keep).length,
          offloadCount: offloadedArtifacts.length,
          durationMs,
          nodeId: currentNodeId,
        },
      });
    }

    return result;
  }

  /**
   * pruneBeforeLLMCall — 便捷方法：在 LLM 调用前剪枝
   *
   * 接收 BeforeLLMCallPayload，直接修改其 contextSegments。
   * 这是与引擎集成的推荐入口。
   */
  async pruneBeforeLLMCall(payload: BeforeLLMCallPayload): Promise<PruningResult> {
    const result = await this.pruneContext(
      payload.contextSegments,
      payload.nodeId,
      payload.executionId,
    );

    // 直接替换 payload 中的上下文片段
    payload.contextSegments.length = 0;
    for (const seg of result.prunedSegments) {
      payload.contextSegments.push(seg);
    }

    return result;
  }

  // ── 集成辅助：创建包装后的 wakeAgent ──

  /**
   * createPrunedWakeAgent — 创建带上下文剪枝的 wakeAgent 包装函数
   *
   * 返回一个与原 wakeAgent 签名兼容的函数，
   * 在每次调用前自动执行上下文剪枝。
   *
   * 用法：
   *   const pruner = new ContextPruner(config, lineageTracker);
   *   const prunedWakeAgent = pruner.createPrunedWakeAgent(
   *     originalWakeAgent,
   *     executionId,
   *   );
   *   const handoff = createHandoffContext({ wakeAgent: prunedWakeAgent, ... });
   *
   * @param originalWakeAgent - 原始 wakeAgent 函数
   * @param executionId       - 执行 ID
   * @returns 包装后的 wakeAgent
   */
  createPrunedWakeAgent(
    originalWakeAgent: (
      domainId: string,
      task: string,
      tools: string[],
      systemPrompt?: string,
    ) => Promise<AgentResult>,
    executionId: string,
  ): (
    domainId: string,
    task: string,
    tools: string[],
    systemPrompt?: string,
  ) => Promise<AgentResult> {
    const pruner = this;

    return async function prunedWakeAgent(
      domainId: string,
      task: string,
      tools: string[],
      systemPrompt?: string,
    ): Promise<AgentResult> {
      if (!pruner._enabled) {
        return originalWakeAgent(domainId, task, tools, systemPrompt);
      }

      try {
        // 构建上下文片段
        const segments = pruner.buildSegmentsFromWakeParams(
          domainId, task, tools, systemPrompt, executionId,
        );

        // 确定当前节点 ID（从 executionId 推断或使用 domainId）
        const nodeId = domainId;

        // 执行剪枝
        const result = await pruner.pruneContext(segments, nodeId, executionId);

        // 用剪枝后的上下文重建 task 字符串
        const prunedTask = pruner.reconstructTask(result.prunedSegments, task);

        pruner._context?.logger.debug('LLM 调用前上下文剪枝完成', {
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
          ratio: `${(result.pruningRatio * 100).toFixed(1)}%`,
        });

        return originalWakeAgent(domainId, prunedTask, tools, systemPrompt);
      } catch (err: any) {
        pruner._lastError = err.message;
        pruner._context?.logger.warn('上下文剪枝失败，使用原始上下文', { error: err.message });
        return originalWakeAgent(domainId, task, tools, systemPrompt);
      }
    };
  }

  /**
   * buildSegmentsFromWakeParams — 从 wakeAgent 参数构建 ContextSegment 列表
   *
   * 将 wakeAgent 的平面参数转换为结构化的 ContextSegment 列表，
   * 以便剪枝引擎进行处理。
   */
  buildSegmentsFromWakeParams(
    domainId: string,
    task: string,
    tools: string[],
    systemPrompt: string | undefined,
    executionId: string,
  ): ContextSegment[] {
    const segments: ContextSegment[] = [];
    const now = Date.now();
    const ts = `${executionId}_${now}`;

    // 1. 系统提示
    if (systemPrompt) {
      segments.push({
        id: `sys_${ts}`,
        type: 'system_prompt',
        content: systemPrompt,
        estimatedTokens: this.estimateTokens(systemPrompt),
        timestamp: now,
        prunable: false,
        importance: SYSTEM_PROMPT_IMPORTANCE,
      });
    }

    // 2. 工具列表（作为上下文信息）
    if (tools.length > 0) {
      segments.push({
        id: `tools_${ts}`,
        type: 'raw',
        content: `Available tools: ${tools.join(', ')}`,
        estimatedTokens: this.estimateTokens(`Available tools: ${tools.join(', ')}`),
        timestamp: now,
        prunable: false,
        importance: 8,
      });
    }

    // 3. 任务描述
    segments.push({
      id: `task_${ts}`,
      type: 'user_message',
      content: task,
      estimatedTokens: this.estimateTokens(task),
      timestamp: now,
      nodeId: domainId,
      prunable: false,
      importance: 10,
      metadata: { domainId, executionId },
    });

    return segments;
  }

  /**
   * reconstructTask — 从剪枝后片段重建 task 字符串
   */
  reconstructTask(segments: ContextSegment[], originalTask: string): string {
    const parts: string[] = [];

    for (const seg of segments) {
      if (seg.type === 'system_prompt') continue; // systemPrompt 单独传递
      if (seg.type === 'lineage_summary') {
        parts.push(`\n/* Lineage Context */\n${seg.content}`);
      } else if (seg.type === 'user_message' && seg.content === originalTask) {
        // 保留原始 task
        continue;
      } else if (seg.type !== 'user_message') {
        parts.push(seg.content);
      }
    }

    if (parts.length === 0) return originalTask;

    return `${originalTask}\n\n${parts.join('\n\n')}`;
  }

  // ── 快照管理 ──

  /**
   * getSnapshot — 获取剪枝前的上下文快照
   */
  getSnapshot(snapshotId: string): ContextSnapshot | undefined {
    return this._snapshots.get(snapshotId);
  }

  /**
   * rollbackToSnapshot — 回滚到某个快照（恢复原始上下文）
   */
  rollbackToSnapshot(snapshotId: string): ContextSegment[] | null {
    const snapshot = this._snapshots.get(snapshotId);
    if (!snapshot) return null;
    return this.deepCloneSegments(snapshot.segments);
  }

  // ── 估算工具 ──

  /**
   * estimateTokens — Token 估算（混合中英文）
   * 该实现覆盖完整 CJK 范围（包括扩展集 A/B、中文标点）。
   * 禁止在各模块重复实现。
   */
  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  /**
   * estimateTotalTokens — 估算上下文片段列表的总 token 数
   */
  estimateTotalTokens(segments: ContextSegment[]): number {
    let total = 0;
    for (const seg of segments) {
      total += seg.estimatedTokens > 0 ? seg.estimatedTokens : this.estimateTokens(seg.content);
    }
    return total;
  }

  // ═══════════════════════════════════════════════════════════
  // 剪枝策略实现
  // ═══════════════════════════════════════════════════════════

  /**
   * Phase 2: 拓扑剪枝
   *
   * 通过 LineageTracker 判断每个上下文片段关联的产物是否与当前节点有依赖关系。
   * 若无依赖 → 标记为 topology_independent → 后续可能被剔除或 offload。
   */
  private async applyTopologicalPruning(
    segments: ContextSegment[],
    decisions: PruningDecision[],
    currentNodeId: string,
  ): Promise<void> {
    if (!this._lineageTracker) return;

    for (let i = 0; i < segments.length; i++) {
      const decision = decisions[i];
      if (!decision || !decision.keep) continue;

      const seg = segments[i];

      // 只处理 artifact_ref 类型或有 artifactUri 的片段
      if (seg.type !== 'artifact_ref' && !seg.artifactUri) continue;

      const artifactUri = seg.artifactUri;
      if (!artifactUri) continue;

      // 检查该产物是否与当前节点有血缘关系
      const isDependent = this.checkTopologicalDependency(artifactUri, currentNodeId);

      if (!isDependent) {
        decision.keep = false;
        decision.reason = 'topology_independent';
      } else {
        decision.keep = true;
        decision.reason = 'topology_dependent';
      }
    }
  }

  /**
   * checkTopologicalDependency — 检查产物是否与当前节点有拓扑依赖关系
   *
   * 策略：
   *   1. 在 LineageGraph 中查找该产物的节点
   *   2. 通过 generatorNode 字段，判断产物的生成节点是否为当前节点的上游
   *   3. 或通过 BFS 检查是否存在路径
   */
  private checkTopologicalDependency(artifactUri: string, currentNodeId: string): boolean {
    if (!this._lineageTracker) return true; // 无追踪器时保留所有产物

    const node = this._lineageTracker.getByURI(artifactUri);
    if (!node) {
      // 产物未注册，保留（可能是新产物，还未被追踪）
      return true;
    }

    // 策略 1: 直接检查 generatorNode
    if (node.generatorNode === currentNodeId) return true;

    // 策略 2: 遍历上游，检查是否有当前节点的产物
    const upstreamNodes = this._lineageTracker.getUpstream(artifactUri, this._config.maxUpstreamDepth);
    for (const upstream of upstreamNodes) {
      if (upstream.generatorNode === currentNodeId) return true;
    }

    // 策略 3: 若两者都无法确认关联，保守地认为无关
    // （这会导致更多的剪枝，可能更激进）
    return false;
  }

  /**
   * Phase 3: 大对象 Offload
   *
   * 超过阈值的产物内容自动转储到 .morpex/artifacts/ 目录，
   * 并在上下文 prompt 中替换为摘要指针。
   */
  private async applyOffloading(
    segments: ContextSegment[],
    decisions: PruningDecision[],
    offloadedArtifacts: PruningResult['offloadedArtifacts'],
  ): Promise<void> {
    await this.ensureOffloadDir();

    for (let i = 0; i < segments.length; i++) {
      const decision = decisions[i];
      if (!decision || !decision.keep) continue;

      const seg = segments[i];
      const contentBytes = Buffer.byteLength(seg.content, 'utf-8');

      if (contentBytes <= this._config.offloadThresholdBytes) continue;

      // 需要卸载
      try {
        const offloadPath = await this.offloadContent(seg);
        offloadedArtifacts.push({
          uri: seg.artifactUri ?? seg.id,
          filePath: offloadPath,
          sizeBytes: contentBytes,
        });

        // 生成摘要指针
        const artifactName = seg.artifactUri ? path.basename(seg.artifactUri) : seg.id;
        const sizeKB = (contentBytes / 1024).toFixed(1);
        const pointer = this._config.artifactPointerTemplate
          .replace('{name}', artifactName)
          .replace('{size}', `${sizeKB}KB`);

        decision.offloadPath = offloadPath;
        decision.replacementContent = pointer;
        decision.reason = 'offloaded';
        this._totalOffloads++;

        this._context?.logger.debug('大对象已卸载', {
          artifact: artifactName,
          size: `${sizeKB}KB`,
          path: offloadPath,
        });
      } catch (err: any) {
        this._context?.logger.warn('大对象卸载失败，保留在上下文中', {
          segmentId: seg.id,
          error: err.message,
        });
        // 卸载失败则保留在上下文中
        decision.keep = true;
        decision.reason = 'explicitly_protected';
      }
    }
  }

  /**
   * Phase 4: Token 预算控制
   *
   * 若剪枝后 token 仍超标，按 (importance ASC, timestamp ASC) 排序，
   * 从最不重要/最旧的片段开始剔除。
   */
  private async applyTokenBudget(
    segments: ContextSegment[],
    decisions: PruningDecision[],
    budget: number,
  ): Promise<void> {
    const currentTokens = this.estimateTotalTokens(
      segments.filter((_, i) => decisions[i]?.keep !== false),
    );

    if (currentTokens <= budget) return;

    // 收集可被进一步剔除的片段（排除系统提示、最近消息、高重要性）
    const candidates: Array<{ index: number; seg: ContextSegment }> = [];
    for (let i = 0; i < segments.length; i++) {
      const d = decisions[i];
      if (!d || !d.keep) continue;
      if (d.reason === 'system_prompt' || d.reason === 'high_importance') continue;
      if (d.reason === 'recent_message') continue;
      if (!segments[i].prunable) continue;

      candidates.push({ index: i, seg: segments[i] });
    }

    // 按 importance 升序，timestamp 升序（最不重要/最旧优先剔除）
    candidates.sort((a, b) => {
      const impDiff = a.seg.importance - b.seg.importance;
      if (impDiff !== 0) return impDiff;
      return a.seg.timestamp - b.seg.timestamp;
    });

    let runningTokens = currentTokens;
    for (const { index, seg } of candidates) {
      if (runningTokens <= budget) break;

      const d = decisions[index];
      if (!d) continue;

      d.keep = false;
      d.reason = 'budget_exceeded';
      runningTokens -= seg.estimatedTokens > 0 ? seg.estimatedTokens : this.estimateTokens(seg.content);
    }
  }

  // ── Offload 辅助 ──

  /**
   * ensureOffloadDir — 确保卸载目录存在
   */
  private async ensureOffloadDir(): Promise<void> {
    if (this._offloadDirInitialized) return;
    await fsp.mkdir(this._config.offloadDir, { recursive: true });
    this._offloadDirInitialized = true;
  }

  /**
   * offloadContent — 将片段内容卸载到磁盘
   *
   * @returns 卸载文件路径
   */
  private async offloadContent(seg: ContextSegment): Promise<string> {
    const safeName = seg.id.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 64);
    const ts = Date.now();
    const fileName = `${safeName}_${ts}.offload`;
    const filePath = path.join(this._config.offloadDir, fileName);

    // 写入元数据头 + 原始内容
    const header = [
      `# Offloaded Context Segment`,
      `# ID: ${seg.id}`,
      `# Type: ${seg.type}`,
      `# Timestamp: ${new Date(seg.timestamp).toISOString()}`,
      `# Estimated Tokens: ${seg.estimatedTokens}`,
      `# Artifact URI: ${seg.artifactUri ?? 'N/A'}`,
      `# Node ID: ${seg.nodeId ?? 'N/A'}`,
      ``,
    ].join('\n');

    await fsp.writeFile(filePath, header + '\n' + seg.content, 'utf-8');
    return filePath;
  }

  // ── 血缘摘要构建 ──

  /**
   * buildLineageSummary — 为当前节点构建血缘关系摘要
   *
   * 汇总当前节点相关的上游产物路径，生成紧凑的文本摘要。
   */
  private buildLineageSummary(currentNodeId: string): string | undefined {
    if (!this._lineageTracker) return undefined;

    // 查找当前节点生成的所有产物
    const allNodes = [...this._lineageTracker.getGraphSnapshot().nodes.values()];
    const relevantNodes = allNodes.filter(n => n.generatorNode === currentNodeId);

    if (relevantNodes.length === 0) return undefined;

    const lines: string[] = ['## Artifact Lineage Summary'];

    for (const node of relevantNodes) {
      const upstream = this._lineageTracker.getUpstream(node.uri, this._config.maxUpstreamDepth);
      const upstreamNames = upstream.map(n => `  - ${n.name} (${n.type}) ← [${n.generatorNode}]`);
      lines.push(`### ${node.name} (${node.type})`);
      if (upstreamNames.length > 0) {
        lines.push('Upstream dependencies:');
        lines.push(...upstreamNames);
      } else {
        lines.push('No upstream dependencies (root artifact).');
      }
    }

    return lines.join('\n');
  }

  // ── 工具方法 ──

  /**
   * deepCloneSegments — 深度克隆上下文片段列表
   */
  private deepCloneSegments(segments: ContextSegment[]): ContextSegment[] {
    return segments.map(s => ({
      ...s,
      metadata: s.metadata ? { ...s.metadata } : undefined,
    }));
  }

  /**
   * passthroughResult — 生成无操作的剪枝结果（用于 disabled 模式）
   */
  private passthroughResult(segments: ContextSegment[], startTime: number): PruningResult {
    const tokens = this.estimateTotalTokens(segments);
    return {
      tokensBefore: tokens,
      tokensAfter: tokens,
      pruningRatio: 0,
      decisions: segments.map(s => ({
        segmentId: s.id,
        keep: true,
        reason: 'explicitly_protected' as const,
      })),
      prunedSegments: segments,
      offloadedArtifacts: [],
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * onPruneCompleted — 剪枝完成事件处理（审计日志）
   */
  private onPruneCompleted(event: any): void {
    // 审计记录：可扩展为写入外部审计存储
    const payload = event.payload;
    if (payload) {
      this._context?.logger.debug('剪枝审计', {
        tokensBefore: payload.tokensBefore,
        tokensAfter: payload.tokensAfter,
        ratio: payload.pruningRatio,
        nodeId: payload.nodeId,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 便捷工厂函数
// ═══════════════════════════════════════════════════════════════

/**
 * createPrunedWakeAgent — 独立工厂函数
 *
 * 无需完整初始化 ContextPruner 即可创建包装后的 wakeAgent。
 * 适用于快速集成场景。
 */
export function createPrunedWakeAgent(
  pruner: ContextPruner,
  originalWakeAgent: (
    domainId: string,
    task: string,
    tools: string[],
    systemPrompt?: string,
  ) => Promise<AgentResult>,
  executionId: string,
): (
  domainId: string,
  task: string,
  tools: string[],
  systemPrompt?: string,
) => Promise<AgentResult> {
  return pruner.createPrunedWakeAgent(originalWakeAgent, executionId);
}
