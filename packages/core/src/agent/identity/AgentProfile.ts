/**
 * AgentProfile — v9 Agent 性能档案
 *
 * 记录 Agent 的历史表现，用于调度决策。
 * 每次任务完成时更新，数据驱动调度。
 */

import type { AgentIdentity } from './AgentIdentity.js'

export interface AgentProfile {
  /** Agent 身份 */
  identity: AgentIdentity
  /** 历史任务成功率 0-1 */
  successRate: number
  /** 平均执行延迟 (ms) */
  avgLatency: number
  /** 单任务成本 (相对值) */
  costPerTask: number
  /** 人工升级率 0-1 (需要人类介入的频率) */
  humanEscalationRate: number
  /** 可靠性评分 0-1 */
  reliabilityScore: number
  /** 总任务数 */
  totalTasks: number
  /** 成功任务数 */
  completedTasks: number
  /** 失败任务数 */
  failedTasks: number
  /** 最后活跃时间 */
  lastActiveAt: number
  /** 失败历史 */
  failureHistory: { taskId: string; reason: string; timestamp: number }[]
  /** ★ v9.1: 协作记录（用于信任评估） */
  collaborationHistory?: { partnerId: string; successRate: number; count: number }[]
}

// ── GovernanceStats — 治理统计摘要 ──

export interface AgentGovernanceStats {
  agentId: string
  trustLevel: number
  reliabilityScore: number
  totalTasks: number
  recentSuccessRate: number
  escalationRate: number
  collaborationCount: number
  riskExposure: 'low' | 'medium' | 'high'
}

export class AgentProfileManager {
  private profiles: Map<string, AgentProfile> = new Map()

  constructor() {}

  /**
   * register — 注册新 Agent 档案
   */
  register(identity: AgentIdentity): AgentProfile {
    const profile: AgentProfile = {
      identity,
      successRate: 1,
      avgLatency: 0,
      costPerTask: 0.5,
      humanEscalationRate: 0,
      reliabilityScore: 1,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      lastActiveAt: Date.now(),
      failureHistory: [],
    }
    this.profiles.set(identity.id, profile)

    return profile
  }

  /**
   * get — 获取 Agent 档案
   */
  get(agentId: string): AgentProfile | undefined {
    return this.profiles.get(agentId)
  }

  /**
   * recordSuccess — 记录成功任务
   */
  recordSuccess(agentId: string, taskId: string, latency: number): void {
    const profile = this.profiles.get(agentId)
    if (!profile) return

    profile.totalTasks++
    profile.completedTasks++
    profile.avgLatency = profile.avgLatency === 0
      ? latency
      : Math.round((profile.avgLatency * (profile.totalTasks - 1) + latency) / profile.totalTasks)
    profile.successRate = profile.completedTasks / profile.totalTasks
    profile.reliabilityScore = Math.round(
      (profile.successRate * 0.7 + (1 - profile.humanEscalationRate) * 0.3) * 1000
    ) / 1000
    profile.lastActiveAt = Date.now()


  }

  /**
   * recordFailure — 记录失败任务
   */
  recordFailure(agentId: string, taskId: string, reason: string): void {
    const profile = this.profiles.get(agentId)
    if (!profile) return

    profile.totalTasks++
    profile.failedTasks++
    profile.successRate = profile.completedTasks / profile.totalTasks
    profile.reliabilityScore = Math.round(
      (profile.successRate * 0.7 + (1 - profile.humanEscalationRate) * 0.3) * 1000
    ) / 1000
    profile.failureHistory.push({ taskId, reason, timestamp: Date.now() })
    profile.lastActiveAt = Date.now()


  }

  /**
   * getStats — 获取 Agent 统计摘要
   */
  getStats(agentId: string): { successRate: number; reliabilityScore: number; totalTasks: number } | undefined {
    const profile = this.profiles.get(agentId)
    if (!profile) return undefined
    return {
      successRate: profile.successRate,
      reliabilityScore: profile.reliabilityScore,
      totalTasks: profile.totalTasks,
    }
  }

  /**
   * getTopAgents — 按可靠性评分排序获取 Top N Agent
   */
  getTopAgents(limit: number = 10): AgentProfile[] {
    return [...this.profiles.values()]
      .filter(p => p.identity.status === 'ACTIVE')
      .sort((a, b) => b.reliabilityScore - a.reliabilityScore)
      .slice(0, limit)
  }

  /**
   * updateStatus — 更新 Agent 状态
   */
  updateStatus(agentId: string, status: AgentIdentity['status']): void {
    const profile = this.profiles.get(agentId)
    if (profile) {
      profile.identity = { ...profile.identity, status }
    }


  }

  /**
   * getGovernanceStats — 获取 Agent 治理统计
   *
   * 基于 Profile 计算治理相关的统计指标。
   */
  /** @deprecated Governance archived — returns basic stats */
  getGovernanceStats(agentId: string): AgentGovernanceStats | undefined {
    const profile = this.profiles.get(agentId)
    if (!profile) return undefined

    const trustLevel = profile.identity.governance?.trustLevel ?? 0.5
    const escalationRate = profile.totalTasks > 0 ? profile.humanEscalationRate : 0

    // 风险暴露评估
    let riskExposure: 'low' | 'medium' | 'high' = 'low'
    if (escalationRate > 0.3 || profile.failedTasks > 5) riskExposure = 'high'
    else if (escalationRate > 0.1 || profile.failedTasks > 2) riskExposure = 'medium'

    return {
      agentId,
      trustLevel,
      reliabilityScore: profile.reliabilityScore,
      totalTasks: profile.totalTasks,
      recentSuccessRate: profile.successRate,
      escalationRate,
      collaborationCount: profile.collaborationHistory?.length ?? 0,
      riskExposure,
    }
  }

  /**
   * updateTrustLevel — 基于表现更新 Agent 信任等级
   *
   * 信任等级计算公式：
   *   trust = reliabilityScore * 0.6 + (1 - escalationRate) * 0.3 + collaborationSuccess * 0.1
   */
  updateTrustLevel(agentId: string): void {
    const profile = this.profiles.get(agentId)
    if (!profile) return
    if (!profile.identity.governance) return

    const collabRate = profile.collaborationHistory && profile.collaborationHistory.length > 0
      ? profile.collaborationHistory.reduce((s, c) => s + c.successRate, 0) / profile.collaborationHistory.length
      : 0.5

    const trustLevel = Math.round(
      (profile.reliabilityScore * 0.6 + (1 - profile.humanEscalationRate) * 0.3 + collabRate * 0.1) * 100
    ) / 100

    profile.identity.governance.trustLevel = Math.max(0, Math.min(1, trustLevel))
  }

  /**
   * recordCollaboration — 记录协作结果
   */
  recordCollaboration(agentId: string, partnerId: string, success: boolean): void {
    const profile = this.profiles.get(agentId)
    if (!profile) return

    if (!profile.collaborationHistory) profile.collaborationHistory = []

    const existing = profile.collaborationHistory.find(c => c.partnerId === partnerId)
    if (existing) {
      const total = existing.count
      existing.successRate = (existing.successRate * total + (success ? 1 : 0)) / (total + 1)
      existing.count++
    } else {
      profile.collaborationHistory.push({ partnerId, successRate: success ? 1 : 0, count: 1 })
    }
  }
}
