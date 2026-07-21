/**
 * WorkflowPromotion — 工作流晋升管理器 (v8.9)
 *
 * 管理工作流从 DRAFT → PRODUCTION 的晋升流程。
 * 每个晋升步骤验证前置条件，不满足时返回具体缺失项。
 *
 * 晋升管道 (v8.9):
 *   DRAFT → SIMULATED:     simulationPassed === true
 *   SIMULATED → TESTED:    testsPassed === true && qualityScore >= 0.8
 *   TESTED → APPROVED:     chaosTestPassed && regressionPassed
 *   APPROVED → CANARY:     approvedBy !== undefined && productionScore >= 0.8
 *   CANARY → PRODUCTION:   canaryMetrics.passed === true && trafficPercentage >= 100
 *   PRODUCTION → DEPRECATED: explicit deprecate()
 *
 * ★ v8.9 CANARY: 灰度发布。Workflow 不能直接进入 PRODUCTION。
 *   必须先经过 CANARY 阶段，从小流量 (5%) 逐步放量到 100%。
 */

import { WorkflowLifecycleStatus, type WorkflowLifecycleEntry, type CanaryConfig, type CanaryMetrics } from './WorkflowLifecycle.js'

export class WorkflowPromotion {
  private entries: Map<string, WorkflowLifecycleEntry> = new Map()
  private stats = { totalRegistered: 0, totalDeprecated: 0 }

  register(workflowId: string): WorkflowLifecycleEntry {
    const now = Date.now()
    const entry: WorkflowLifecycleEntry = {
      workflowId,
      status: WorkflowLifecycleStatus.DRAFT,
      qualityScore: 0,
      reliabilityScore: 0,
      safetyScore: 1,
      productionScore: 0,
      simulationPassed: false,
      testsPassed: false,
      chaosTestPassed: false,
      regressionPassed: false,
      history: [{
        from: WorkflowLifecycleStatus.DRAFT,
        to: WorkflowLifecycleStatus.DRAFT,
        at: now,
        by: 'system',
      }],
    }
    this.entries.set(workflowId, entry)
    this.stats.totalRegistered++
    return entry
  }

  promote(workflowId: string): WorkflowLifecycleEntry {
    const entry = this.entries.get(workflowId)
    if (!entry) throw new Error(`[WorkflowPromotion] Workflow not registered: ${workflowId}`)

    const check = this.canPromote(workflowId)
    if (!check.allowed) return entry

    const target = this.nextStatus(entry.status)
    if (!target) return entry

    const now = Date.now()
    entry.history.push({ from: entry.status, to: target, at: now, by: 'system' })
    entry.status = target
    if (target === WorkflowLifecycleStatus.PRODUCTION) entry.promotedAt = now

    return entry
  }

  canPromote(workflowId: string): { allowed: boolean; missingRequirements: string[] } {
    const entry = this.entries.get(workflowId)
    if (!entry) return { allowed: false, missingRequirements: ['Workflow not registered'] }

    const missing: string[] = []
    switch (entry.status) {
      case WorkflowLifecycleStatus.DRAFT:
        if (!entry.simulationPassed) missing.push('simulationPassed is required')
        break
      case WorkflowLifecycleStatus.SIMULATED:
        if (!entry.testsPassed) missing.push('testsPassed is required')
        if (entry.qualityScore < 0.8) missing.push(`qualityScore >= 0.8 required (got ${entry.qualityScore})`)
        break
      case WorkflowLifecycleStatus.TESTED:
        if (!entry.chaosTestPassed) missing.push('chaosTestPassed is required')
        if (!entry.regressionPassed) missing.push('regressionPassed is required')
        break
      case WorkflowLifecycleStatus.APPROVED:
        if (entry.productionScore < 0.8) missing.push(`productionScore >= 0.8 required (got ${entry.productionScore})`)
        if (!entry.approvedBy) missing.push('human approval (approvedBy) is required')
        break
      case WorkflowLifecycleStatus.CANARY:
        if (!entry.canaryMetrics?.passed) missing.push('canary rollout not completed or failed')
        if ((entry.canaryMetrics?.trafficPercentage ?? 0) < 100) missing.push(`traffic must reach 100% (currently ${entry.canaryMetrics?.trafficPercentage ?? 0}%)`)
        break
      case WorkflowLifecycleStatus.PRODUCTION:
        return { allowed: false, missingRequirements: ['Already in PRODUCTION'] }
      case WorkflowLifecycleStatus.DEPRECATED:
        return { allowed: false, missingRequirements: ['Workflow is DEPRECATED'] }
    }
    return { allowed: missing.length === 0, missingRequirements: missing }
  }

  /** ★ v8.9: 开始灰度发布 */
  startCanary(workflowId: string, config: Partial<CanaryConfig>): void {
    const entry = this.entries.get(workflowId)
    if (!entry) throw new Error(`[WorkflowPromotion] Workflow not registered: ${workflowId}`)
    if (entry.status !== WorkflowLifecycleStatus.APPROVED) throw new Error(`Cannot start canary from status ${entry.status}`)

    const defaultConfig: CanaryConfig = {
      trafficPercentage: 5,
      minObservationPeriod: 3600000,   // 1 hour
      successThreshold: 0.95,
      maxLatencyIncrease: 1.5,
      maxCostIncrease: 2.0,
    }
    entry.canaryConfig = { ...defaultConfig, ...config }
    entry.canaryMetrics = {
      trafficPercentage: entry.canaryConfig.trafficPercentage,
      successRate: 0,
      avgLatency: 0,
      costPerExecution: 0,
      failureRate: 0,
      observationPeriod: 0,
      passed: false,
      startedAt: Date.now(),
      lastUpdated: Date.now(),
    }
    this.promote(workflowId)  // APPROVED → CANARY
  }

