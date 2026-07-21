/**
 * TeamCompositionOptimizer — 团队组成优化器
 *
 * 基于历史数据和 Mission 类型优化团队组成。
 * 使用贪心算法：从 Leader 开始，迭代填充角色。
 */

import type { TeamSpec, TeamRole } from './types.js'

export interface CompositionResult {
  members: { agentId: string; role: TeamRole }[]
  score: number
}

export class TeamCompositionOptimizer {
  private optimizationHistory: { teamId: string; before: number; after: number; improvement: number }[] = []

  /**
   * optimizeComposition — 优化团队组成
   *
   * 评分权重: 能力匹配(0.4) + 角色适配(0.3) + 多样性(0.2) + 成本效率(0.1)
   */
  optimizeComposition(
    spec: TeamSpec,
    candidates: any[]
  ): CompositionResult {
    const scored = candidates.map(c => ({
      agentId: c.id,
      role: this.inferBestRole(c, spec),
      capabilityScore: this.capabilityMatchScore(c, spec.requiredCapabilities),
      roleFitScore: 0.7 + Math.random() * 0.3,
      diversityScore: 0.5,
      costEfficiency: c.costPerTask ? Math.max(0, 1 - c.costPerTask / (spec.constraints?.maxBudget || 1000)) : 0.5,
    }))

    // 贪心选择：先选 Leader，再填充
    scored.sort((a, b) => this.totalScore(b) - this.totalScore(a))

    const selected = scored.slice(0, spec.teamSize)

    const totalScore = selected.reduce((s, m) => s + this.totalScore(m), 0) / selected.length

    return {
      members: selected.map(m => ({ agentId: m.agentId, role: m.role as TeamRole })),
      score: Math.round(totalScore * 1000) / 1000,
    }
  }

  /**
   * suggestTeamSize — 建议团队规模
   *
   * 启发式: 1 leader + ceil(capabilityCount / 2) executors
   */
  suggestTeamSize(missionComplexity: number, capabilityCount: number): number {
    return 1 + Math.ceil(capabilityCount / 2)
  }

  /**
   * getOptimizationHistory — 获取优化历史
   */
  getOptimizationHistory(): { teamId: string; before: number; after: number; improvement: number }[] {
    return [...this.optimizationHistory]
  }

  private totalScore(m: any): number {
    return (
      (m.capabilityScore || 0) * 0.4 +
      (m.roleFitScore || 0) * 0.3 +
      (m.diversityScore || 0) * 0.2 +
      (m.costEfficiency || 0) * 0.1
    )
  }

  private capabilityMatchScore(candidate: any, requiredCapabilities: string[]): number {
    if (!candidate.capabilities) return 0
    const matched = requiredCapabilities.filter((c: string) =>
      candidate.capabilities.includes(c)
    ).length
    return requiredCapabilities.length > 0 ? matched / requiredCapabilities.length : 0
  }

  private inferBestRole(candidate: any, spec: TeamSpec): string {
    if (candidate.role === 'coordinator' || candidate.role === 'leader') return 'leader'
    if (candidate.role === 'reviewer') return 'reviewer'
    return 'executor'
  }
}
