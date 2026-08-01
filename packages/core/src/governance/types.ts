/**
 * Governance Layer — 类型定义
 *
 * Phase 8 / MorPex v8: 风险分析、审计追踪、治理配置。
 *
 * 设计原则：
 *   - RiskAnalyzer 只读不写：分析风险但不修改任何状态
 *   - AuditTrail 只追加不改：审计日志不可篡改
 *   - GovernanceConfig 集中配置：所有治理参数一处在
 */

// ── RiskLevel — 风险等级 ──

/** 风险等级枚举 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

// ── RiskAssessment — 风险评估结果 ──

/** 风险评估结果 */
export interface RiskAssessment {
  /** 评估 ID */
  id: string;
  /** 关联 Mission ID */
  missionId: string;
  /** 风险等级 */
  level: RiskLevel;
  /** 风险评分 0-100 */
  score: number;
  /** 风险因子明细 */
  factors: RiskFactor[];
  /** 缓解措施建议 */
  mitigations: string[];
  /** 是否需要人工审批 */
  requiresApproval: boolean;
  /** 评估时间 */
  assessedAt: number;
  /** 评估者（'system' | userId） */
  assessedBy: string;
}

/** 风险因子 */
export interface RiskFactor {
  /** 因子名称 */
  name: string;
  /** 权重 0-1 */
  weight: number;
  /** 该因子评分 0-100 */
  score: number;
  /** 详细说明 */
  detail: string;
}

// ── AuditEntry — 审计日志条目 ──

/** 审计事件类型 */
export type AuditEventType =
  | 'risk_assessment'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_expired'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'mission_created'
  | 'mission_cancelled'
  | 'system_error'
  // ★ v9.1: Agent 行为事件
  | 'agent_registered'
  | 'agent_deprecated'
  | 'agent_collaboration'
  | 'agent_escalated'
  | 'agent_governance_check';

/** 审计日志条目 */
export interface AuditEntry {
  /** 条目 ID */
  id: string;
  /** 关联 Mission ID */
  missionId: string;
  /** 事件类型 */
  type: AuditEventType;
  /** 时间戳 */
  timestamp: number;
  /** 执行者（userId 或 'system'） */
  actor: string;
  /** 事件详情 */
  details: Record<string, unknown>;
  /** 前状态 */
  previousState?: string;
  /** 新状态 */
  newState?: string;
}

// ── AuditReport — 审计报告 ──

/** 审计报告 */
export interface AuditReport {
  /** 报告覆盖时间段 */
  period: { start: number; end: number };
  /** 总条目数 */
  totalEntries: number;
  /** 按类型统计 */
  byType: Record<string, number>;
  /** 按 Mission 统计 */
  byMission: Record<string, number>;
  /** 风险分布 */
  riskDistribution: Record<RiskLevel, number>;
  /** 审批通过率 */
  approvalRate: number;
  /** 平均风险分 */
  averageRiskScore: number;
  /** 最活跃的 Mission */
  topMissions: Array<{ missionId: string; count: number }>;
}

// ── GovernanceConfig — 治理配置 ──

/** 治理配置 */
export interface GovernanceConfig {
  /** 低于此风险等级自动通过（无需审批） */
  autoApproveBelow: RiskLevel;
  /** 默认允许的工具列表 */
  defaultAllowedTools: string[];
  /** 敏感工具（使用这些工具将提升风险等级） */
  sensitiveTools: string[];
  /** 敏感领域（操作这些领域将提升风险等级） */
  sensitiveDomains: string[];
  /** 触发审批的风险评分阈值（0-100） */
  approvalThreshold: number;
  /** 审计日志最大保留条目数（0=不限制） */
  maxAuditEntries: number;
}

/** 默认治理配置 */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  autoApproveBelow: 'low',
  defaultAllowedTools: ['read', 'search', 'analyze', 'list'],
  sensitiveTools: ['delete', 'deploy', 'email', 'payment', 'write_file', 'execute_shell'],
  sensitiveDomains: ['finance', 'legal', 'hr', 'production', 'deployment'],
  approvalThreshold: 60,
  maxAuditEntries: 10000,
};
