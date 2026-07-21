import type { DAGNode } from '../../../planes/runtime-kernel/dag/types.js';
import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { Milestone } from './config.js';

// ═══════════════════════════════════════════════════════════════
// Section 7: v2 扩展 - 前瞻模拟类型 (LookAheadSimulator)
// ═══════════════════════════════════════════════════════════════

/**
 * SimulationReport — 前瞻模拟报告
 *
 * LookAheadSimulator 对生成的 DAG 进行模拟推演，
 * 评估风险、检测死锁、给出建议。
 */
export interface SimulationReport {
  /** 综合风险评分 (0-1) */
  overallRiskScore: number;

  /** 高风险节点列表 */
  riskNodes: RiskNode[];

  /** 死锁警告列表 */
  deadlockWarnings: DeadlockWarning[];

  /** 优化建议列表 */
  recommendations: SimulationRecommendation[];

  /** 模拟执行时间 */
  simulatedAt: number;

  /** 模拟用时（毫秒） */
  durationMs: number;

  /** 如果 rejected，给出原因 */
  rejectionReason?: string;
}

/**
 * RiskNode — 风险节点
 */
export interface RiskNode {
  /** 节点 ID */
  nodeId: string;

  /** 风险类型 */
  riskType: 'deadlock_candidate' | 'high_failure_rate' | 'long_running' | 'excessive_tokens' | 'missing_dependency';

  /** 风险评分 (0-1) */
  riskScore: number;

  /** 风险原因 */
  reason: string;

  /** 历史数据支撑 */
  evidence?: {
    historicalFailureRate?: number;
    historicalAvgDuration?: number;
    similarRecordCount?: number;
  };
}

/**
 * DeadlockWarning — 死锁警告
 */
export interface DeadlockWarning {
  /** 形成循环的节点 ID 列表 */
  cycleNodes: string[];

  /** 死锁概率 (0-1) */
  probability: number;

  /** 检测依据 */
  basis: string;
}

/**
 * SimulationRecommendation — 模拟建议
 */
export interface SimulationRecommendation {
  /** 建议操作 */
  action: 'rework' | 'add_validation' | 'increase_timeout' | 'mark_optional' | 'split_node' | 'add_dependency';

  /** 目标节点 ID */
  targetNodeId: string;

  /** 建议理由 */
  reason: string;

  /** 预期改善幅度 (0-1) */
  expectedImprovement: number;
}

// ═══════════════════════════════════════════════════════════════
// Section 8: v2 扩展 - 动态反射/重规划类型 (DynamicReflexEngine)
// ═══════════════════════════════════════════════════════════════

/**
 * DAGPatch — 运行时热修补指令集
 *
 * DynamicReflexEngine 在检测到运行时偏离时，
 * 生成 DAGPatch 并通过 DAGEngine 的现有方法（removeNode/addNode/insertAfter/rerouteNode）
 * 对未执行的 DAG 拓扑进行修正。
 */
export interface DAGPatch {
  /** 补丁唯一 ID */
  patchId: string;

  /** 触发原因 */
  reason: string;

  /** 触发时间 */
  timestamp: number;

  /** 修补操作列表 */
  operations: DAGPatchOperation[];

  /** 受影响的节点 ID 列表 */
  affectedNodes: string[];
}

/**
 * DAGPatchOperation — 单次修补操作
 */
export interface DAGPatchOperation {
  /** 操作类型 */
  type: 'remove_node' | 'add_node' | 'insert_after' | 'reroute';

  /** 目标节点 ID */
  nodeId: string;

  /** 操作负载 */
  payload?: {
    /** 新增/替换的节点定义（用于 add_node / insert_after） */
    newNode?: DAGNode;
    /** 插入锚点（用于 insert_after） */
    afterNodeId?: string;
    /** 备选节点 ID（用于 reroute） */
    alternateNodeId?: string;
  };
}

/**
 * DeviationEvent — MemoryBus 偏离事件载荷
 *
 * Context Intelligence 推送的运行时状态偏离事件。
 * DynamicReflexEngine 订阅此事件并触发局部重规划。
 */
export interface DeviationEvent {
  /** 事件类型 */
  type: 'STATE_DEVIATION' | 'SELF_HEALING_FAILED' | 'NODE_FAILED' | 'ARTIFACT_MISSING';

  /** Session ID */
  sessionId: string;

  /** 执行 ID */
  executionId: string;

  /** 事件时间 */
  timestamp: number;

