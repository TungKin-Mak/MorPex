/**
 * AgentRegistry — v9 Agent 注册中心
 *
 * 职责:
 *   1. 注册/注销 Agent
 *   2. 按能力查找 Agent
 *   3. 查找匹配任务需求的最佳 Agent
 *   4. 提供 Agent 统计
 *
 * Agent 不根据名字选择。根据能力匹配。
 */

import type { AgentProfile } from '../identity/AgentProfile.js'
import type { AgentIdentity } from '../identity/AgentIdentity.js'
import { AgentProfileManager } from '../identity/AgentProfile.js'

export class AgentRegistry {
  private agents: Map<string, AgentProfile> = new Map()
  private profileManager: AgentProfileManager

  constructor(profileManager?: AgentProfileManager) {
    this.profileManager = profileManager ?? new AgentProfileManager()
  }

  /**
   * register — 注册 Agent
   */
  register(agent: AgentProfile): void {
    this.agents.set(agent.identity.id, agent)
    this.profileManager.register(agent.identity)
  }

  /**
   * unregister — 注销 Agent
   */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId)
  }

  /**
   * getAgent — 获取 Agent
   */
  getAgent(id: string): AgentProfile | undefined {
    return this.agents.get(id)
  }

  /**
   * listAgents — 按状态列出 Agent
   */
  listAgents(status?: AgentIdentity['status']): AgentProfile[] {
    const all = [...this.agents.values()]
    if (status) return all.filter(a => a.identity.status === status)
    return all
  }

  /**
   * findByCapability — 按能力查找 Agent
   */
  findByCapability(capability: string): AgentProfile[] {
    return [...this.agents.values()]
      .filter(a => a.identity.capabilities.includes(capability))
      .sort((a, b) => b.reliabilityScore - a.reliabilityScore)
  }

  /**
   * findByCapabilities — 按多能力查找 (AND 匹配)
   */
  findByCapabilities(capabilities: string[]): AgentProfile[] {
    return [...this.agents.values()]
      .filter(a => capabilities.every(c => a.identity.capabilities.includes(c)))
      .sort((a, b) => b.reliabilityScore - a.reliabilityScore)
  }

  /**
   * findBest — 查找匹配能力的最佳 Agent
   *
   * 评分: AgentScore = reliabilityScore × (1 - costPerTask)
   */
  findBest(capabilities: string[]): AgentProfile | undefined {
    const candidates = this.findByCapabilities(capabilities)
    if (candidates.length === 0) return undefined

    return candidates.sort((a, b) => {
      const scoreA = a.reliabilityScore * (1 - a.costPerTask)
      const scoreB = b.reliabilityScore * (1 - b.costPerTask)
      return scoreB - scoreA
    })[0]
  }

  /**
   * getAllCapabilities — 获取系统中所有注册的能力
   */
  getAllCapabilities(): string[] {
    const caps = new Set<string>()
    for (const agent of this.agents.values()) {
      for (const cap of agent.identity.capabilities) {
        caps.add(cap)
      }
    }
    return [...caps].sort()
  }

  /**
   * getStats — 获取 Agent 注册中心统计
   */
  getStats(): { totalAgents: number; activeAgents: number; idleAgents: number } {
    const all = [...this.agents.values()]
    return {
      totalAgents: all.length,
      activeAgents: all.filter(a => a.identity.status === 'ACTIVE').length,
      idleAgents: all.filter(a => a.identity.status === 'IDLE').length,
    }
  }
}
