/**
 * ExecutionGraph — 执行图追踪引擎
 *
 * DAG 的运行时对偶。DAG 是计划（应该发生什么），
 * Execution Graph 是实际（真正发生了什么）。
 *
 * 关键区别：
 *   DAG（计划）:              Execution Graph（实际）:
 *     A                         A
 *     │                         │
 *     ▼                         ▼
 *     B                         B
 *     │                         │
 *     ▼                     ┌───┴───┐
 *     C                     B(retry) C
 *                            │       │
 *                            ▼       ▼
 *                         B(failed)  D
 *                            │
 *                            ▼
 *                       human approve
 *                            │
 *                            ▼
 *                            C(redo)
 *
 * 设计约束：
 *   - 只记录，不控制（observer 模式）
 *   - 每个节点执行产生一条记录
 *   - 重试、失败、人工干预都被记录为独立节点
 */

import type {
  ExecGraphNode,
  ExecGraphEdge,
  ExecutionGraph,
  ExecNodeStatus,
  ExecGraphStats,
} from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG = {
  maxRetainedGraphs: 100,
  recordDetailedData: true,
};

/**
 * ExecutionGraph — 执行图追踪引擎
 *
 * 监听 runtime.* 事件，构建实际执行图。
 * 维护多个执行图实例（按 executionId 索引）。
 */
export class ExecutionGraphEngine {
  private graphs: Map<string, ExecutionGraph> = new Map();
  private config: typeof DEFAULT_CONFIG;

  /** 外部回调 */
  onNodeCreated: ((executionId: string, node: ExecGraphNode) => void) | null = null;
  onNodeStatusChanged: ((executionId: string, nodeId: string, status: string, prevStatus: string) => void) | null = null;
  onEdgeCreated: ((executionId: string, edge: ExecGraphEdge) => void) | null = null;
  onGraphCompleted: ((executionId: string, graph: ExecutionGraph) => void) | null = null;

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 执行图生命周期 ──

  /** 开始新的执行追踪 */
  startExecution(executionId: string, dagId: string, goal: string): ExecutionGraph {
    // 检查上限
    if (this.graphs.size >= this.config.maxRetainedGraphs) {
      // 移除最早的图
      const oldest = [...this.graphs.entries()]
        .sort(([, a], [, b]) => a.startedAt - b.startedAt)[0];
      if (oldest) this.graphs.delete(oldest[0]);
    }

    const graph: ExecutionGraph = {
      executionId,
      dagId,
      goal,
      nodes: [],
      edges: [],
      startedAt: Date.now(),
      success: false,
      status: 'running',
    };

    this.graphs.set(executionId, graph);
    return graph;
  }

  /** 完成执行追踪 */
  completeExecution(executionId: string, success: boolean): void {
    const graph = this.graphs.get(executionId);
    if (!graph) return;

    graph.completedAt = Date.now();
    graph.totalDuration = graph.completedAt - graph.startedAt;
    graph.success = success;
    graph.status = success ? 'completed' : 'failed';

    this.onGraphCompleted?.(executionId, graph);
  }

  // ── 节点操作 ──

  /** 创建执行节点 */
  createNode(
    executionId: string,
    overrides: {
      dagNodeId: string;
      name: string;
      attempt?: number;
      isRetry?: boolean;
      type?: ExecGraphNode['type'];
    },
  ): ExecGraphNode {
    const graph = this.getOrCreateGraph(executionId);

    const node: ExecGraphNode = {
      id: `egn_${executionId}_${overrides.dagNodeId}_${overrides.attempt ?? 0}`,
      dagNodeId: overrides.dagNodeId,
      name: overrides.name,
      status: 'pending',
      startedAt: Date.now(),
      attempt: overrides.attempt ?? 0,
      isRetry: overrides.isRetry ?? false,
      type: overrides.type ?? 'task',
    };

    graph.nodes.push(node);
    this.onNodeCreated?.(executionId, node);
    return node;
  }

  /** 更新节点状态 */
  updateNodeStatus(
    executionId: string,
    nodeId: string,
    newStatus: string,
    data?: { result?: any; error?: string },
  ): void {
    const graph = this.graphs.get(executionId);
    if (!graph) return;

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const prevStatus = node.status;
    node.status = newStatus as import('./types.js').ExecNodeStatus;

    if (newStatus === 'running') {
      node.startedAt = Date.now();
    }

    if (newStatus === 'completed' || newStatus === 'failed') {
      node.completedAt = Date.now();
      node.duration = node.completedAt - node.startedAt;
      if (data?.result) node.result = data.result;
      if (data?.error) node.error = data.error;
    }

    if (newStatus === 'failed') {
      node.error = data?.error ?? 'unknown error';
    }

    this.onNodeStatusChanged?.(executionId, nodeId, newStatus, prevStatus);
  }