  /** 事件载荷 */
  payload: {
    /** 偏离分数 (0-1) */
    deviationScore?: number;
    /** 失败节点 ID */
    failedNodeId?: string;
    /** 失败原因 */
    failureReason?: string;
    /** 缺失产物 ID */
    missingArtifactId?: string;
    /** 自愈状态 */
    healingStatus?: string;
    /** 其他上下文 */
    [key: string]: unknown;
  };
}

/**
 * RuntimeEventResult — onRuntimeEvent 扩展的返回值
 */
export interface RuntimeEventResult {
  /** 是否已处理 */
  handled: boolean;
  /** 执行的动作（扩展灵活性：预定义常用动作，也接受自定义字符串） */
  action: string;
  /** 应用的热修补（如果有） */
  patch?: DAGPatch;
  /** 未处理的原因 */
  reason?: string;
}

/**
 * MemoryBusLogEntry — MemoryBus JSONL 追踪条目
 *
 * DynamicReflexEngine 每次成功执行 hotPatch 后，
 * 必须调用 MemoryBus.appendLog() 写入此条目，确保谱系完整。
 */
export interface MemoryBusLogEntry {
  sessionId: string;
  executionId: string;
  intervention: string;
  reason: string;
  timestamp: number;
  affectedNodes: string[];
  patchDetails: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// Section 9: v2 扩展 - 生命周期拦截上下文类型
// ═══════════════════════════════════════════════════════════════

/**
 * PrePlanContext — onPrePlan 扩展上下文
 *
 * DAG Generator 运行前，包含原始输入和系统资源引用。
 */
export interface PrePlanContext {
  sessionId: string;
  executionId: string;
  userInput: string;
  tags: string[];
  sessionContext?: Record<string, unknown>;
  /** KnowledgeGraph 引用（可选注入） */
  knowledgeGraph?: {
    searchEntities: (query: Record<string, unknown>) => Array<Record<string, unknown>>;
    getNeighborhood: (entityId: string, depth?: number) => { entities: Array<Record<string, unknown>>; relations: Array<Record<string, unknown>> };
    findPath: (fromId: string, toId: string) => Record<string, unknown> | null;
  };
  /** ArtifactRegistry 引用（可选注入） */
  artifactRegistry?: {
    search?: (query: Record<string, unknown>) => Array<Record<string, unknown>>;
    listByDomain?: (domainId: string) => Array<Record<string, unknown>>;
  };
}

/**
 * PrePlanResult — onPrePlan 扩展的返回值
 */
export interface PrePlanResult {
  /**
   * 增强后的上下文注入内容
   * 可以传 string[]（简单 hint 列表）或 Record<string, unknown>（结构化上下文）
   */
  enrichedContext?: string[] | Record<string, unknown>;
  /** 战略拆解的里程碑列表 */
  milestones?: Milestone[];
}

/**
 * PostPlanContext — onPostPlan 扩展上下文
 *
 * DAG 生成后、正式执行前，包含生成的 DAG 和里程碑信息。
 */
export interface PostPlanContext {
  sessionId: string;
  executionId: string;
  userInput: string;
  tags: string[];
  /** 生成的执行 DAG */
  dag: ExecutionDAG;
  /** 战略拆解的里程碑（如果有） */
  milestones?: Milestone[];
}

/**
 * PostPlanResult — onPostPlan 扩展的返回值
 */
export interface PostPlanResult {
  /** 是否拒绝此 DAG（打回重构） */
  rejected?: boolean;
  /** 拒绝原因 */
  rejectionReasons?: string[];
  /** 模拟报告 */
  simulationReport?: SimulationReport;
  /** 对 DAG 的增强建议 */
  enrichedPlan?: Partial<ExecutionDAG> & { additionalInstructions?: string[] };
}

/**
 * RuntimeEventContext — onRuntimeEvent 扩展上下文
 *
 * 运行时 MemoryBus 事件触发，包含事件详情和运行时引用。
 */
export interface RuntimeEventContext {
  sessionId: string;
  executionId: string;
  /** 原始 MemoryBus 偏离事件 */
  event: DeviationEvent;
  /** DAGEngine 引用（可选注入，用于 hotPatch） */
  dagEngine?: {
    getNode: (nodeId: string) => Record<string, unknown> | undefined;
    getAllNodes: () => Array<Record<string, unknown>>;
    removeNode: (nodeId: string) => boolean;
    addNode: (node: Record<string, unknown>) => boolean;
    insertAfter: (afterNodeId: string, newNode: Record<string, unknown>) => boolean;
    rerouteNode: (nodeId: string, alternateId?: string) => boolean;
    validate: () => { valid: boolean; errors: string[] };
    getStatus: () => Record<string, unknown>;
  };
}

