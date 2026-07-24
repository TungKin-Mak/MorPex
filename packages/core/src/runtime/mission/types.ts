/**
 * Mission Runtime — 任务/使命数据类型定义
 *
 * Phase 3 / MorPex v8: Mission 是用户意图的顶级抽象。
 *
 * 设计原则：
 *   1. 每个用户意图实例化为一个 Mission
 *   2. Mission 有完整的业务生命周期（MissionState 枚举）
 *   3. Mission 拥有 Plan（策略层）和 Execution（执行层）
 *   4. Mission 携带权限上下文（approval / allowedTools）
 *
 * 与现有 ExecutionFSM（agent-level）的关系：
 *   - MissionState 是业务级状态（用户视角）
 *   - ExecutionState 是引擎级状态（Agent/节点视角）
 *   - Mission 的 PLANNING 阶段可触发 MetaPlanner 的 7-Stage Pipeline
 *   - Mission 的 EXECUTING 阶段可包含多个 ExecutionFSM 实例
 */

// ═══════════════════════════════════════════════════════════════
// MissionState — 业务级生命周期
// ═══════════════════════════════════════════════════════════════

/**
 * MissionState — Mission 的业务级状态 (v8.9)
 *
 * ★ 核心改进: FAILED 拆分为 TASK_FAILED + MISSION_FAILED。
 *   一次 Task 失败不代表 Mission 失败（DAG 可以 retry）。
 *   TASK_FAILED 是中间态，MISSION_FAILED 是终态。
 *
 * 成功路径:
 *   CREATED → VALIDATING → PLANNING → EXECUTING → VERIFYING → COMPLETED
 *
 * 任务失败 (可恢复):
 *   EXECUTING → TASK_FAILED → RECOVERING → RETRYING → EXECUTING
 *                       ↓
 *                   MISSION_FAILED (放弃恢复)
 *
 * 验证失败:
 *   VERIFYING → REJECTED → COMPENSATING → ROLLED_BACK
 *
 * 暂停/审查:
 *   PAUSED → HUMAN_REVIEW → EXECUTING | CANCELLED
 */
export enum MissionState {
  /** Mission 已创建，等待规划 */
  CREATED = 'CREATED',
  /** v14: 目标理解阶段 — Goal Intelligence 解析用户意图 */
  UNDERSTANDING = 'UNDERSTANDING',
  /** v14: 目标理解阶段 — Goal Intelligence 解析用户意图 */
  /** 合同验证阶段 */
  VALIDATING = 'VALIDATING',
  /** 正在生成执行计划 */
  PLANNING = 'PLANNING',
  /** 计划正在执行（DAG 执行中） */
  EXECUTING = 'EXECUTING',
  /** ★ v9: Agent 分配阶段 — 正在为任务分配 Agent */
  AGENT_ASSIGNING = 'AGENT_ASSIGNING',
  /** ★ v9: Agent 执行阶段 — Agent 正在执行任务 */
  AGENT_EXECUTING = 'AGENT_EXECUTING',
  /** ★ v9: Agent 替换阶段 — 失败 Agent 正在被替换 */
  AGENT_REPLACING = 'AGENT_REPLACING',
  /** ★ v9: 协作阶段 — 多个 Agent 协作执行 */
  COLLABORATING = 'COLLABORATING',
  /** 等待人工审批（高风险操作） */
  WAIT_APPROVAL = 'WAIT_APPROVAL',
  /** v14: 产物生成阶段 — 执行完成后生成可交付物 */
  ARTIFACT_GENERATING = 'ARTIFACT_GENERATING',
  /** v14: 产物生成阶段 — 执行完成后自动生成可交付物 */
  /** 执行完成，正在验证结果 */
  VERIFYING = 'VERIFYING',
  /** 补偿/回滚阶段 */
  COMPENSATING = 'COMPENSATING',
  /** 已回滚: 补偿完成 */
  ROLLED_BACK = 'ROLLED_BACK',
  /** 已拒绝: 验证未通过 */
  REJECTED = 'REJECTED',
  /** 恢复阶段: 故障后尝试自动恢复 */
  RECOVERING = 'RECOVERING',
  /** 重试阶段: 恢复后重新执行 */
  RETRYING = 'RETRYING',
  /** 暂停: 等待人工干预 */
  PAUSED = 'PAUSED',
  /** 人工审查: 需要人工决定 */
  HUMAN_REVIEW = 'HUMAN_REVIEW',
  /** ★ v8.9: 单任务失败 (中间态, 可恢复) */
  TASK_FAILED = 'TASK_FAILED',
  /** ⭐ (向后兼容) 执行失败 — 可进入 RECOVERING 尝试恢复 */
  FAILED = 'FAILED',
  /** ★ v8.9: Mission 整体失败 (终态, 不可恢复) */
  MISSION_FAILED = 'MISSION_FAILED',
  /** ★ v8.9.2: 已升级 — 自动恢复失败, 等待人工介入 */
  ESCALATED = 'ESCALATED',
    /** ★ v8.9.2: 已终止 — 补偿/回滚完成后的终态 */
  TERMINATED = 'TERMINATED',
  /** ★ v10: 仿真推演阶段 — 执行前预测质量 */
  SIMULATING = 'SIMULATING',
  /** ★ v10: 已预测 — 仿真完成等待审批 */
  PREDICTED = 'PREDICTED',
  /** ★ v10: 审批待定 — Policy 审批后执行 */
  APPROVAL_PENDING = 'APPROVAL_PENDING',
  /** ★ v10: 行为验证阶段 — 验证运行时行为 */
  VERIFYING_BEHAVIOR = 'VERIFYING_BEHAVIOR',
  /** ★ v10: 质量评分阶段 — 执行后质量评估 */
  QUALITY_SCORING = 'QUALITY_SCORING',
  /** 成功完成 */
  COMPLETED = 'COMPLETED',
  /** 被用户取消 */
  CANCELLED = 'CANCELLED',
}

