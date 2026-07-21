/**
 * AgentLifecycle — v9 Agent 生命周期管理
 *
 * Agent 状态流转:
 *   ACTIVE → IDLE → SUSPENDED → DEPRECATED
 *     ↓        ↓         ↓
 *   ACTIVE   ACTIVE    IDLE (reactivate)
 *
 * 自动规则:
 *   - 连续 50 次失败 → DEPRECATED
 *   - 超过 30 分钟无任务 → IDLE
 *   - reliabilityScore < 0.3 → SUSPENDED
 */

import type { AgentIdentity } from '../identity/AgentIdentity.js'
import type { AgentProfile } from '../identity/AgentProfile.js'
import type { AgentRegistry } from '../registry/AgentRegistry.js'
import type { AgentGovernanceRepository } from '../governance/AgentGovernanceRepository.js'

export interface LifecycleEvent {
  agentId: string
  from: AgentIdentity['status']
  to: AgentIdentity['status']
  reason: string
  timestamp: number
}

export class AgentLifecycle {
  private history: LifecycleEvent[] = []

  constructor(private governanceRepo?: AgentGovernanceRepository) {}

  /**
   * evaluate — 评估 Agent 状态是否需要变更
   */
  evaluate(profile: AgentProfile): AgentIdentity['status'] | null {
    const status = profile.identity.status

    // 连续失败过多 → DEPRECATED
    if (profile.failedTasks >= 50 && profile.successRate < 0.3) {
      if (status !== 'DEPRECATED') return 'DEPRECATED'
    }

    // 可靠性过低 → SUSPENDED
    if (profile.reliabilityScore < 0.3 && status === 'ACTIVE') {
      return 'SUSPENDED'
    }

    // 长时间无活动 → IDLE
    const idleTime = Date.now() - profile.lastActiveAt
    if (idleTime > 30 * 60 * 1000 && status === 'ACTIVE') { // 30 min
      return 'IDLE'
    }

    // 恢复: SUSPENDED → IDLE (if reliability improved)
    if (status === 'SUSPENDED' && profile.reliabilityScore >= 0.5 && profile.totalTasks > 100) {
      return 'IDLE'
    }

    // 恢复: IDLE → ACTIVE (if recently active)
    if (status === 'IDLE' && idleTime < 5 * 60 * 1000 && profile.reliabilityScore >= 0.6) { // 5 min
      return 'ACTIVE'
    }

    return null
  }

  /**
   * transition — 执行状态转换
   */
  transition(profile: AgentProfile, newStatus: AgentIdentity['status'], reason: string): void {
    const oldStatus = profile.identity.status
    if (oldStatus === newStatus) return

    profile.identity.status = newStatus

    this.history.push({
      agentId: profile.identity.id,
      from: oldStatus,
      to: newStatus,
      reason,
      timestamp: Date.now(),
    })

    // ★ P0: 持久化治理日志
    if (this.governanceRepo) {
      try {
        this.governanceRepo.recordGovernance(
          profile.identity.id, 'lifecycle_transition', newStatus, reason
        )
      } catch (err) {
        console.warn('[AgentLifecycle] Governance log failed:', err)
      }
    }
  }

  /**
   * activate — 激活 Agent
   */
  activate(profile: AgentProfile): void {
    this.transition(profile, 'ACTIVE', 'Manual activation')
  }

  /**
   * suspend — 暂停 Agent
   */
  suspend(profile: AgentProfile, reason: string): void {
    this.transition(profile, 'SUSPENDED', reason)
  }

  /**
   * deprecate — 废弃 Agent
   */
  deprecate(profile: AgentProfile, reason: string): void {
    this.transition(profile, 'DEPRECATED', reason)
  }

  /**
   * autoEvaluateAll — 批量评估并自动转换
   */
  autoEvaluateAll(registry: AgentRegistry): LifecycleEvent[] {
    const events: LifecycleEvent[] = []
    const profiles = registry.listAgents()

    for (const profile of profiles) {
      const newStatus = this.evaluate(profile)
      if (newStatus) {
        this.transition(profile, newStatus, 'Auto evaluation')
        events.push(this.history[this.history.length - 1])
      }
    }

    return events
  }

  /**
   * getHistory — 获取状态转换历史
   */
  getHistory(agentId?: string): LifecycleEvent[] {
    if (agentId) return this.history.filter(e => e.agentId === agentId)
    return [...this.history]
  }
}
