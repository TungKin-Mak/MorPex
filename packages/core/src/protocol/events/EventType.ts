/**
 * MorPex Event Protocol — Standard Event Types
 *
 * Phase 1 / MorPex v8: 标准化事件类型枚举。
 *
 * 所有事件按架构层分组：
 *   Interaction → Cognitive → Mission → Planning → Execution →
 *   Agent → Tool → Workflow → Control → System → Artifact → Cross-Domain
 *
 * 使用方式：
 *   import { EventType } from './EventType.js';
 *   bus.emit({ type: EventType.MISSION_CREATED, ... });
 *
 * 设计原则：
 *   - 每个事件类型以 {layer}.{action} 格式命名（与现有 EventBus 命名约定一致）
 *   - 枚举值使用 kebab-case 字符串（与运行时兼容）
 *   - 新事件类型优先添加到对应层，没有合适层时创建新层
 */

export enum EventType {
  // ── Interaction Layer ──
  /** 用户发送消息 */
  USER_MESSAGE = 'user.message',
  /** 新会话开始 */
  SESSION_STARTED = 'session.started',
  /** 会话结束 */
  SESSION_ENDED = 'session.ended',

  // ── Interaction Layer (extended) ──
  /** 用户消息已接收 */
  USER_MESSAGE_RECEIVED = 'user.message.received',

  // ── Cognitive Layer ──
  /** 检测到用户意图 */
  INTENT_DETECTED = 'intent.detected',
  /** 目标匹配完成 */
  GOAL_MATCHED = 'goal.matched',
  /** Twin 检索完成 */
  TWIN_RETRIEVED = 'twin.retrieved',
  /** 上下文构建完成 */
  CONTEXT_BUILT = 'context.built',
  /** 上下文组装完成（v9.1 ContextAssemblyEngine） */
  CONTEXT_ASSEMBLED = 'context.assembled',
  /** 读取记忆 */
  MEMORY_READ = 'memory.read',
  /** 写入记忆 */
  MEMORY_WRITE = 'memory.write',
  /** 记忆更新完成 */
  MEMORY_UPDATED = 'memory.updated',
  /** 认知决策已记录 */
  DECISION_RECORDED = 'decision.recorded',

  // ── Mission Layer ──
  /** 新任务/Mission 创建 */
  MISSION_CREATED = 'mission.created',
  /** Mission 更新 */
  MISSION_UPDATED = 'mission.updated',
  /** Mission 完成 */
  MISSION_COMPLETED = 'mission.completed',
  /** Mission 失败 */
  MISSION_FAILED = 'mission.failed',

  // ── Planning Layer ──
  /** 计划创建 */
  PLAN_CREATED = 'plan.created',
  /** 计划更新（如 replan） */
  PLAN_UPDATED = 'plan.updated',

  // ── Execution Layer ──
  /** DAG 执行图创建 */
  GRAPH_CREATED = 'graph.created',
  /** DAG 节点开始执行 */
  NODE_STARTED = 'node.started',
  /** DAG 节点完成 */
  NODE_COMPLETED = 'node.completed',
  /** DAG 节点失败 */
  NODE_FAILED = 'node.failed',
  /** 执行开始 */
  EXECUTION_STARTED = 'execution.started',
  /** 执行完成 */
  EXECUTION_COMPLETED = 'execution.completed',
  /** 执行失败 */
  EXECUTION_FAILED = 'execution.failed',
  /** 执行取消 */
  EXECUTION_CANCELLED = 'execution.cancelled',

  // ── Agent Layer ──
  /** Agent 开始工作 */
  AGENT_STARTED = 'agent.started',
  /** Agent 发送消息 */
  AGENT_MESSAGE = 'agent.message',
  /** Agent 完成 */
  AGENT_COMPLETED = 'agent.completed',
  /** Agent 失败 */
  // ── Agent events consolidated in v9 Agent Layer section ──

