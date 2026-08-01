/**
 * AgentIdentity — v9 Agent 身份定义
 *
 * 每个 Agent 拥有唯一身份标识，包含角色、能力、内存范围、权限范围、治理元数据。
 *
 * Agent 不根据名字选择，根据能力匹配。
 * Agent 间禁止直接调用，必须通过 MessageBus。
 *
 * v9.1: 新增 governanceMetadata，用于 Control Plane 治理。
 */

export type AgentRole = 'planner' | 'executor' | 'reviewer' | 'researcher' | 'coder' | 'memory-agent' | 'evolution-agent' | 'coordinator'

// ── GovernanceMetadata — Agent 治理元数据 ──

export interface AgentGovernanceMetadata {
  /** Agent 角色（与身份角色同步） */
  role: AgentRole
  /** 信任等级 (0-1)，基于历史表现 */
  trustLevel: number
  /** 能力边界 (允许执行的操作类型) */
  capabilityBoundary: string[]
  /** 最大可承担的风险等级 */
  maxRiskLevel: 'low' | 'medium' | 'high' | 'critical'
  /** 是否需要审批才能协作 */
  requireApprovalForCollab: boolean
  /** 允许访问的共享内存 key 列表 */
  allowedSharedMemory: string[]
  /** 允许访问的产物类型列表 */
  allowedArtifactTypes: string[]
  /** 所属组织标签 */
  organizationTag?: string
  /** 信任开始时间 */
  trustSince: number
}

export interface AgentIdentity {
  /** 唯一标识 (e.g. 'planner-001') */
  id: string
  /** 显示名称 (e.g. 'PlannerAgent') */
  name: string
  /** 角色 */
  role: AgentRole
  /** 能力列表 (用于 CapabilityGraph 匹配) */
  capabilities: string[]
  /** 内存分区 key (Agent 私有内存) */
  memoryScope: string
  /** 权限分组 (对应 PermissionModel) */
  permissionScope: string
  /** 状态 */
  status: 'ACTIVE' | 'IDLE' | 'SUSPENDED' | 'DEPRECATED'
  /** 版本号 */
  version: number
  /** 创建时间 */
  createdAt: number
  /** 扩展元数据 */
  metadata?: Record<string, unknown>
  /** ★ v9.1: 治理元数据（用于 Control Plane 集成） */
  governance?: AgentGovernanceMetadata
}

/**
 * 创建默认治理元数据
 */
export function createDefaultGovernance(identity: Partial<AgentIdentity> & { id: string; role: AgentRole }): AgentGovernanceMetadata {
  return {
    role: identity.role,
    trustLevel: 0.5,
    capabilityBoundary: identity.role === 'coordinator'
      ? ['read', 'write', 'execute', 'approve']
      : ['read', 'write', 'execute'],
    maxRiskLevel: identity.role === 'coordinator' ? 'high' : 'medium',
    requireApprovalForCollab: identity.role === 'executor',
    allowedSharedMemory: [],
    allowedArtifactTypes: ['document', 'report', 'config'],
    trustSince: Date.now(),
  }
}
