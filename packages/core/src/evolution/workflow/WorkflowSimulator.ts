/**
 * WorkflowSimulator — 工作流仿真引擎
 *
 * MorPex v8.7: 在 PolicyEngine 决策之前对 WorkflowCandidate 进行离线仿真验证。
 *
 * 职责:
 *   1. 对候选工作流进行历史回放仿真
 *   2. 计算多维度指标 (successRate, failureModes, avgLatency, riskScore, resourceCost)
 *   3. 生成 SimulationResult 供 PolicyEngine 决策
 *   4. 不再自行决策通过/拒绝 — 阈值由 PolicyEngine 管理
 *
 * 新流程 (v8.7):
 *   WorkflowMiner → WorkflowSimulator → SimulationResult → PolicyEngine → Human Approval → Registry
 *
 * 质量阈值:
 *   ⚠️ 已由 PolicyEngine.evaluateWorkflow() 接管，WorkflowSimulator 不再硬编码阈值
 */

import type { Mission } from '../../runtime/mission/types.js'
import type {
  WorkflowCandidate,
  WorkflowStepDef,
  WorkflowSimulationContext,
  SimulationResult,
  SimulationMetrics,
  SimulatorConfig,
  WorkflowFailureMode,
} from './types.js'

const DEFAULT_CONFIG: SimulatorConfig = {
  defaultQualityScore: 0.6,
  minReferenceMissions: 3,
}

// ── 敏感工具/领域检测 ──
const RISKY_KEYWORDS = ['delete', 'deploy', 'remove', 'terminate', 'destroy', 'drop', 'truncate']
const FINANCE_KEYWORDS = ['payment', 'transaction', 'transfer', 'invoice', 'refund', 'price']
const SENSITIVE_KEYWORDS = ['email', 'password', 'credential', 'token', 'secret', 'key']

// ═══════════════════════════════════════════════════════════════
// WorkflowSimulator
// ═══════════════════════════════════════════════════════════════

export class WorkflowSimulator {
  private config: SimulatorConfig
  private stats = {
    totalSimulations: 0,
    totalPassed: 0,
    totalRejected: 0,
  }