  // ── Tool Layer ──
  /** 工具调用开始 */
  TOOL_STARTED = 'tool.started',
  /** 工具调用完成 */
  TOOL_COMPLETED = 'tool.completed',
  /** 工具调用失败 */
  TOOL_FAILED = 'tool.failed',

  // ── Workflow Layer ──
  /** 工作流状态更新 */
  WORKFLOW_UPDATED = 'workflow.updated',
  /** 工作流创建 */
  WORKFLOW_CREATED = 'workflow.created',
  /** 工作流仿真完成 */
  WORKFLOW_SIMULATED = 'workflow.simulated',
  /** 工作流契约已验证 */
  WORKFLOW_CONTRACT_VALIDATED = 'workflow.contract.validated',
  /** 工作流步骤开始 */
  WORKFLOW_STEP_STARTED = 'workflow.step_started',
  /** 工作流步骤完成 */
  WORKFLOW_STEP_COMPLETED = 'workflow.step_completed',

  // ── Control Layer ──
  /** 请求人工审批 */
  APPROVAL_REQUIRED = 'approval.required',
  /** 审批通过 */
  APPROVAL_GRANTED = 'approval.granted',
  /** 审批拒绝 */
  APPROVAL_DENIED = 'approval.denied',
  /** 策略评估完成 */
  POLICY_EVALUATED = 'policy.evaluated',
  /** 风险评估完成 */
  RISK_ASSESSED = 'risk.assessed',

  // ── System Layer ──
  /** 系统启动 */
  SYSTEM_STARTED = 'system.started',
  /** 系统停止 */
  SYSTEM_STOPPED = 'system.stopped',
  /** 系统错误 */
  SYSTEM_ERROR = 'system.error',

  // ── Artifact Layer ──
  /** 产物创建 */
  ARTIFACT_CREATED = 'artifact.created',
  /** 产物更新 */
  ARTIFACT_UPDATED = 'artifact.updated',
  /** 产物已验证 */
  ARTIFACT_VERIFIED = 'artifact.verified',

  // ── Cross-Domain Layer ──
  /** 跨领域产物共享 */
  CROSS_DOMAIN_ARTIFACT_SHARED = 'cross_domain.artifact_shared',
  /** 跨领域 DAG 创建 */
  CROSS_DOMAIN_DAG_CREATED = 'cross_domain.dag_created',

  // ── Verification Layer ──
  /** 验证开始 */
  VERIFICATION_STARTED = 'verification.started',
  /** 验证完成 */
  VERIFICATION_COMPLETED = 'verification.completed',

  // ── Retry / Compensation Layer ──
  /** 重试触发 */
  RETRY_TRIGGERED = 'retry.triggered',
  /** 补偿开始 */
  COMPENSATION_STARTED = 'compensation.started',

  // ── Budget Layer ──
  /** 预算超限 */
  BUDGET_LIMIT_REACHED = 'budget.limit.reached',

  // ── Sandbox Layer ──
  /** 沙箱执行开始 */
  SANDBOX_EXECUTION_STARTED = 'sandbox.execution.started',

  // ── Reliability Layer (v8.9) ──
  /** 混沌测试开始 */
  CHAOS_TEST_STARTED = 'chaos.test.started',
  /** 故障注入 */
  CHAOS_FAILURE_INJECTED = 'chaos.failure.injected',
  /** 恢复开始 */
  RECOVERY_STARTED = 'recovery.started',
  /** 恢复完成 */
  RECOVERY_COMPLETED = 'recovery.completed',
  /** 重放开始 */
  REPLAY_STARTED = 'replay.started',
  /** 工作流晋升 */
  WORKFLOW_PROMOTED = 'workflow.promoted',
  /** 回归测试失败 */
  REGRESSION_FAILED = 'regression.failed',

  // ── Reliability Layer (v8.9.2) ──
  /** 可靠性检查开始 */
  RELIABILITY_CHECK_STARTED = 'reliability.check.started',
  /** 混沌测试完成 */
  CHAOS_TEST_COMPLETED = 'chaos.test.completed',
  /** 工作流降级 */
  WORKFLOW_DEGRADED = 'workflow.degraded',
  /** 工作流废弃 */
  WORKFLOW_DEPRECATED = 'workflow.deprecated',
  /** 安全评分更新 */
  SAFETY_SCORE_UPDATED = 'safety.score.updated',
  /** 升级到人工审查 */
  ESCALATED_TO_HUMAN = 'escalated.to.human',