/** 有效状态转换映射 (v8.9) */
export const MISSION_VALID_TRANSITIONS: Record<MissionState, MissionState[]> = {
  // 创建后验证或直接规划
  [MissionState.CREATED]:       [MissionState.UNDERSTANDING, MissionState.VALIDATING, MissionState.PLANNING, MissionState.SIMULATING, MissionState.CANCELLED],
  // 验证通过 → 规划，失败 → MISSION_FAILED (终态)
  [MissionState.VALIDATING]:    [MissionState.PLANNING, MissionState.MISSION_FAILED, MissionState.CANCELLED],
  // PLANNING → 可进入仿真 → 预测 → 审批 → 执行
  [MissionState.PLANNING]:      [MissionState.SIMULATING, MissionState.EXECUTING, MissionState.WAIT_APPROVAL, MissionState.VALIDATING, MissionState.MISSION_FAILED, MissionState.CANCELLED],
  // ★ v10: 仿真推演 → 预测完成 → 审批待定
  [MissionState.SIMULATING]:    [MissionState.PREDICTED, MissionState.PLANNING, MissionState.MISSION_FAILED, MissionState.CANCELLED],
  // ★ v10: 预测完成 → 审批待定或直接执行
  [MissionState.PREDICTED]:     [MissionState.APPROVAL_PENDING, MissionState.EXECUTING, MissionState.PLANNING, MissionState.CANCELLED],
  // ★ v10: 审批待定 → 执行或拒绝
  [MissionState.APPROVAL_PENDING]: [MissionState.EXECUTING, MissionState.PLANNING, MissionState.CANCELLED],
  // 执行中: 正常→VERIFYING→VERIFYING_BEHAVIOR→QUALITY_SCORING, 单任务失败→TASK_FAILED
  [MissionState.EXECUTING]:     [MissionState.ARTIFACT_GENERATING, MissionState.AGENT_ASSIGNING, MissionState.AGENT_EXECUTING, MissionState.COLLABORATING, MissionState.WAIT_APPROVAL, MissionState.VERIFYING, MissionState.VERIFYING_BEHAVIOR, MissionState.TASK_FAILED, MissionState.FAILED, MissionState.MISSION_FAILED, MissionState.CANCELLED],
  // v14: 目标理解 → 规划
  [MissionState.UNDERSTANDING]:  [MissionState.PLANNING, MissionState.CANCELLED],
  // v14: 产物生成 → 验证或完成
  [MissionState.ARTIFACT_GENERATING]: [MissionState.VERIFYING, MissionState.COMPLETED, MissionState.FAILED, MissionState.CANCELLED],
  // v9 Agent 分配状态
  [MissionState.AGENT_ASSIGNING]: [MissionState.AGENT_EXECUTING, MissionState.COLLABORATING, MissionState.TASK_FAILED, MissionState.CANCELLED],
  // v9 Agent 执行状态
  [MissionState.AGENT_EXECUTING]: [MissionState.VERIFYING, MissionState.AGENT_REPLACING, MissionState.TASK_FAILED, MissionState.MISSION_FAILED],
  // v9 Agent 替换状态
  [MissionState.AGENT_REPLACING]: [MissionState.AGENT_EXECUTING, MissionState.TASK_FAILED, MissionState.MISSION_FAILED, MissionState.CANCELLED],
  // v9 协作状态
  [MissionState.COLLABORATING]:   [MissionState.AGENT_EXECUTING, MissionState.VERIFYING, MissionState.TASK_FAILED, MissionState.MISSION_FAILED],
  [MissionState.WAIT_APPROVAL]: [MissionState.EXECUTING, MissionState.CANCELLED],
  // 验证结果: 通过→QUALITY_SCORING 或 COMPLETED, 不通过→REJECTED
  [MissionState.VERIFYING]:     [MissionState.QUALITY_SCORING, MissionState.VERIFYING_BEHAVIOR, MissionState.COMPLETED, MissionState.REJECTED, MissionState.TASK_FAILED, MissionState.FAILED, MissionState.EXECUTING],
  // ★ v10: 行为验证 → 质量评分
  [MissionState.VERIFYING_BEHAVIOR]: [MissionState.QUALITY_SCORING, MissionState.COMPLETED, MissionState.REJECTED, MissionState.EXECUTING],
  // ★ v10: 质量评分 → 完成
  [MissionState.QUALITY_SCORING]: [MissionState.COMPLETED, MissionState.REJECTED, MissionState.EXECUTING],
  // 补偿后→ROLLED_BACK 或 MISSION_FAILED
  [MissionState.COMPENSATING]:  [MissionState.ROLLED_BACK, MissionState.MISSION_FAILED, MissionState.CANCELLED],
  [MissionState.ROLLED_BACK]:   [MissionState.TERMINATED],
  [MissionState.TERMINATED]:    [],
  [MissionState.REJECTED]:      [MissionState.COMPENSATING, MissionState.CANCELLED],
  // 恢复/重试循环 → 自动恢复失败后升级
  [MissionState.RECOVERING]:    [MissionState.RETRYING, MissionState.COMPENSATING, MissionState.ESCALATED],
  [MissionState.RETRYING]:      [MissionState.EXECUTING, MissionState.TASK_FAILED, MissionState.MISSION_FAILED],
  [MissionState.PAUSED]:        [MissionState.EXECUTING, MissionState.ESCALATED, MissionState.CANCELLED],
  // ESCALATED → 人工介入, 决定下一步
  [MissionState.ESCALATED]:     [MissionState.HUMAN_REVIEW, MissionState.COMPENSATING, MissionState.CANCELLED],
  [MissionState.HUMAN_REVIEW]:  [MissionState.EXECUTING, MissionState.COMPENSATING, MissionState.CANCELLED],
  // FAILED (向后兼容): 可恢复或放弃
  [MissionState.FAILED]:        [MissionState.RECOVERING, MissionState.COMPENSATING, MissionState.ESCALATED, MissionState.MISSION_FAILED],
  // TASK_FAILED: 可恢复或放弃
  [MissionState.TASK_FAILED]:   [MissionState.RECOVERING, MissionState.ESCALATED, MissionState.MISSION_FAILED],
  // MISSION_FAILED: 终态
  [MissionState.MISSION_FAILED]: [],
  [MissionState.COMPLETED]:     [],
  [MissionState.CANCELLED]:     [],
};