  constructor(config?: Partial<SimulatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * simulate — 对候选工作流进行多维度仿真
   *
   * @param candidate - 待仿真的工作流候选
   * @param historicalMissions - 参考的历史 Mission 列表
   * @param context - 仿真上下文（工作流类型、风险容忍度等）
   * @returns SimulationResult（完整多维度结果，由 PolicyEngine 决策）
   */
  async simulate(
    candidate: WorkflowCandidate,
    historicalMissions: Mission[],
    context?: WorkflowSimulationContext,
  ): Promise<SimulationResult> {
    const startTime = Date.now()
    const ctx = context ?? this.defaultContext()

    // 1. 评估成功率
    const successRate = this.estimateSuccessRate(candidate, historicalMissions)

    // 2. 评估执行时长
    const avgLatency = this.estimateAvgLatency(candidate, historicalMissions)

    // 3. 评估资源效率 → resourceCost
    const resourceEfficiency = this.estimateResourceEfficiency(candidate)
    const resourceCost = Math.round((1 - resourceEfficiency) * 100) / 100

    // 4. 评估错误率
    const errorRate = this.estimateErrorRate(candidate, historicalMissions)

    // 5. 检测失败模式
    const failureModes = this.detectFailureModes(candidate, historicalMissions)

    // 6. 计算风险评分
    const riskScore = this.computeRiskScore(candidate, ctx)

    // 7. 步骤合理性
    const stepReasonableness = this.assessStepReasonableness(candidate)

    // 8. 综合质量评分
    const qualityScore = this.computeQualityScore({
      successRate,
      avgDurationMs: avgLatency,
      resourceEfficiency,
      errorRate,
      stepReasonableness,
    })

    // 9. 仿真置信度 — 基于参考 Mission 数量
    const confidence = Math.min(1, (historicalMissions.length || 1) / 10)

    // 10. 生成优化建议
    const recommendations = this.generateRecommendations(candidate, {
      successRate,
      avgDurationMs: avgLatency,
      resourceEfficiency,
      errorRate,
      stepReasonableness,
    })

    // ⚠️ passed 默认为 true — 最终决策由 PolicyEngine 完成
    this.stats.totalSimulations++

    return {
      workflowId: 'wf_sim_' + (candidate.name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_'),
      candidateName: candidate.name,
      executions: historicalMissions.length,
      successRate,
      failureModes,
      avgLatency,
      resourceCost,
      riskScore,
      qualityScore,
      confidence,
      passed: true, // PolicyEngine 会重新评估
      metrics: {
        successRate,
        avgDurationMs: avgLatency,
        resourceEfficiency,
        errorRate,
        stepReasonableness,
      },
      recommendations,
      simulationDurationMs: Date.now() - startTime,
      referenceMissions: historicalMissions.length,
    }
  }

  /**
   * getStats — 获取仿真统计
   */
  getStats(): { totalSimulations: number; totalPassed: number; totalRejected: number } {
    return { ...this.stats }
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  private defaultContext(): WorkflowSimulationContext {
    return {
      workflowType: 'general',
      riskTolerance: 'medium',
      historicalExecutions: 0,
      domainConstraints: [],
    }
  }

  /**
   * estimateSuccessRate — 基于历史 Mission 估算候选成功率
   */
  private estimateSuccessRate(
    candidate: WorkflowCandidate,
    missions: Mission[],
  ): number {
    if (missions.length === 0) return this.config.defaultQualityScore

    const stepNames = new Set(
      (candidate.steps || []).map(s => s.name.toLowerCase()),
    )
    if (stepNames.size === 0) return this.config.defaultQualityScore

    const matching = missions.filter(m => {
      const goal = (m.goal || '').toLowerCase()
      for (const name of stepNames) {
        if (goal.includes(name)) return true
      }
      return false
    })

    if (matching.length === 0) return this.config.defaultQualityScore
    const successful = matching.filter(m => m.state === 'COMPLETED').length
    return successful / matching.length
  }

  /**
   * estimateAvgLatency — 基于源 Mission 估算平均执行时长
   */
  private estimateAvgLatency(
    candidate: WorkflowCandidate,
    missions: Mission[],
  ): number {
    const sourceIds = candidate.sourceMissionIds || []
    if (sourceIds.length === 0 || missions.length === 0) return 30000

    const sourceMissions = missions.filter(m => sourceIds.includes(m.id))
    if (sourceMissions.length === 0) return 30000

    const durations = sourceMissions
      .map(m => {
        const meta = m.metadata as Record<string, unknown> | undefined
        if (meta?.duration) return Number(meta.duration)
        if (m.updatedAt && m.createdAt) return m.updatedAt - m.createdAt
        return 0
      })
      .filter(d => d > 0)

    return durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 30000
  }

  /**
   * estimateResourceEfficiency — 基于步骤数量和依赖复杂度估算
   */
  private estimateResourceEfficiency(candidate: WorkflowCandidate): number {
    const steps = candidate.steps || []
    if (steps.length === 0) return 0.5

    const stepCount = steps.length
    let stepFactor: number
    if (stepCount <= 3) stepFactor = 0.7
    else if (stepCount <= 5) stepFactor = 0.9
    else if (stepCount <= 8) stepFactor = 1.0
    else if (stepCount <= 12) stepFactor = 0.8
    else stepFactor = 0.5

    const depsCount = steps.filter(s => s.deps && s.deps.length > 0).length
    const depFactor = depsCount === 0 ? 1.0 : Math.max(0.3, 1.0 - depsCount / (stepCount * 2))

    return Math.round((stepFactor * 0.6 + depFactor * 0.4) * 100) / 100
  }

  /**
   * estimateErrorRate — 基于源 Mission 失败率 + 风险工具检测
   */
  private estimateErrorRate(
    candidate: WorkflowCandidate,
    missions: Mission[],
  ): number {
    const sourceIds = candidate.sourceMissionIds || []
    let baseErrorRate = 0.2

    if (sourceIds.length > 0 && missions.length > 0) {
      const sourceMissions = missions.filter(m => sourceIds.includes(m.id))
      if (sourceMissions.length > 0) {
        const failed = sourceMissions.filter(m => m.state === 'FAILED').length
        baseErrorRate = failed / sourceMissions.length
      }
    }

    const steps = candidate.steps || []
    const riskySteps = steps.filter(s => {
      const name = (s.name || '').toLowerCase()
      const desc = (s.description || '').toLowerCase()
      return RISKY_KEYWORDS.some(k => name.includes(k) || desc.includes(k))
    })

    const riskFactor = riskySteps.length > 0
      ? 1.0 + (riskySteps.length / Math.max(1, steps.length))
      : 1.0

    return Math.min(1.0, Math.round(baseErrorRate * riskFactor * 100) / 100)
  }

  /**
   * detectFailureModes — 检测历史失败模式
   *
   * 从历史 Mission 的失败记录中分类失败原因。
   */
  private detectFailureModes(
    candidate: WorkflowCandidate,
    missions: Mission[],
  ): WorkflowFailureMode[] {
    const sourceIds = candidate.sourceMissionIds || []

    if (sourceIds.length === 0) return []

    const failed = missions.filter(
      m => sourceIds.includes(m.id) && (m.state === 'FAILED' || m.error),
    )

    if (failed.length === 0) return []

    const totalFailed = failed.length
    const result: WorkflowFailureMode[] = []

    // 分类失败原因
    const patterns: { name: string; test: (m: Mission) => boolean }[] = [
      {
        name: 'timeout',
        test: (m: Mission) => {
          const err = (m.error || '').toLowerCase()
          return err.includes('timeout') || err.includes('超时')
        },
      },
      {
        name: 'permission_denied',
        test: (m: Mission) => {
          const err = (m.error || '').toLowerCase()
          return err.includes('permission') || err.includes('权限') || err.includes('denied') || err.includes('forbidden')
        },
      },
      {
        name: 'tool_failure',
        test: (m: Mission) => {
          const err = (m.error || '').toLowerCase()
          return err.includes('tool') || err.includes('工具') || err.includes('not found') || err.includes('api_error')
        },
      },
      {
        name: 'resource_exhausted',
        test: (m: Mission) => {
          const err = (m.error || '').toLowerCase()
          return err.includes('memory') || err.includes('oom') || err.includes('quota') || err.includes('资源')
        },
      },
      {
        name: 'logic_error',
        test: (m: Mission) => {
          const err = (m.error || '').toLowerCase()
          return err.includes('assertion') || err.includes('incorrect') || err.includes('unexpected') || err.includes('逻辑')
        },
      },
      {
        name: 'unknown',
        test: () => true,
      },
    ]

    for (const pattern of patterns) {
      if (pattern.name === 'unknown') {
        const matchedCount = result.reduce((sum, fm) => sum + fm.count, 0)
        const unknownCount = totalFailed - matchedCount
        if (unknownCount > 0) {
          result.push({
            name: 'unknown',
            count: unknownCount,
            ratio: Math.round((unknownCount / totalFailed) * 100) / 100,
            exampleMissionId: failed.find(m => !patterns.some(p => p !== pattern && p.test(m)))?.id || '',
          })
        }
      } else {
        const matched = failed.filter(pattern.test)
        if (matched.length > 0) {
          result.push({
            name: pattern.name,
            count: matched.length,
            ratio: Math.round((matched.length / totalFailed) * 100) / 100,
            exampleMissionId: matched[0].id,
          })
        }
      }
    }

    return result.sort((a, b) => b.count - a.count)
  }

  /**
   * computeRiskScore — 计算风险评分 (0-100)
   *
   * 基于:
   *   - 步骤中使用风险工具的比例
   *   - 涉及敏感领域 (finance/deployment)
   *   - 历史失败率
   */
  private computeRiskScore(
    candidate: WorkflowCandidate,
    context: WorkflowSimulationContext,
  ): number {
    const steps = candidate.steps || []
    let score = 0

    // 风险工具检测
    const stepNames = steps.map(s => (s.name || '').toLowerCase())
    const riskyCount = stepNames.filter(n => RISKY_KEYWORDS.some(k => n.includes(k))).length
    score += riskyCount * 15

    // 敏感工具 (email/password/credential)
    const sensitiveCount = stepNames.filter(n => SENSITIVE_KEYWORDS.some(k => n.includes(k))).length
    score += sensitiveCount * 10

    // 工作流类型加成
    if (context.workflowType === 'finance' || context.workflowType === 'deployment') {
      score += 20
    }

    // 步骤过多
    if (steps.length > 15) score += 15
    else if (steps.length > 10) score += 10

    // 循环依赖
    if (this.hasCycle(steps)) score += 25

    return Math.min(100, score)
  }

  /**
   * hasCycle — 检测依赖中是否存在循环
   */
  private hasCycle(steps: WorkflowStepDef[]): boolean {
    const depMap = new Map<string, string[]>()
    for (const s of steps) {
      depMap.set(s.name, s.deps || [])
    }
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const dfs = (node: string): boolean => {
      if (inStack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      inStack.add(node)
      for (const dep of depMap.get(node) || []) {
        if (dfs(dep)) return true
      }
      inStack.delete(node)
      return false
    }

    for (const step of steps) {
      if (dfs(step.name)) return true
    }
    return false
  }

  /**
   * assessStepReasonableness — 评估步骤合理性
   */
  private assessStepReasonableness(candidate: WorkflowCandidate): number {
    const steps = candidate.steps || []
    if (steps.length === 0) return 0.3

    let score = 1.0
    if (steps.length > 20) score -= 0.3
    else if (steps.length > 15) score -= 0.2
    else if (steps.length > 10) score -= 0.1

    const emptyNames = steps.filter(s => !s.name || s.name.trim() === '').length
    if (emptyNames > 0) score -= 0.1 * emptyNames

    const deps = steps.flatMap(s => s.deps || [])
    if (deps.length > new Set(deps).size) score -= 0.2

    const selfRefs = steps.filter(s => (s.deps || []).includes(s.name))
    if (selfRefs.length > 0) score -= 0.3

    return Math.max(0, Math.round(score * 100) / 100)
  }

  /**
   * computeQualityScore — 加权综合评分
   */
  private computeQualityScore(metrics: SimulationMetrics): number {
    const score =
      metrics.successRate * 0.40 +
      metrics.resourceEfficiency * 0.25 +
      metrics.stepReasonableness * 0.20 +
      (1 - metrics.errorRate) * 0.15
    return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
  }

  /**
   * generateRecommendations — 基于指标生成优化建议
   */
  private generateRecommendations(
    candidate: WorkflowCandidate,
    metrics: SimulationMetrics,
  ): string[] {
    const recs: string[] = []

    if (metrics.successRate < 0.6) {
      recs.push('历史成功率较低，建议增加验证步骤或降级风险')
    }

    if (metrics.resourceEfficiency < 0.5) {
      recs.push('资源效率偏低，建议减少步骤数量或简化依赖关系')
    }

    if (metrics.errorRate > 0.3) {
      recs.push('预估错误率较高，建议增加错误处理和回退机制')
    }

    if (metrics.stepReasonableness < 0.5) {
      recs.push('步骤结构不合理，建议检查循环依赖和空步骤')
    }

    const steps = candidate.steps || []
    if (steps.length > 10) {
      recs.push('步骤数超过 10，建议拆分为多个子工作流')
    }

    if (recs.length === 0) {
      recs.push('仿真通过，工作流结构合理')
    }

    return recs
  }
}
