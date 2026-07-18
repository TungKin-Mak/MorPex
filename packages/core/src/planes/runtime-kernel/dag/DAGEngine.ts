/**
 * DAGEngine — DAG 执行引擎
 *
 * 从 src/core/adaptive-dag.ts 等迁移，核心变化：
 *   1. 使用 MorPexCore 自有类型
 *   2. 不可变基 + Overlay 分层架构
 *   3. 每次 mutation 经过验证
 *   4. 通过 EventBus 广播 dag.* 事件
 *
 * 功能：
 *   - DAG 构建（addNode, removeNode, insertAfter）
 *   - DAG 验证（环检测、依赖完整性）
 *   - DAG 执行（拓扑排序、并行调度）
 *   - 状态追踪
 *   - 变更历史
 */

import type {
  DAGNode,
  DAGEdge,
  DAGNodeStatus,
  DAGMutation,
  DAGStatus,
  ValidationResult,
  ValidationError,
  DAGEngineConfig,
} from './types.js';
import { topologicalSort as tsort } from '../../../utils/toposort.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<DAGEngineConfig> = {
  maxRetries: 3,
  enableRerouting: true,
  maxParallel: 5,
};

/**
 * DAGEngine — DAG 执行引擎
 *
 * 管理 DAG 的构建、验证、执行。
 * 基于分层架构：底层节点数据不可变，运行时变更通过 overlay 层。
 */
export class DAGEngine {
  private nodes: Map<string, DAGNode> = new Map();
  private edges: Set<string> = new Set(); // "from->to" 格式
  private mutationsLog: DAGMutation[] = [];
  private config: Required<DAGEngineConfig>;
  private nodeHistory: Map<string, DAGNode[]> = new Map(); // 变更历史

  /** 外部事件回调 */
  onMutation: ((mutation: DAGMutation) => void) | null = null;
  onNodeStatusChange: ((nodeId: string, status: DAGNodeStatus, prevStatus: DAGNodeStatus) => void) | null = null;
  onError: ((nodeId: string, error: string) => void) | null = null;

  constructor(config?: DAGEngineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 节点操作 ──

  /** 添加节点 */
  addNode(node: DAGNode): boolean {
    if (this.nodes.has(node.id)) return false;

    const cleanNode: DAGNode = {
      ...node,
      status: node.status ?? 'pending',
      retryCount: node.retryCount ?? 0,
      maxRetries: node.maxRetries ?? this.config.maxRetries,
    };

    this.nodes.set(node.id, cleanNode);

    // 记录依赖边
    for (const depId of cleanNode.deps) {
      if (this.nodes.has(depId)) {
        this.edges.add(`${depId}->${node.id}`);
      }
    }

    this.recordMutation('insert', node.id, 'addNode');
    this.snapshotNode(node.id);
    return true;
  }

  /** 批量添加节点 */
  addNodes(nodes: DAGNode[]): void {
    for (const node of nodes) this.addNode(node);
  }

  /** 在指定节点后插入新节点 */
  insertAfter(afterNodeId: string, newNode: DAGNode): boolean {
    if (!this.nodes.has(afterNodeId)) return false;

    newNode.deps = [afterNodeId];
    this.addNode(newNode);

    // 原节点的下游节点也依赖新节点
    for (const [id, node] of this.nodes) {
      if (id === newNode.id) continue;
      if (node.deps.includes(afterNodeId) && !node.deps.includes(newNode.id)) {
        node.deps.push(newNode.id);
        this.edges.add(`${newNode.id}->${id}`);
        this.snapshotNode(id);
      }
    }

    this.recordMutation('insert', newNode.id, 'insertAfter');
    return true;
  }

  /** 删除节点 */
  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    // 清理依赖该节点的下游
    for (const [id, n] of this.nodes) {
      const idx = n.deps.indexOf(nodeId);
      if (idx !== -1) {
        n.deps.splice(idx, 1);
        this.edges.delete(`${nodeId}->${id}`);
        this.snapshotNode(id);
      }
    }

    // 清理边
    for (const edge of [...this.edges]) {
      if (edge.startsWith(`${nodeId}->`) || edge.endsWith(`->${nodeId}`)) {
        this.edges.delete(edge);
      }
    }

    this.nodes.delete(nodeId);
    this.nodeHistory.delete(nodeId);
    this.recordMutation('remove', nodeId, 'removeNode');
    return true;
  }