// ═══════════════════════════════════════════════════════════════
// Mission — 核心数据对象
// ═══════════════════════════════════════════════════════════════

/**
 * Mission — 任务/使命对象
 *
 * 用户的每个意图都映射为一个 Mission。
 * 例: "准备投资人会议" → Mission { goal: "准备投资人会议", ... }
 */
export interface Mission {
  /** 唯一标识（mis_{YYYYMMDD}_{shortUUID}） */
  id: string;

  /** 用户目标描述（原始用户意图） */
  goal: string;

  /** 用户 ID */
  owner: string;

  /** 上下文来源 */
  context: MissionContext;

  /** 当前状态 */
  state: MissionState;

  /** 执行计划（由 Planner 提供） */
  plan?: MissionPlan;

  /** DAG 执行 ID（由 Executor 创建） */
  executionId?: string;

  /** 权限设置 */
  permissions: MissionPermissions;

  /** 创建时间 */
  createdAt: number;

  /** 最近更新时间 */
  updatedAt: number;

  /** 完成时间 */
  completedAt?: number;

  /** 错误信息 */
  error?: string;

  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

/**
 * MissionContext — Mission 的来源上下文
 */
export interface MissionContext {
  /** 消息来源渠道（'web' | 'wechat' | 'feishu' | 'cli'） */
  channel: string;