  /** 记录重试 */
  recordRetry(executionId: string, dagNodeId: string, name: string, attempt: number, error: string): ExecGraphNode {
    // 上一个尝试标记为 failed
    const prevNodeId = `egn_${executionId}_${dagNodeId}_${attempt - 1}`;
    this.updateNodeStatus(executionId, prevNodeId, 'failed', { error });

    // 创建重试节点
    const retryNode = this.createNode(executionId, {
      dagNodeId,
      name: `${name} (重试 #${attempt + 1})`,
      attempt,
      isRetry: true,
      type: 'retry',
    });

    // 创建重试边
    this.createEdge(executionId, prevNodeId, retryNode.id, 'retry');

    return retryNode;
  }

  /** 记录人工干预点 */
  recordHumanReview(executionId: string, dagNodeId: string, name: string, approved: boolean): ExecGraphNode {
    const node = this.createNode(executionId, {
      dagNodeId,
      name: `${name} (人工审批)`,
      type: 'human_review',
      attempt: 0,
    });

    node.status = 'human_review';
    this.onNodeStatusChanged?.(executionId, node.id, 'human_review', 'pending');

    return node;
  }

  // ── 边操作 ──

  /** 创建执行边 */
  createEdge(executionId: string, from: string, to: string, reason: ExecGraphEdge['reason']): ExecGraphEdge {
    const graph = this.graphs.get(executionId);
    if (!graph) throw new Error(`执行图 ${executionId} 不存在`);

    const edge: ExecGraphEdge = { from, to, reason, timestamp: Date.now() };
    graph.edges.push(edge);
    this.onEdgeCreated?.(executionId, edge);
    return edge;
  }

  // ── 查询 ──

  /** 获取执行图 */
  getGraph(executionId: string): ExecutionGraph | undefined {
    return this.graphs.get(executionId);
  }

  /** 获取某 DAG 节点在 Execution Graph 中的所有实例（含重试） */
  getNodeInstances(executionId: string, dagNodeId: string): ExecGraphNode[] {
    const graph = this.graphs.get(executionId);
    if (!graph) return [];
    return graph.nodes.filter(n => n.dagNodeId === dagNodeId);
  }

  /** 获取所有活跃（运行中）的执行图 */
  getActiveGraphs(): ExecutionGraph[] {
    return [...this.graphs.values()].filter(g => g.status === 'running');
  }

  /** 获取所有执行图 */
  getAllGraphs(): ExecutionGraph[] {
    return [...this.graphs.values()];
  }

  /** 获取统计 */
  getStats(): ExecGraphStats {
    const allGraphs = [...this.graphs.values()];
    const completed = allGraphs.filter(g => g.status === 'completed' || g.status === 'failed');

    let totalNodes = 0;
    let totalRetries = 0;
    let totalHumanReviews = 0;
    let totalDuration = 0;

    for (const g of allGraphs) {
      totalNodes += g.nodes.length;
      totalRetries += g.nodes.filter(n => n.isRetry).length;
      totalHumanReviews += g.nodes.filter(n => n.type === 'human_review').length;
      if (g.totalDuration) totalDuration += g.totalDuration;
    }

    const successCount = completed.filter(g => g.success).length;

    return {
      totalExecutions: allGraphs.length,
      totalNodes,
      totalRetries,
      totalHumanReviews,
      avgDuration: completed.length > 0 ? totalDuration / completed.length : 0,
      successRate: completed.length > 0 ? successCount / completed.length : 0,
    };
  }

  // ── 内部 ──

  private getOrCreateGraph(executionId: string): ExecutionGraph {
    let graph = this.graphs.get(executionId);
    if (!graph) {
      graph = this.startExecution(executionId, executionId, '');
    }
    return graph;
  }

  /** 清空所有执行图 */
  clear(): void {
    this.graphs.clear();
  }

  /** 删除指定执行图 */
  removeGraph(executionId: string): boolean {
    return this.graphs.delete(executionId);
  }
}
