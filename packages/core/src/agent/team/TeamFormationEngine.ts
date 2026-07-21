/**
 * TeamFormationEngine — 团队组建引擎
 *
 * 根据 Mission 需求自动组建最优团队。
 * 流程: 解析需求 → 查询候选 → 评分 → 分配角色 → 创建团队
 */

import type { TeamSpec, TeamFormation, TeamMember, TeamContext, TeamRole, TeamStatus } from './types.js'

export class TeamFormationEngine {
  private formations = new Map<string, TeamFormation>()
  private contexts = new Map<string, TeamContext>()
  private counter = 0

  constructor(
    private scheduler: any,
    private collaborationManager: any,
    private capabilityGraph: any,
    private ranking: any
  ) {}

  /**
   * formTeam — 根据规格组建团队
   */
  async formTeam(spec: TeamSpec): Promise<TeamFormation> {
    const teamId = `team_${spec.missionId}_${++this.counter}`

    // 1. 查询候选 Agent（模拟）
    const candidates = this.findCandidates(spec.requiredCapabilities)

    // 2. 评分
    const scored = candidates.map(c => ({
      agent: c,
      score: this.scoreCandidate(c, spec),
    }))
    scored.sort((a, b) => b.score - a.score)

    // 3. 分配角色
    const assignedMembers = this.assignRoles(scored, spec)

    // 4. 创建团队
    const leader = assignedMembers.find(m => m.role === 'leader' || m.role === 'coordinator')
    const formation: TeamFormation = {
      teamId,
      missionId: spec.missionId,
      members: assignedMembers.map(m => ({
        agentId: m.agentId,
        role: m.role as TeamRole,
        joinedAt: Date.now(),
        status: 'active' as const,
      })),
      status: 'forming' as TeamStatus,
      createdAt: Date.now(),
    }

    // 5. 创建团队上下文
    const context: TeamContext = {
      teamId,
      missionId: spec.missionId,
      sharedMemoryPrefix: `team_${teamId}_`,
      members: assignedMembers.map(m => ({ agentId: m.agentId, role: m.role as TeamRole })),
      leaderAgentId: leader?.agentId || assignedMembers[0]?.agentId || 'unknown',
      createdAt: Date.now(),
    }

    this.formations.set(teamId, formation)
    this.contexts.set(teamId, context)

    return formation
  }

  /**
   * reassignRole — 重新分配角色
   */
  reassignRole(teamId: string, agentId: string, newRole: TeamRole): boolean {
    const formation = this.formations.get(teamId)
    if (!formation) return false

    const member = formation.members.find(m => m.agentId === agentId)
    if (!member) return false

    member.role = newRole
    return true
  }

  /**
   * replaceMember — 替换失败成员
   */
  replaceMember(teamId: string, failedAgentId: string): any {
    const formation = this.formations.get(teamId)
    if (!formation) return null

    const failed = formation.members.find(m => m.agentId === failedAgentId)
    if (!failed) return null

    failed.status = 'failed'

    // 模拟替换
    const replacement = {
      agentId: `replacement_${Date.now()}`,
      role: failed.role as TeamRole,
      joinedAt: Date.now(),
      status: 'active' as const,
      replacedBy: failedAgentId,
    }

    formation.members.push(replacement)
    failed.replacedBy = replacement.agentId

    return replacement
  }

  /**
   * disbandTeam — 解散团队
   */
  disbandTeam(teamId: string): void {
    const formation = this.formations.get(teamId)
    if (formation) {
      formation.status = 'disbanded'
      formation.disbandedAt = Date.now()
    }
  }

  /**
   * getFormation — 获取团队信息
   */
  getFormation(teamId: string): TeamFormation | undefined {
    return this.formations.get(teamId)
  }

  /**
   * getContext — 获取团队上下文
   */
  getContext(teamId: string): TeamContext | undefined {
    return this.contexts.get(teamId)
  }

  private findCandidates(capabilities: string[]): any[] {
    // 模拟候选查找
    return capabilities.map((cap, i) => ({
      id: `agent_candidate_${i}`,
      capabilities: [cap],
      successRate: 0.7 + Math.random() * 0.3,
      rankingScore: 0.6 + Math.random() * 0.4,
      costPerTask: 50 + Math.random() * 200,
    }))
  }

  private scoreCandidate(candidate: any, spec: TeamSpec): number {
    const capScore = spec.requiredCapabilities.filter((c: string) =>
      candidate.capabilities.includes(c)
    ).length / spec.requiredCapabilities.length

    const reliabilityScore = candidate.successRate || 0.5
    return capScore * 0.4 + reliabilityScore * 0.4 + (candidate.rankingScore || 0.5) * 0.2
  }

  private assignRoles(scored: { agent: any; score: number }[], spec: TeamSpec): any[] {
    const assigned: any[] = []
    const roleCounts = new Map<string, number>()

    // 先分配 leader
    if (scored.length > 0) {
      assigned.push({ ...scored[0].agent, agentId: scored[0].agent.id, role: 'leader' })
      roleCounts.set('leader', 1)
    }

    // 分配 executor
    for (let i = 1; i < scored.length && assigned.length < spec.teamSize; i++) {
      const role = spec.teamSize - assigned.length <= 1 ? 'reviewer' : 'executor'
      assigned.push({ ...scored[i].agent, agentId: scored[i].agent.id, role })
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1)
    }

    return assigned
  }
}
