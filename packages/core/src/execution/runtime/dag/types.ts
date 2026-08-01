/**
 * DAG Plugin — 类型定义
 *
 * DAG 节点、边、验证、状态相关类型。
 * 从 src/core/types.ts 中的 AdaptiveDAGNode 等类型迁移。
 */

// ── DAG 节点 ──

/** DAG 节点运行时状态 */
export type DAGNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'rerouting';

/** DAG 节点 */
export interface DAGNode {
  id: string;
  name: string;
  agentType: string;
  description: string;
  deps: string[];
  status: DAGNodeStatus;
  priority: number;
  retryCount: number;
  maxRetries: number;
  result?: any;
  error?: string;
  alternateNodes?: string[];
  startedAt?: number;
  completedAt?: number;
  cost?: number;
  metadata?: Record<string, any>;
}

// ── DAG 边 ──

/** DAG 边 */
export interface DAGEdge {
  from: string;
  to: string;
  weight: number;
}

// ── DAG 操作 ──

/** DAG 变更事件 */
export interface DAGMutation {
  type: 'insert' | 'remove' | 'reroute' | 'reorder';
  nodeId: string;
  timestamp: number;
  reason: string;
}

// ── DAG 状态 ──

/** DAG 运行时状态 */
export interface DAGStatus {
  totalNodes: number;
  totalEdges: number;
  mutations: number;
  isCyclic: boolean;
  canRollback: boolean;
  isComplete: boolean;
}

// ── 验证 ──

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/** 验证错误 */
export interface ValidationError {
  code: string;
  message: string;
  nodeId?: string;
}

// ── DAG 引擎配置 ──

/** DAG 引擎配置 */
export interface DAGEngineConfig {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 是否启用自动重路由 */
  enableRerouting?: boolean;
  /** 最大并行执行节点数 */
  maxParallel?: number;
}

// ── DAG 插件配置 ──

/** DAG Plugin 配置 */
export interface DAGPluginConfig {
  engine?: DAGEngineConfig;
}

// ── 执行计划 ──

/** 从 Plan 转换来的执行 DAG */
export interface ExecutionDAG {
  id: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  status: DAGStatus;
  createdAt: number;
}
