/**
 * TeamGovernanceModel — 团队治理模型
 *
 * v9.2: 管理团队策略、成员关系、协作权限。
 */

export interface TeamPolicy {
  teamId: string
  teamName: string
  memberRoles: string[]
  maxConcurrentCollabs: number
  budgetAllocation: number
  allowExternalRecruitment: boolean
  requireApprovalForChanges: boolean
  escalationPath: string[]
}

export interface TeamMembership {
  agentId: string
  teamId: string
  role: 'leader' | 'member' | 'observer'
  joinedAt: number
  permissions: string[]
}

export class TeamGovernanceModel {
  private teams = new Map<string, TeamPolicy>()
  private memberships = new Map<string, TeamMembership[]>()

  /**
   * createTeam — 创建团队
   */
  createTeam(policy: TeamPolicy): void {
    this.teams.set(policy.teamId, { ...policy })
    this.memberships.set(policy.teamId, [])
  }

  /**
   * updateTeam — 更新团队策略
   */
  updateTeam(teamId: string, updates: Partial<TeamPolicy>): boolean {
    const team = this.teams.get(teamId)
    if (!team) return false
    Object.assign(team, updates)
    return true
  }

  /**
   * getTeam — 获取团队策略
   */
  getTeam(teamId: string): TeamPolicy | undefined {
    return this.teams.get(teamId)
  }

  /**
   * addMember — 添加团队成员
   */
  addMember(membership: TeamMembership): boolean {
    const team = this.teams.get(membership.teamId)
    if (!team) return false

    const members = this.memberships.get(membership.teamId)!
    members.push({ ...membership })
    return true
  }

  /**
   * removeMember — 移除团队成员
   */
  removeMember(teamId: string, agentId: string): boolean {
    const members = this.memberships.get(teamId)
    if (!members) return false

    const idx = members.findIndex(m => m.agentId === agentId)
    if (idx === -1) return false
    members.splice(idx, 1)
    return true
  }

  /**
   * getMembers — 获取团队成员列表
   */
  getMembers(teamId: string): TeamMembership[] {
    return [...(this.memberships.get(teamId) || [])]
  }

  /**
   * getTeamsForAgent — 获取 Agent 所属的所有团队
   */
  getTeamsForAgent(agentId: string): TeamPolicy[] {
    const teamIds: string[] = []
    for (const [tid, members] of this.memberships) {
      if (members.some(m => m.agentId === agentId)) {
        teamIds.push(tid)
      }
    }
    return teamIds.map(id => this.teams.get(id)!).filter(Boolean)
  }

  /**
   * canCollaborate — 检查两个 Agent 是否可以协作
   *
   * 同团队自动允许，不同团队按策略判断。
   */
  canCollaborate(agentA: string, agentB: string): { allowed: boolean; reason: string } {
    // 检查是否同属一个团队
    for (const [tid, members] of this.memberships) {
      const hasA = members.some(m => m.agentId === agentA)
      const hasB = members.some(m => m.agentId === agentB)
      if (hasA && hasB) {
        return { allowed: true, reason: `同属团队 ${tid}` }
      }
    }

    // 跨团队协作：需要各团队策略允许
    const teamsA = this.getTeamsForAgent(agentA)
    const teamsB = this.getTeamsForAgent(agentB)

    for (const teamA of teamsA) {
      if (teamA.allowExternalRecruitment) {
        return { allowed: true, reason: `团队 ${teamA.teamId} 允许外部协作` }
      }
    }

    return { allowed: false, reason: '跨团队协作需审批' }
  }

  /**
   * getEscalationPath — 获取团队升级路径
   */
  getEscalationPath(teamId: string): string[] {
    const team = this.teams.get(teamId)
    if (!team) return []
    return [...team.escalationPath]
  }

  /**
   * listTeams — 列出所有团队
   */
  listTeams(): TeamPolicy[] {
    return [...this.teams.values()]
  }
}