  // ── Agent Layer (v9) ──
  AGENT_REGISTERED = 'agent.registered',
  AGENT_ASSIGNED = 'agent.assigned',
  AGENT_MESSAGE_SENT = 'agent.message.sent',
  AGENT_MESSAGE_RECEIVED = 'agent.message.received',
  COLLABORATION_STARTED = 'collaboration.started',
  COLLABORATION_COMPLETED = 'collaboration.completed',
  AGENT_FAILED = 'agent.failed',
  AGENT_REPLACED = 'agent.replaced',
  AGENT_PROMOTED = 'agent.promoted',
  AGENT_DEPRECATED = 'agent.deprecated',

  // ── v9.2 Cross-Agent Learning ──
  EXPERIENCE_DISTILLED = 'experience.distilled',
  EXPERIENCE_PROPAGATED = 'experience.propagated',

  // ── v9.2 Organization Governance ──
  ORG_POLICY_CHECKED = 'org.policy.checked',
  BUDGET_ALLOCATED = 'budget.allocated',

  // ── v9.2 Agent Marketplace ──
  MARKETPLACE_LISTING_CREATED = 'marketplace.listing.created',
  MARKETPLACE_BID_SUBMITTED = 'marketplace.bid.submitted',
  MARKETPLACE_CONTRACT_SIGNED = 'marketplace.contract.signed',

  // ── v9.2 Distributed Runtime ──
  NODE_ONLINE = 'node.online',
  NODE_OFFLINE = 'node.offline',

  // ── v9.2 Team Formation ──
  TEAM_FORMED = 'team.formed',
  TEAM_MEMBER_REPLACED = 'team.member.replaced',
  TEAM_DISBANDED = 'team.disbanded',

  // ── v9.2 Shared Memory Consensus ──
  MEMORY_LOCK_ACQUIRED = 'memory.lock.acquired',
  MEMORY_CONSENSUS_REACHED = 'memory.consensus.reached',
  MEMORY_SNAPSHOT_TAKEN = 'memory.snapshot.taken',
}

/**
 * 事件类型分组映射
 * 用于按架构层筛选事件
 */