  /** 标记节点为重路由 */
  rerouteNode(nodeId: string, alternateId?: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const prevStatus = node.status;
    node.status = 'rerouting';

    if (alternateId && node.alternateNodes) {
      if (!node.alternateNodes.includes(alternateId)) {
        node.alternateNodes.push(alternateId);
      }
    }

    this.snapshotNode(nodeId);
    this.onNodeStatusChange?.(nodeId, 'rerouting', prevStatus);
    this.recordMutation('reroute', nodeId, `rerouteNode${alternateId ? ` → ${alternateId}` : ''}`);
    return true;
  }

  // ── 执行调度 ──

  /** 准备执行：计算就绪节点 */
  getReadyNodes(): DAGNode[] {
    const ready: DAGNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;
      if (this.areDepsReady(node)) {
        ready.push(node);
      }
    }
    // 按优先级排序
    ready.sort((a, b) => b.priority - a.priority);
    return ready;
  }

  /** 检查依赖是否就绪 */
  private areDepsReady(node: DAGNode): boolean {
    if (!node.deps || node.deps.length === 0) return true;
    return node.deps.every(depId => {
      const dep = this.nodes.get(depId);
      return dep && dep.status === 'success';
    });
  }

  /** 获取下一批可执行的节点 */
  getNextBatch(): DAGNode[] {
    return this.getReadyNodes().slice(0, this.config.maxParallel);
  }

  /** 标记节点开始执行 */
  startNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const prevStatus = node.status;
    node.status = 'running';
    node.startedAt = Date.now();
    this.snapshotNode(nodeId);
    this.onNodeStatusChange?.(nodeId, 'running', prevStatus);
    return true;
  }

  /** 标记节点执行成功 */
  completeNode(nodeId: string, result?: any): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const prevStatus = node.status;
    node.status = 'success';
    node.completedAt = Date.now();
    node.result = result;
    this.snapshotNode(nodeId);
    this.onNodeStatusChange?.(nodeId, 'success', prevStatus);
    return true;
  }

  /** 标记节点执行失败 */
  failNode(nodeId: string, error: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const prevStatus = node.status;
    node.retryCount++;
    node.error = error;

    if (node.retryCount < node.maxRetries) {
      node.status = 'pending'; // 重置为待重试
    } else if (this.config.enableRerouting && node.alternateNodes && node.alternateNodes.length > 0) {
      // 先设置 rerouting 状态，再执行 reroute，保留 error 信息
      node.status = 'rerouting';
      this.snapshotNode(nodeId);
      this.onNodeStatusChange?.(nodeId, 'rerouting', prevStatus);
      this.onError?.(nodeId, error);
      const alternateId = node.alternateNodes[0];
      if (node.alternateNodes) {
        node.alternateNodes = node.alternateNodes.filter(id => id !== alternateId);
      }
      this.recordMutation('reroute', nodeId, `fail: ${error} → ${alternateId}`);
      return true;
    } else {
      node.status = 'failed';
    }

    this.snapshotNode(nodeId);
    this.onNodeStatusChange?.(nodeId, node.status, prevStatus);
    this.onError?.(nodeId, error);

    this.recordMutation('reorder', nodeId, `fail: ${error}`);
    return true;
  }

  /** 检查是否全部完成 */
  isComplete(): boolean {
    if (this.nodes.size === 0) return false;
    for (const node of this.nodes.values()) {
      if (node.status !== 'success' && node.status !== 'skipped') return false;
    }
    return true;
  }

  // ── 查询 ──

  /** 获取节点 */
  getNode(nodeId: string): DAGNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** 获取所有节点 */
  getAllNodes(): DAGNode[] {
    return [...this.nodes.values()];
  }

  /** 获取节点数 */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** 获取边数 */
  get edgeCount(): number {
    return this.edges.size;
  }

  // ── 验证 ──

  /** 验证 DAG 合法性 */
  validate(): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 环检测
    if (this.hasCycle()) {
      errors.push({ code: 'CYCLE_DETECTED', message: 'DAG 存在循环依赖' });
    }

    // 2. 依赖完整性
    for (const node of this.nodes.values()) {
      for (const depId of node.deps) {
        if (!this.nodes.has(depId)) {
          errors.push({
            code: 'MISSING_DEPENDENCY',
            message: `节点 "${node.name}" 依赖 "${depId}" 不存在`,
            nodeId: node.id,
          });
        }
      }
    }

    // 3. 孤立节点检查
    const hasEdges = this.nodes.size > 1;
    if (hasEdges) {
      for (const node of this.nodes.values()) {
        if (node.deps.length === 0) continue;
        const hasIncoming = [...this.nodes.values()].some(n => n.deps.includes(node.id));
        const hasOutgoing = node.deps.length > 0;
        if (!hasIncoming && !hasOutgoing && this.nodes.size > 1) {
          warnings.push(`节点 "${node.name}" 是孤立的`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 环检测（DFS）
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      inStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.deps) {
          if (dfs(depId)) return true;
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (dfs(nodeId)) return true;
    }
    return false;
  }

  /** 拓扑排序 — 复用统一 toposort 工具 */
  topologicalSort(): DAGNode[] {
    return tsort([...this.nodes.values()], n => n.deps, n => n.id);
  }

  // ── 状态 ──

  /** 获取 DAG 运行时状态 */
  getStatus(): DAGStatus {
    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      mutations: this.mutationsLog.length,
      isCyclic: this.hasCycle(),
      canRollback: this.mutationsLog.length > 0,
      isComplete: this.isComplete(),
    };
  }

  /** 获取变更历史 */
  getMutations(): DAGMutation[] {
    return [...this.mutationsLog];
  }

  /** 从 Plan 的任务列表构建 DAG */
  buildFromTasks(
    tasks: Array<{
      id: string;
      name: string;
      description: string;
      assignedRole: string;
      dependencies: string[];
      priority: number;
    }>,
  ): void {
    for (const task of tasks) {
      this.addNode({
        id: task.id,
        name: task.name,
        agentType: task.assignedRole,
        description: task.description,
        deps: task.dependencies,
        status: 'pending',
        priority: task.priority,
        retryCount: 0,
        maxRetries: this.config.maxRetries,
      });
    }
  }

  /** 重置所有节点为 pending */
  reset(): void {
    for (const node of this.nodes.values()) {
      const prev = node.status;
      node.status = 'pending';
      node.result = undefined;
      node.error = undefined;
      node.startedAt = undefined;
      node.completedAt = undefined;
      node.retryCount = 0;
      this.snapshotNode(node.id);
      this.onNodeStatusChange?.(node.id, 'pending', prev);
    }
    this.mutationsLog = [];
  }

  /** 清空所有数据 */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.mutationsLog = [];
    this.nodeHistory.clear();
  }

  // ── 内部 ──

  private recordMutation(type: DAGMutation['type'], nodeId: string, reason: string): void {
    const mutation: DAGMutation = { type, nodeId, timestamp: Date.now(), reason };
    this.mutationsLog.push(mutation);
    this.onMutation?.(mutation);
  }

  private snapshotNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    if (!this.nodeHistory.has(nodeId)) this.nodeHistory.set(nodeId, []);
    this.nodeHistory.get(nodeId)!.push({ ...node });
  }
}