  /** 会话标识 */
  sessionId: string;

  /** 触发 Mission 的原始消息 */
  originalMessage: string;

  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

/**
 * MissionPermissions — Mission 的权限配置
 */
export interface MissionPermissions {
  /** 是否允许自动执行（无需审批） */
  allowAutoExecute: boolean;

  /** 是否需要人工审批 */
  requireApproval: boolean;

  /** 允许使用的工具列表 */
  allowedTools: string[];
}

// ═══════════════════════════════════════════════════════════════
// MissionPlan — 执行计划
// ═══════════════════════════════════════════════════════════════

/**
 * MissionPlan — Mission 的执行计划
 *
 * 由 Planner 生成的策略层输出。
 * 后续将转换为 ExecutionDAG 交给 DAGRuntime 执行。
 */
export interface MissionPlan {
  /** 计划唯一标识 */
  id: string;

  /** 所属 Mission ID */
  missionId: string;

  /** 计划步骤列表 */
  steps: PlanStep[];

  /** 预估执行时长（毫秒） */
  estimatedDuration: number;

  /** 风险评估 */
  riskLevel: 'low' | 'medium' | 'high';

  /** 规划推理过程 */
  reasoning: string;
}

/**
 * PlanStep — 计划中的单个步骤
 *
 * 后续将转换为 DAG 节点（ExecutionDAG node）。
 */
export interface PlanStep {
  /** 步骤唯一标识 */
  id: string;

  /** 步骤名称 */
  name: string;

  /** 步骤描述 */
  description: string;

  /** 负责执行的领域 */
  domain: string;

  /** Agent 类型 */
  agentType: string;

  /** 依赖的上游步骤 ID 列表 */
  deps: string[];

  /** 优先级（数值越低优先级越高） */
  priority: number;
}

// ═══════════════════════════════════════════════════════════════
// MissionResult — 执行结果
// ═══════════════════════════════════════════════════════════════

/**
 * MissionResult — Mission 执行结果
 *
 * 由 Executor 返回给 MissionRuntime。
 */
export interface MissionResult {
  /** Mission ID */
  missionId: string;

  /** 最终状态 */
  state: MissionState;

  /** 已完成步骤数 */
  stepsCompleted: number;

  /** 总步骤数 */
  stepsTotal: number;

  /** 执行输出 */
  output?: unknown;

  /** 产物引用列表（artifact:// URI） */
  artifacts: string[];

  /** 执行耗时（毫秒） */
  duration: number;

  /** 错误信息 */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// MissionStateTransitionEvent — 状态转换事件载荷
// ═══════════════════════════════════════════════════════════════

/**
 * MissionStateTransitionEvent — Mission 状态转换事件载荷
 *
 * 通过 EventBus 发射，供观察者/UI 消费。
 */
export interface MissionStateTransitionEvent {
  missionId: string;
  goal: string;
  from: MissionState;
  to: MissionState;
  timestamp: number;
  reason?: string;
  error?: string;
}
