/**
 * RoleAssignmentStrategy — 角色分配策略
 *
 * 根据 Agent 特征和 Mission 需求智能分配角色。
 * 使用启发式规则匹配 Agent 类型到最合适的角色。
 */

import type { TeamSpec, TeamRole } from './types.js'

export class RoleAssignmentStrategy {
  /**
   * assignRole — 为 Agent 分配最佳角色
   *
   * 启发式:
   *   - coordinator/leader → 最高 ranking 的 agent
   *   - reviewer → 有 reviewer 角色或高 accuracy 的 agent
   *   - executor → 匹配能力的剩余 agent
   *   - observer → 仅用于学习的 agent
   */
  assignRole(agent: any, teamSpec: TeamSpec, assignedRoles: Map<string, number>): TeamRole {
    const agentRole = agent.role || ''

    // 检查角色上限
    const canAssign = (role: TeamRole): boolean => {
      const pref = teamSpec.preferredRoles.find(p => p.role === role)
      if (!pref) return true
      const count = assignedRoles.get(role) || 0
      return count < pref.maxCount
    }

    // 优先级: coordinator > reviewer > executor > observer
    if ((agentRole === 'coordinator' || agentRole === 'leader') && canAssign('coordinator')) {
      return 'coordinator'
    }
    if (agentRole === 'reviewer' && canAssign('reviewer')) {
      return 'reviewer'
    }
    if (agentRole === 'executor' || agentRole === 'coder' || agentRole === 'researcher') {
      if (canAssign('executor')) return 'executor'
    }

    // 兜底
    if (canAssign('executor')) return 'executor'
    if (canAssign('observer')) return 'observer'

    return 'executor'
  }

  /**
   * validateRoleAssignment — 验证角色分配是否合理
   */
  validateRoleAssignment(agent: any, role: TeamRole): boolean {
    const agentRole = agent.role || ''
    switch (role) {
      case 'coordinator':
        return agentRole === 'coordinator' || agentRole === 'leader'
      case 'reviewer':
        return agentRole === 'reviewer' || agent.successRate >= 0.8
      case 'executor':
        return true
      case 'observer':
        return true
      default:
        return true
    }
  }

  /**
   * getRequiredCapabilitiesForRole — 获取角色所需能力
   */
  getRequiredCapabilitiesForRole(role: TeamRole, missionType: string): string[] {
    const base: Record<TeamRole, string[]> = {
      leader: ['planning', 'coordination'],
      coordinator: ['coordination', 'communication'],
      executor: ['task_execution'],
      reviewer: ['review', 'validation'],
      observer: [],
    }
    return base[role] || []
  }
}
