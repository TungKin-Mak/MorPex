/**
 * Execution Graph — 类型定义
 *
 * Execution Graph 是 DAG 的运行时对偶。
 * DAG = 计划（plan），Execution Graph = 实际（reality）。
 * 记录每次执行的真实轨迹，包含重试、失败、人工干预。
 */

// ── 执行节点状态 ──

/** 执行节点状态（比 DAG 状态多 paused、human_review） */
export type ExecNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'human_review';

// ── 执行节点 ──

/** 执行图节点（一次实际执行记录） */
export interface ExecGraphNode {
  /** 节点 ID */
  id: string;
  /** 对应 DAG 节点 ID */
  dagNodeId: string;
  /** 节点名称 */
  name: string;
  /** 状态 */
  status: ExecNodeStatus;
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  completedAt?: number;
  /** 耗时（毫秒） */
  duration?: number;
  /** 执行结果 */
  result?: any;
  /** 错误信息 */
  error?: string;
  /** 重试次数（从 0 开始） */
  attempt: number;
  /** 是否为重试节点 */
  isRetry: boolean;
  /** 执行节点类型 */
  type: 'task' | 'retry' | 'human_review' | 'reroute' | 'fallback';
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ── 执行边 ──

/** 执行边（记录实际流转关系） */
export interface ExecGraphEdge {
  from: string;
  to: string;
  /** 流转原因 */
  reason: 'depends_on' | 'retry' | 'reroute' | 'human_approve' | 'human_reject' | 'fallback';
  timestamp: number;
}

// ── 执行图 ──

/** 执行图（一次完整执行的记录） */
export interface ExecutionGraph {
  /** 执行 ID */
  executionId: string;
  /** 对应 DAG ID */
  dagId: string;
  /** 目标 */
  goal: string;
  /** 节点列表 */
  nodes: ExecGraphNode[];
  /** 边列表 */
  edges: ExecGraphEdge[];
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  completedAt?: number;
  /** 总耗时 */
  totalDuration?: number;
  /** 是否成功 */
  success: boolean;
  /** 状态 */
  status: 'running' | 'completed' | 'failed' | 'aborted';
}

// ── 执行图统计 ──

/** 执行图统计 */
export interface ExecGraphStats {
  totalExecutions: number;
  totalNodes: number;
  totalRetries: number;
  totalHumanReviews: number;
  avgDuration: number;
  successRate: number;
}

// ── 配置 ──

/** Execution Graph Plugin 配置 */
export interface ExecGraphPluginConfig {
  /** 最大保留执行图数（默认 100） */
  maxRetainedGraphs?: number;
  /** 是否记录详细节点数据 */
  recordDetailedData?: boolean;
}
