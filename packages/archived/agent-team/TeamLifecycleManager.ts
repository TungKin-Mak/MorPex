/**
 * TeamLifecycleManager — 团队生命周期管理器
 *
 * 管理团队：forming → active → disbanded。
 * 支持成员故障处理、自动替换、超时解散。
 */

import type { TeamFormation, TeamMember, TeamStatus } from './types.js'

export class TeamLifecycleManager {
  private formations = new Map<string, TeamFormation>()

  /**
   * activateTeam — 激活团队（forming → active）
   */
  activateTeam(teamId: string): TeamFormation | undefined {
    const formation = this.formations.get(teamId)
    if (!formation || formation.status !== 'forming') return undefined

    formation.status = 'active'
    formation.activatedAt = Date.now()
    return formation
  }

  /**
   * disbandTeam — 解散团队
   */
  disbandTeam(teamId: string, reason?: string): TeamFormation | undefined {
    const formation = this.formations.get(teamId)
    if (!formation) return undefined

    formation.status = 'disbanded'
    formation.disbandedAt = Date.now()
    return formation
  }

  /**
   * handleMemberFailure — 处理成员故障
   *
   * 移除失败成员，尝试替换。3 次失败则解散团队。
   */
  async handleMemberFailure(
    teamId: string,
    failedAgentId: string,
    replaceFn: (teamId: string, failedAgentId: string) => any
  ): Promise<TeamMember | null> {
    const formation = this.formations.get(teamId)
    if (!formation) return null

    const failedMember = formation.members.find(m => m.agentId === failedAgentId)
    if (!failedMember) return null

    failedMember.status = 'failed'

    // 尝试替换
    let attempts = 0
    while (attempts < 3) {
      const replacement = replaceFn(teamId, failedAgentId)
      if (replacement) {
        formation.members.push({
          agentId: replacement.agentId,
          role: replacement.role,
          joinedAt: Date.now(),
          status: 'active',
          replacedBy: failedAgentId,
        })
        return replacement
      }
      attempts++
    }

    // 3 次失败 → 解散团队
    formation.status = 'failed'
    formation.disbandedAt = Date.now()
    return null
  }

  /**
   * extendDeadline — 延长团队截止时间
   */
  extendDeadline(teamId: string, additionalMs: number): boolean {
    return this.formations.has(teamId)
  }

  /**
   * getActiveTeams — 获取所有活跃团队
   */
  getActiveTeams(): TeamFormation[] {
    return [...this.formations.values()].filter(f => f.status === 'active')
  }

  /**
   * getTeamHealth — 获取团队健康状态
   */
  getTeamHealth(teamId: string): { alive: boolean; activeMembers: number; failedMembers: number; duration: number } {
    const formation = this.formations.get(teamId)
    if (!formation) return { alive: false, activeMembers: 0, failedMembers: 0, duration: 0 }

    const active = formation.members.filter(m => m.status === 'active').length
    const failed = formation.members.filter(m => m.status === 'failed').length
    const duration = Date.now() - formation.createdAt

    return {
      alive: formation.status === 'active' || formation.status === 'forming',
      activeMembers: active,
      failedMembers: failed,
      duration,
    }
  }

  /**
   * registerTeam — 注册团队（由 TeamFormationEngine 调用）
   */
  registerTeam(formation: TeamFormation): void {
    this.formations.set(formation.teamId, { ...formation })
  }

  /**
   * getFormation — 获取团队
   */
  getFormation(teamId: string): TeamFormation | undefined {
    return this.formations.get(teamId)
  }
}