export const EVENT_LAYERS: Record<string, EventType[]> = {
  interaction: [
    EventType.USER_MESSAGE,
    EventType.USER_MESSAGE_RECEIVED,
    EventType.SESSION_STARTED,
    EventType.SESSION_ENDED,
  ],
  cognitive: [
    EventType.INTENT_DETECTED,
    EventType.GOAL_MATCHED,
    EventType.TWIN_RETRIEVED,
    EventType.CONTEXT_BUILT,
    EventType.CONTEXT_ASSEMBLED,
    EventType.MEMORY_READ,
    EventType.MEMORY_WRITE,
    EventType.MEMORY_UPDATED,
    EventType.DECISION_RECORDED,
  ],
  mission: [
    EventType.MISSION_CREATED,
    EventType.MISSION_UPDATED,
    EventType.MISSION_COMPLETED,
    EventType.MISSION_FAILED,
  ],
  planning: [
    EventType.PLAN_CREATED,
    EventType.PLAN_UPDATED,
  ],
  execution: [
    EventType.GRAPH_CREATED,
    EventType.NODE_STARTED,
    EventType.NODE_COMPLETED,
    EventType.NODE_FAILED,
    EventType.EXECUTION_STARTED,
    EventType.EXECUTION_COMPLETED,
    EventType.EXECUTION_FAILED,
    EventType.EXECUTION_CANCELLED,
    EventType.SANDBOX_EXECUTION_STARTED,
  ],
  agent: [
    EventType.AGENT_STARTED,
    EventType.AGENT_MESSAGE,
    EventType.AGENT_COMPLETED,
    EventType.AGENT_FAILED,
  ],
  tool: [
    EventType.TOOL_STARTED,
    EventType.TOOL_COMPLETED,
    EventType.TOOL_FAILED,
  ],
  workflow: [
    EventType.WORKFLOW_UPDATED,
    EventType.WORKFLOW_CREATED,
    EventType.WORKFLOW_SIMULATED,
    EventType.WORKFLOW_CONTRACT_VALIDATED,
    EventType.WORKFLOW_STEP_STARTED,
    EventType.WORKFLOW_STEP_COMPLETED,
  ],
  control: [
    EventType.APPROVAL_REQUIRED,
    EventType.APPROVAL_GRANTED,
    EventType.APPROVAL_DENIED,
    EventType.POLICY_EVALUATED,
    EventType.RISK_ASSESSED,
  ],
  system: [
    EventType.SYSTEM_STARTED,
    EventType.SYSTEM_STOPPED,
    EventType.SYSTEM_ERROR,
  ],
  artifact: [
    EventType.ARTIFACT_CREATED,
    EventType.ARTIFACT_UPDATED,
    EventType.ARTIFACT_VERIFIED,
  ],
  verification: [
    EventType.VERIFICATION_STARTED,
    EventType.VERIFICATION_COMPLETED,
  ],
  retry: [
    EventType.RETRY_TRIGGERED,
    EventType.COMPENSATION_STARTED,
  ],
  budget: [
    EventType.BUDGET_LIMIT_REACHED,
  ],
  sandbox: [
    EventType.SANDBOX_EXECUTION_STARTED,
  ],
  reliability: [
    EventType.CHAOS_TEST_STARTED,
    EventType.CHAOS_FAILURE_INJECTED,
    EventType.RECOVERY_STARTED,
    EventType.RECOVERY_COMPLETED,
    EventType.REPLAY_STARTED,
    EventType.WORKFLOW_PROMOTED,
    EventType.REGRESSION_FAILED,
    EventType.RELIABILITY_CHECK_STARTED,
    EventType.CHAOS_TEST_COMPLETED,
    EventType.WORKFLOW_DEGRADED,
    EventType.WORKFLOW_DEPRECATED,
    EventType.SAFETY_SCORE_UPDATED,
    EventType.ESCALATED_TO_HUMAN,
  ],
  cross_domain: [
    EventType.CROSS_DOMAIN_ARTIFACT_SHARED,
    EventType.CROSS_DOMAIN_DAG_CREATED,
  ],
  agent_v9: [
    EventType.AGENT_REGISTERED,
    EventType.AGENT_ASSIGNED,
    EventType.AGENT_MESSAGE_SENT,
    EventType.AGENT_MESSAGE_RECEIVED,
    EventType.COLLABORATION_STARTED,
    EventType.COLLABORATION_COMPLETED,
    EventType.AGENT_REPLACED,
    EventType.AGENT_PROMOTED,
    EventType.AGENT_DEPRECATED,
    // v9.2
    EventType.EXPERIENCE_DISTILLED,
    EventType.EXPERIENCE_PROPAGATED,
    EventType.ORG_POLICY_CHECKED,
    EventType.BUDGET_ALLOCATED,
    EventType.MARKETPLACE_LISTING_CREATED,
    EventType.MARKETPLACE_BID_SUBMITTED,
    EventType.MARKETPLACE_CONTRACT_SIGNED,
    EventType.NODE_ONLINE,
    EventType.NODE_OFFLINE,
    EventType.TEAM_FORMED,
    EventType.TEAM_MEMBER_REPLACED,
    EventType.TEAM_DISBANDED,
    EventType.MEMORY_LOCK_ACQUIRED,
    EventType.MEMORY_CONSENSUS_REACHED,
    EventType.MEMORY_SNAPSHOT_TAKEN,
  ],
};

/**
 * 获取所有标准事件类型列表
 */
export function getAllEventTypes(): EventType[] {
  return Object.values(EventType);
}
