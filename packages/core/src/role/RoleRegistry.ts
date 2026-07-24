/**
 * RoleRegistry — 简化版角色注册中心
 *
 * Phase 0 / 组织层
 *
 * 相比 AgentRegistry（完整 Agent 生命周期 + 能力匹配 + 排名），
 * RoleRegistry 只做三件事：
 *   1. 角色定义（岗位）
 *   2. 角色分配（谁在什么部门担任什么角色）
 *   3. 按角色查询
 *
 * 角色事件：
 *   - role.defined    — 新角色被定义
 *   - role.assigned   — 角色分配给 Agent
 *   - role.unassigned — 角色分配被撤销
 */

import { EventBus } from '../common/EventBus.js';
import type { Role, RoleId, RoleName, RoleAssignment } from './types.js';

export class RoleRegistry {
  private roles: Map<RoleId, Role> = new Map();
  /** assignments key: `${agentId}:${departmentId}` */
  private assignments: Map<string, RoleAssignment> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    if (!eventBus) {
      throw new Error('[RoleRegistry] EventBus 是必填参数');
    }
    this.eventBus = eventBus;
  }

  /**
   * defineRole — 定义角色
   *
   * @param role - 角色定义（不含 id 和 createdAt）
   * @returns 完整的 Role 实体
   */
  defineRole(role: Omit<Role, 'id' | 'createdAt'>): Role {
    const id: RoleId = `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const full: Role = { ...role, id, createdAt: Date.now() };
    this.roles.set(id, full);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'role.defined',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'role',
      payload: { role: full },
    });

    return full;
  }

  /**
   * assignRole — 分配角色给 Agent
   *
   * @param agentId - Agent ID
   * @param roleId - 角色 ID
   * @param departmentId - 部门 ID
   * @param assignedBy - 分配者 ID（通常是 CEO）
   * @returns RoleAssignment 记录
   */
  assignRole(
    agentId: string,
    roleId: RoleId,
    departmentId: string,
    assignedBy: string,
  ): RoleAssignment {
    const key = `${agentId}:${departmentId}`;
    const assignment: RoleAssignment = {
      roleId,
      agentId,
      departmentId,
      assignedAt: Date.now(),
      assignedBy,
    };
    this.assignments.set(key, assignment);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'role.assigned',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'role',
      payload: { assignment },
    });

    return assignment;
  }

  /**
   * unassignRole — 解除角色分配
   *
   * @returns true 如果分配存在并删除，false 如果不存在
   */
  unassignRole(agentId: string, departmentId: string): boolean {
    const key = `${agentId}:${departmentId}`;
    const existed = this.assignments.has(key);
    if (!existed) return false;

    this.assignments.delete(key);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'role.unassigned',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'role',
      payload: { agentId, departmentId },
    });

    return true;
  }

  /**
   * getRole — 按 ID 获取角色定义
   */
  getRole(roleId: RoleId): Role | undefined {
    return this.roles.get(roleId);
  }

  /**
   * findRolesByName — 按角色名称查找
   */
  findRolesByName(name: RoleName): Role[] {
    return [...this.roles.values()].filter(r => r.name === name);
  }

  /**
   * findRolesByDepartment — 按部门查找所有角色
   */
  findRolesByDepartment(departmentId: string): Role[] {
    const deptAssignments = [...this.assignments.values()]
      .filter(a => a.departmentId === departmentId);
    return deptAssignments
      .map(a => this.roles.get(a.roleId))
      .filter((r): r is Role => r !== undefined);
  }

  /**
   * getAssignment — 获取指定 Agent 在指定部门的角色分配
   */
  getAssignment(agentId: string, departmentId: string): RoleAssignment | undefined {
    return this.assignments.get(`${agentId}:${departmentId}`);
  }

  /**
   * listAssignments — 列出所有角色分配
   *
   * @param departmentId - 可选，按部门过滤
   */
  listAssignments(departmentId?: string): RoleAssignment[] {
    const all = [...this.assignments.values()];
    return departmentId ? all.filter(a => a.departmentId === departmentId) : all;
  }

  /**
   * getCapabilitiesForAgent — 获取 Agent 在指定部门的合并能力列表
   */
  getCapabilitiesForAgent(agentId: string, departmentId: string): string[] {
    const assignment = this.getAssignment(agentId, departmentId);
    if (!assignment) return [];
    const role = this.roles.get(assignment.roleId);
    return role?.capabilities ?? [];
  }
}
