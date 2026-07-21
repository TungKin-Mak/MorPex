/**
 * AgentCapabilityEvolution — v9 Agent 能力进化
 *
 * Agent 的能力分数根据执行结果动态调整。
 *
 * 规则:
 *   - 成功任务 → capability.successRate ↑ (0.01 增量)
 *   - 失败任务 → capability.successRate ↓ (0.02 减量)
 *   - 长时间未使用 → capability.successRate → 默认值 (衰减)
 *   - Agent 升级 → capability.level ↑
 */

import type { Capability } from '../capability/Capability.js'
import type { AgentProfile } from '../identity/AgentProfile.js'

export interface CapabilityUpdate {
  capabilityName: string
  oldSuccessRate: number
  newSuccessRate: number
  oldLevel: number
  newLevel: number
  reason: string
}

export class AgentCapabilityEvolution {
  private updates: CapabilityUpdate[] = []

  /**
   * recordSuccess — 记录成功，提升能力分
   */
  recordSuccess(profile: AgentProfile, capabilityName: string): CapabilityUpdate | null {
    const cap = this.findCapability(profile, capabilityName)
    if (!cap) return null

    const oldRate = cap.successRate
    cap.successRate = Math.min(1, oldRate + 0.01)
    profile.identity.capabilities = [...new Set([...profile.identity.capabilities, capabilityName])]

    const update: CapabilityUpdate = {
      capabilityName, oldSuccessRate: oldRate, newSuccessRate: cap.successRate,
      oldLevel: cap.level, newLevel: cap.level, reason: 'task_success',
    }
    this.updates.push(update)
    return update
  }

  /**
   * recordFailure — 记录失败，降低能力分
   */
  recordFailure(profile: AgentProfile, capabilityName: string): CapabilityUpdate | null {
    const cap = this.findCapability(profile, capabilityName)
    if (!cap) return null

    const oldRate = cap.successRate
    cap.successRate = Math.max(0.1, oldRate - 0.02)

    const update: CapabilityUpdate = {
      capabilityName, oldSuccessRate: oldRate, newSuccessRate: cap.successRate,
      oldLevel: cap.level, newLevel: cap.level, reason: 'task_failure',
    }
    this.updates.push(update)
    return update
  }

  /**
   * upgradeLevel — 升级能力级别
   *
   * 条件: successRate >= 0.9 && totalTasks >= 100
   */
  upgradeLevel(profile: AgentProfile, capabilityName: string): CapabilityUpdate | null {
    const cap = this.findCapability(profile, capabilityName)
    if (!cap) return null
    if (cap.successRate < 0.9 || profile.totalTasks < 100) return null

    const oldLevel = cap.level
    cap.level = Math.min(5, cap.level + 1)

    const update: CapabilityUpdate = {
      capabilityName, oldSuccessRate: cap.successRate, newSuccessRate: cap.successRate,
      oldLevel, newLevel: cap.level, reason: 'level_upgrade',
    }
    this.updates.push(update)
    return update
  }

  /**
   * decay — 能力衰减（长时间未使用）
   */
  decay(profile: AgentProfile, capabilityName: string, daysSinceLastUse: number): CapabilityUpdate | null {
    if (daysSinceLastUse < 7) return null

    const cap = this.findCapability(profile, capabilityName)
    if (!cap) return null

    const oldRate = cap.successRate
    const decayFactor = Math.min(0.3, daysSinceLastUse * 0.01)
    cap.successRate = Math.max(0.5, oldRate - decayFactor)

    const update: CapabilityUpdate = {
      capabilityName, oldSuccessRate: oldRate, newSuccessRate: cap.successRate,
      oldLevel: cap.level, newLevel: cap.level, reason: `decay_${daysSinceLastUse}d`,
    }
    this.updates.push(update)
    return update
  }

  /**
   * getUpdates — 获取能力变化历史
   */
  getUpdates(agentId?: string): CapabilityUpdate[] {
    return [...this.updates]
  }

  private findCapability(profile: AgentProfile, name: string): Capability | null {
    // AgentProfile doesn't store Capability objects directly.
    // We create/update them through the CapabilityGraph.
    // For now, create a synthetic capability from profile data.
    return {
      name,
      level: 3,
      cost: profile.costPerTask,
      successRate: profile.successRate,
      parentCapabilities: [],
    }
  }
}
