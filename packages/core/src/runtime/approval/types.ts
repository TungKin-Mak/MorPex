/**
 * Approval Engine — 类型定义
 *
 * Phase 4 / MorPex v8: 人工审批流程的标准数据结构。
 *
 * 设计原则：
 *   - 每个审批请求独立追踪（id, status, context）
 *   - 审批请求可过期自动拒绝（timeoutMs）
 *   - 低风险操作可选自动审批（autoApproveLowRisk）
 */

// ── ApprovalStatus — 审批状态 ──

/**
 * ApprovalStatus — 审批请求的生命周期状态
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

// ── ApprovalRequest — 审批请求 ──

/**
 * ApprovalRequest — 一个审批请求
 *
 * 高风险操作（发送邮件、删除文件、部署代码、支付等）需要创建审批请求。
 * MissionRuntime 检测到高风险操作时，通过 ApprovalEngine.requestApproval()
 * 创建请求并进入 WAIT_APPROVAL 状态。
 */
export interface ApprovalRequest {
  /** 审批请求 ID */
  id: string;

  /** 关联的 Mission ID */
  missionId: string;

  /** 需要审批的操作描述（如 'send_email', 'delete_file', 'deploy'） */
  action: string;

  /** 人类可读的操作说明 */
  description: string;

  /** 风险等级 */
  risk: 'low' | 'medium' | 'high';

  /** 上下文数据（操作详情、影响范围等） */
  context: Record<string, unknown>;

  /** 当前状态 */
  status: ApprovalStatus;

  /** 请求创建时间 */
  requestedAt: number;

  /** 审批/拒绝/过期时间 */
  resolvedAt?: number;

  /** 审批人标识 */
  resolvedBy?: string;

  /** 审批/拒绝原因 */
  reason?: string;

  /** 超时时间（毫秒），超时自动过期 */
  timeoutMs?: number;
}

// ── ApprovalEngineConfig — 审批引擎配置 ──

/**
 * ApprovalEngineConfig — 审批引擎配置
 */
export interface ApprovalEngineConfig {
  /** 默认超时时间（毫秒），默认 5 分钟 */
  defaultTimeoutMs?: number;

  /** 低风险操作是否自动审批（默认 false） */
  autoApproveLowRisk?: boolean;
}

// ── ApprovalEventPayload — 审批事件负载 ──

/**
 * ApprovalEventPayload — 审批事件的负载类型
 */
export interface ApprovalEventPayload {
  requestId: string;
  missionId: string;
  action: string;
  description: string;
  risk: string;
  status: ApprovalStatus;
  resolvedBy?: string;
  reason?: string;
}

// ── ApprovalStats — 审批统计 ──

/**
 * ApprovalStats — 审批引擎统计信息
 */
export interface ApprovalStats {
  total: number;
  pending: number;
  approved: number;
  denied: number;
  expired: number;
}
