/**
 * AgentAutoOptimizer — v9 Agent 自动优化
 *
 * 根据历史表现自动调整 Agent 策略参数。
 * 不修改 Agent 核心逻辑，只调整可配置参数。
 *
 * 优化维度:
 *   - taskTimeout: 根据历史延迟调整超时时间
 *   - retryCount: 根据失败率调整重试次数
 *   - priority: 根据成功率调整调度优先级
 *   - capabilityLevel: 根据使用频率调整能力权重
 */

import type { AgentProfile } from '../identity/AgentProfile.js'
import type { AgentRegistry } from '../registry/AgentRegistry.js'

export interface OptimizationParams {
  taskTimeout: number           // ms
  retryCount: number
  priorityBoost: number         // 0-1, added to scheduler score
  concurrencyLimit: number      // max concurrent tasks
  cooldownPeriod: number        // ms, wait between tasks
}

export interface OptimizationResult {
  agentId: string
  oldParams: OptimizationParams
  newParams: OptimizationParams
  changes: string[]
  reason: string
  timestamp: number
}

const DEFAULT_PARAMS: OptimizationParams = {
  taskTimeout: 300000,          // 5 min
  retryCount: 3,
  priorityBoost: 0,
  concurrencyLimit: 5,
  cooldownPeriod: 0,
}

export class AgentAutoOptimizer {
  private params: Map<string, OptimizationParams> = new Map()
  private history: OptimizationResult[] = []

  /**
   * getParams — 获取 Agent 当前参数
   */
  getParams(agentId: string): OptimizationParams {
    return this.params.get(agentId) ?? { ...DEFAULT_PARAMS }
  }

  /**
   * optimize — 根据性能数据优化参数
   */
  optimize(profile: AgentProfile): OptimizationResult | null {
    const agentId = profile.identity.id
    const oldParams = this.getParams(agentId)
    const newParams = { ...oldParams }
    const changes: string[] = []

    // 1. 高成功率 → 减少超时 (更快失败, 更快重试)
    if (profile.successRate > 0.95 && profile.totalTasks > 50) {
      const newTimeout = Math.max(60000, oldParams.taskTimeout - 30000)
      if (newTimeout !== oldParams.taskTimeout) {
        newParams.taskTimeout = newTimeout
        changes.push(`taskTimeout: ${oldParams.taskTimeout}ms → ${newTimeout}ms (high success rate)`)
      }
    }

    // 2. 低成功率 → 增加重试
    if (profile.successRate < 0.7 && profile.totalTasks > 20) {
      const newRetry = Math.min(5, oldParams.retryCount + 1)
      if (newRetry !== oldParams.retryCount) {
        newParams.retryCount = newRetry
        changes.push(`retryCount: ${oldParams.retryCount} → ${newRetry} (low success rate)`)
      }
    }

    // 3. 高可靠性 → 提升调度优先级
    if (profile.reliabilityScore > 0.9 && profile.totalTasks > 100) {
      const newBoost = Math.min(0.3, oldParams.priorityBoost + 0.05)
      if (newBoost !== oldParams.priorityBoost) {
        newParams.priorityBoost = newBoost
        changes.push(`priorityBoost: ${oldParams.priorityBoost} → ${newBoost} (high reliability)`)
      }
    }

    // 4. 低可靠性 → 降低并发
    if (profile.reliabilityScore < 0.5 && oldParams.concurrencyLimit > 1) {
      newParams.concurrencyLimit = Math.max(1, oldParams.concurrencyLimit - 1)
      changes.push(`concurrencyLimit: ${oldParams.concurrencyLimit} → ${newParams.concurrencyLimit} (low reliability)`)
    }

    // 5. 高失败率 → 增加冷却时间 (避免连续失败)
    if (profile.failedTasks > 10 && profile.successRate < 0.5) {
      const newCooldown = Math.min(30000, oldParams.cooldownPeriod + 5000)
      if (newCooldown !== oldParams.cooldownPeriod) {
        newParams.cooldownPeriod = newCooldown
        changes.push(`cooldownPeriod: ${oldParams.cooldownPeriod}ms → ${newCooldown}ms (high failure rate)`)
      }
    }

    // 6. 长时间稳定 → 恢复默认
    if (profile.successRate > 0.98 && profile.totalTasks > 500 && profile.reliabilityScore > 0.95) {
      if (oldParams.concurrencyLimit < DEFAULT_PARAMS.concurrencyLimit) {
        newParams.concurrencyLimit = DEFAULT_PARAMS.concurrencyLimit
        changes.push(`concurrencyLimit: restored to ${DEFAULT_PARAMS.concurrencyLimit}`)
      }
      if (oldParams.cooldownPeriod > 0) {
        newParams.cooldownPeriod = 0
        changes.push('cooldownPeriod: removed (stable)')
      }
    }

    if (changes.length === 0) return null

    this.params.set(agentId, newParams)

    const result: OptimizationResult = {
      agentId,
      oldParams,
      newParams,
      changes,
      reason: `optimized based on ${profile.totalTasks} tasks (SR=${profile.successRate.toFixed(2)}, RS=${profile.reliabilityScore.toFixed(2)})`,
      timestamp: Date.now(),
    }
    this.history.push(result)
    return result
  }

  /**
   * optimizeAll — 优化所有 Agent
   */
  optimizeAll(registry: AgentRegistry): OptimizationResult[] {
    const results: OptimizationResult[] = []
    for (const profile of registry.listAgents('ACTIVE')) {
      const result = this.optimize(profile)
      if (result) results.push(result)
    }
    return results
  }

  /**
   * getHistory — 获取优化历史
   */
  getHistory(agentId?: string): OptimizationResult[] {
    if (agentId) return this.history.filter(h => h.agentId === agentId)
    return [...this.history]
  }

  /**
   * reset — 重置 Agent 参数到默认值
   */
  reset(agentId: string): void {
    this.params.set(agentId, { ...DEFAULT_PARAMS })
  }
}
