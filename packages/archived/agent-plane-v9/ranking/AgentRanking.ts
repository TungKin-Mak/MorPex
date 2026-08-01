/**
 * AgentRanking — v9 Agent 排名系统
 *
 * 根据历史表现对 Agent 进行排名。
 * 用于: 调度优化、Agent 替换、能力评估。
 *
 * 排名维度:
 *   - 按能力排名 (best agent for 'coding')
 *   - 综合排名 (overall reliability)
 *   - 性价比排名 (best output per cost)
 */

import type { AgentProfile } from '../identity/AgentProfile.js'

export interface AgentRank {
  agentId: string
  role: string
  score: number
  rank: number
  capabilities: string[]
  successRate: number
  reliabilityScore: number
  costPerTask: number
  totalTasks: number
}

export class AgentRanking {
  /**
   * rankByCapability — 按能力排名 Agent
   *
   * 综合评分 = capabilityMatch * 0.4 + successRate * 0.3 + reliabilityScore * 0.2 + taskBonus * 0.1
   */
  rankByCapability(profiles: AgentProfile[], capability: string): AgentRank[] {
    const candidates = profiles.filter(p =>
      p.identity.capabilities.includes(capability) &&
      p.identity.status === 'ACTIVE'
    )

    const ranked = candidates.map((p, i) => {
      const taskBonus = Math.min(1, p.totalTasks / 100) // 经验加分
      const score = 0.4 + p.successRate * 0.3 + p.reliabilityScore * 0.2 + taskBonus * 0.1
      return {
        agentId: p.identity.id,
        role: p.identity.role,
        score: Math.round(score * 1000) / 1000,
        rank: 0,
        capabilities: p.identity.capabilities,
        successRate: p.successRate,
        reliabilityScore: p.reliabilityScore,
        costPerTask: p.costPerTask,
        totalTasks: p.totalTasks,
      }
    })

    ranked.sort((a, b) => b.score - a.score)
    ranked.forEach((r, i) => { r.rank = i + 1 })

    return ranked
  }

  /**
   * rankOverall — 综合排名
   */
  rankOverall(profiles: AgentProfile[]): AgentRank[] {
    const active = profiles.filter(p => p.identity.status === 'ACTIVE')

    const ranked = active.map(p => {
      const score = p.successRate * 0.4 + p.reliabilityScore * 0.3 + (1 - p.humanEscalationRate) * 0.2 + (1 - p.costPerTask) * 0.1
      return {
        agentId: p.identity.id,
        role: p.identity.role,
        score: Math.round(score * 1000) / 1000,
        rank: 0,
        capabilities: p.identity.capabilities,
        successRate: p.successRate,
        reliabilityScore: p.reliabilityScore,
        costPerTask: p.costPerTask,
        totalTasks: p.totalTasks,
      }
    })

    ranked.sort((a, b) => b.score - a.score)
    ranked.forEach((r, i) => { r.rank = i + 1 })

    return ranked
  }

  /**
   * rankByCostEfficiency — 性价比排名
   */
  rankByCostEfficiency(profiles: AgentProfile[], capability?: string): AgentRank[] {
    let candidates = profiles.filter(p => p.identity.status === 'ACTIVE')
    if (capability) {
      candidates = candidates.filter(p => p.identity.capabilities.includes(capability))
    }

    const ranked = candidates.map(p => {
      const efficiency = p.costPerTask > 0 ? p.successRate / p.costPerTask : p.successRate * 100
      const normalizedEfficiency = Math.min(1, efficiency / 100)
      return {
        agentId: p.identity.id,
        role: p.identity.role,
        score: Math.round(normalizedEfficiency * 1000) / 1000,
        rank: 0,
        capabilities: p.identity.capabilities,
        successRate: p.successRate,
        reliabilityScore: p.reliabilityScore,
        costPerTask: p.costPerTask,
        totalTasks: p.totalTasks,
      }
    })

    ranked.sort((a, b) => b.score - a.score)
    ranked.forEach((r, i) => { r.rank = i + 1 })

    return ranked
  }

  /**
   * findReplacement — 查找最佳替代 Agent
   *
   * @param failedAgentId - 失败的 Agent
   * @param profiles - 所有 Agent 档案
   * @param requiredCapabilities - 需要的全部能力
   */
  findReplacement(failedAgentId: string, profiles: AgentProfile[], requiredCapabilities: string[]): AgentProfile | undefined {
    const candidates = profiles.filter(p =>
      p.identity.id !== failedAgentId &&
      p.identity.status === 'ACTIVE' &&
      requiredCapabilities.every(cap => p.identity.capabilities.includes(cap))
    )
    if (candidates.length === 0) return undefined

    const ranked = this.rankOverall(candidates)
    const best = ranked[0]
    return candidates.find(p => p.identity.id === best.agentId)
  }

  /**
   * getLeaderboard — 获取排行榜
   */
  getLeaderboard(profiles: AgentProfile[], topN: number = 10): AgentRank[] {
    const ranked = this.rankOverall(profiles)
    return ranked.slice(0, topN)
  }
}