  /** ★ v8.9: 增加灰度流量 */
  increaseCanaryTraffic(workflowId: string, newPercentage: number): void {
    const entry = this.entries.get(workflowId)
    if (!entry) throw new Error(`[WorkflowPromotion] Workflow not registered: ${workflowId}`)
    if (entry.status !== WorkflowLifecycleStatus.CANARY) throw new Error(`Cannot increase traffic from status ${entry.status}`)
    if (newPercentage < 0 || newPercentage > 100) throw new Error(`Invalid traffic percentage: ${newPercentage}`)

    if (entry.canaryMetrics) {
      entry.canaryMetrics.trafficPercentage = newPercentage
      entry.canaryMetrics.lastUpdated = Date.now()
      if (newPercentage >= 100) {
        entry.canaryMetrics.passed = true
      }
    }
    if (entry.canaryConfig) {
      entry.canaryConfig.trafficPercentage = newPercentage
    }
  }

  /** ★ v8.9: 获取灰度状态 */
  getCanaryStatus(workflowId: string): { percentage: number; passed: boolean; metrics: CanaryMetrics | undefined } | undefined {
    const entry = this.entries.get(workflowId)
    if (!entry || !entry.canaryMetrics) return undefined
    return {
      percentage: entry.canaryMetrics.trafficPercentage,
      passed: entry.canaryMetrics.passed,
      metrics: entry.canaryMetrics,
    }
  }

  get(workflowId: string): WorkflowLifecycleEntry | undefined {
    return this.entries.get(workflowId)
  }

  listByStatus(status: WorkflowLifecycleStatus): WorkflowLifecycleEntry[] {
    return [...this.entries.values()].filter(e => e.status === status)
  }

  listAll(): WorkflowLifecycleEntry[] {
    return [...this.entries.values()]
  }

  deprecate(workflowId: string, reason: string): WorkflowLifecycleEntry {
    const entry = this.entries.get(workflowId)
    if (!entry) throw new Error(`[WorkflowPromotion] Workflow not registered: ${workflowId}`)

    const now = Date.now()
    entry.history.push({ from: entry.status, to: WorkflowLifecycleStatus.DEPRECATED, at: now, by: 'system' })
    entry.status = WorkflowLifecycleStatus.DEPRECATED
    entry.deprecationReason = reason
    this.stats.totalDeprecated++
    return entry
  }

  updateScore(workflowId: string, scores: {
    qualityScore?: number
    reliabilityScore?: number
    safetyScore?: number
    productionScore?: number
    simulationPassed?: boolean
    testsPassed?: boolean
    chaosTestPassed?: boolean
    regressionPassed?: boolean
    approvedBy?: string
  }): void {
    const entry = this.entries.get(workflowId)
    if (!entry) return

    if (scores.qualityScore !== undefined) entry.qualityScore = scores.qualityScore
    if (scores.reliabilityScore !== undefined) entry.reliabilityScore = scores.reliabilityScore
    if (scores.safetyScore !== undefined) entry.safetyScore = scores.safetyScore
    if (scores.productionScore !== undefined) entry.productionScore = scores.productionScore
    if (scores.simulationPassed !== undefined) entry.simulationPassed = scores.simulationPassed
    if (scores.testsPassed !== undefined) entry.testsPassed = scores.testsPassed
    if (scores.chaosTestPassed !== undefined) entry.chaosTestPassed = scores.chaosTestPassed
    if (scores.regressionPassed !== undefined) entry.regressionPassed = scores.regressionPassed
    if (scores.approvedBy !== undefined) { entry.approvedBy = scores.approvedBy; entry.approvedAt = Date.now() }
  }

  getStats(): { total: number; inProduction: number; deprecated: number; draft: number; tested: number; approved: number; canary: number } {
    const all = [...this.entries.values()]
    return {
      total: all.length,
      inProduction: all.filter(e => e.status === WorkflowLifecycleStatus.PRODUCTION).length,
      deprecated: all.filter(e => e.status === WorkflowLifecycleStatus.DEPRECATED).length,
      draft: all.filter(e => e.status === WorkflowLifecycleStatus.DRAFT).length,
      tested: all.filter(e => e.status === WorkflowLifecycleStatus.TESTED).length,
      approved: all.filter(e => e.status === WorkflowLifecycleStatus.APPROVED).length,
      canary: all.filter(e => e.status === WorkflowLifecycleStatus.CANARY).length,
    }
  }

  private nextStatus(current: WorkflowLifecycleStatus): WorkflowLifecycleStatus | null {
    switch (current) {
      case WorkflowLifecycleStatus.DRAFT:     return WorkflowLifecycleStatus.SIMULATED
      case WorkflowLifecycleStatus.SIMULATED: return WorkflowLifecycleStatus.TESTED
      case WorkflowLifecycleStatus.TESTED:    return WorkflowLifecycleStatus.APPROVED
      case WorkflowLifecycleStatus.APPROVED:  return WorkflowLifecycleStatus.CANARY
      case WorkflowLifecycleStatus.CANARY:    return WorkflowLifecycleStatus.PRODUCTION
      default: return null
    }
  }
}
