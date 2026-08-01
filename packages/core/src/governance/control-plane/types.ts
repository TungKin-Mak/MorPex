/**
 * Role Types — 角色核心类型定义
 *
 * Phase 0 / 组织层
 * 相比 AgentRegistry 的完整生命周期管理，RoleRegistry 只关注：
 *   1. 角色定义（岗位）
 *   2. 角色分配（谁在什么部门担任什么角色）
 *   3. 按角色查询
 */

export type RoleId = string;

/** 角色名称：CEO / 部门负责人 / 执行者 / 观察者 */
export type RoleName = 'ceo' | 'lead_agent' | 'worker' | 'observer';

/**
 * Role — 角色定义
 */
export interface Role {
  id: RoleId;
  name: RoleName;
  departmentId: string;
  agentId?: string;
  /** 角色拥有的能力列表 */
  capabilities: string[];
  /** 角色拥有的权限列表 */
  permissions: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * RoleAssignment — 角色分配记录
 */
export interface RoleAssignment {
  roleId: RoleId;
  agentId: string;
  departmentId: string;
  assignedAt: number;
  assignedBy: string;
}
