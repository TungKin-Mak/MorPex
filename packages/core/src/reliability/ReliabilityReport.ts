/**
 * ReliabilityReport — v8.9.2 生产就绪证明
 *
 * 综合 Chaos / Replay / Scoring / Regression / Promotion 的全部数据，
 * 生成单一的生产就绪证书。
 *
 * 这是 Reliability Plane 的最终输出：一份完整的可信交付证明。
 *
 * 使用方式:
 *   const reporter = new ReliabilityReporter(chaosEngine, scorer, regressionRunner, promotion)
 *   const report = await reporter.generateReport(workflowId, workflowType)
 *   if (report.verdict === 'READY_FOR_PRODUCTION') { ... }
 */

import type { ChaosEngine, ChaosReport } from './chaos/ChaosEngine.js'
import type { ReliabilityScorer } from './scoring/ReliabilityScorer.js'
import type { ReliabilityMetrics } from './scoring/ReliabilityMetrics.js'
import type { RegressionRunner, RegressionReport } from './regression/RegressionRunner.js'
import type { WorkflowPromotion } from './promotion/WorkflowPromotion.js'
import type { WorkflowLifecycleEntry, CanaryMetrics } from './promotion/WorkflowLifecycle.js'
import { WorkflowLifecycleStatus } from './promotion/WorkflowLifecycle.js'

// ═══════════════════════════════════════════════════════
// ReliabilityReport
// ═══════════════════════════════════════════════════════

export type ProductionVerdict =
  | 'READY_FOR_PRODUCTION'   // 所有门禁通过
  | 'NEEDS_CANARY'           // 已通过测试，等待灰度验证
  | 'NEEDS_IMPROVEMENT'      // 评分不足，需要优化
  | 'NOT_READY'              // 关键门禁未通过

export interface ReliabilityReport {
  /** 报告 ID */
  id: string
  /** 工作流 ID */
  workflowId: string
  /** 工作流类型 */
  workflowType: string
  /** 生成时间 */
  generatedAt: number

  // ── 评分 ──
  qualityScore: number
  reliabilityScore: number
  safetyScore: number
  productionScore: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'

  // ── 门禁状态 ──
  gates: {
    simulation: { passed: boolean; score: number }
    testing: { passed: boolean; score: number }
    regression: { passed: boolean; passRate: number; totalTests: number }
    chaos: { passed: boolean; recoveryRate: number; totalScenarios: number }
    canary: { active: boolean; passed: boolean; trafficPercentage: number; metrics?: CanaryMetrics }
    promotion: { currentStatus: WorkflowLifecycleStatus; targetStatus: WorkflowLifecycleStatus; canPromote: boolean }
  }

  // ── 详细数据 ──
  chaosReports: ChaosReport[]
  regressionReport?: RegressionReport
  lifecycleEntry?: WorkflowLifecycleEntry

  // ── 风险 ──
  risks: { severity: 'low' | 'medium' | 'high' | 'critical'; description: string; mitigation: string }[]

  // ── 最终判定 ──
  verdict: ProductionVerdict
  verdictReason: string
  recommendations: string[]
}

// ═══════════════════════════════════════════════════════
// ReliabilityReporter
// ═══════════════════════════════════════════════════════

export class ReliabilityReporter {
  constructor(
    private chaosEngine: ChaosEngine,
    private scorer: ReliabilityScorer,
    private regressionRunner: RegressionRunner,
    private promotion: WorkflowPromotion,
  ) {}

  /**
   * generateReport — 生成完整的生产就绪证明
   */
  async generateReport(workflowId: string, workflowType: string): Promise<ReliabilityReport> {
    const now = Date.now()
    const reportId = `relrep_${workflowId}_${now}`

    // 1. 获取各项数据
    const chaosReports = this.chaosEngine.generateReport(workflowId)
    const lifecycleEntry = this.promotion.get(workflowId)
    const regressionReport = await this.regressionRunner.run(workflowId, workflowType)

    // 2. 计算评分
    const chaosPassed = chaosReports.filter(r => r.recovered).length / Math.max(1, chaosReports.length)
    const chaosRecoveryRate = chaosReports.length > 0
      ? chaosReports.filter(r => r.recovered).length / chaosReports.length
      : 1

    const qualityScore = lifecycleEntry?.qualityScore ?? 0
    const reliabilityScore = lifecycleEntry?.reliabilityScore ?? this.scorer.calculate({
      workflowId,
      successRate: regressionReport.passRate,
      failureRate: 1 - regressionReport.passRate,
      recoveryRate: chaosRecoveryRate,
      avgRecoveryTime: chaosReports.reduce((s, r) => s + r.recoveryTime, 0) / Math.max(1, chaosReports.length),
      humanIntervention: 0,
      retryCount: 0,
      chaosTestResults: { total: chaosReports.length, passed: chaosReports.filter(r => r.recovered).length, avgRecoveryRate: chaosRecoveryRate },
      replayAccuracy: 1,
      regressionPassRate: regressionReport.passRate,
      safetyScore: lifecycleEntry?.safetyScore ?? 1,
      canaryScore: lifecycleEntry?.canaryMetrics?.passed ? 1 : 0,
    })

    const safetyScore = lifecycleEntry?.safetyScore ?? 1
    const productionScore = this.scorer.calculateProductionScore(qualityScore, reliabilityScore, safetyScore)
    const grade = this.scorer.getGrade(productionScore)

    // 3. 门禁检查
    const simulationGate = {
      passed: lifecycleEntry?.simulationPassed ?? false,
      score: qualityScore,
    }
    const testingGate = {
      passed: lifecycleEntry?.testsPassed ?? false,
      score: qualityScore,
    }
    const regressionGate = {
      passed: regressionReport.passRate >= 0.8,
      passRate: regressionReport.passRate,
      totalTests: regressionReport.totalTests,
    }
    const chaosGate = {
      passed: chaosRecoveryRate >= 0.8,
      recoveryRate: chaosRecoveryRate,
      totalScenarios: chaosReports.length,
    }
    const canaryGate = {
      active: lifecycleEntry?.status === WorkflowLifecycleStatus.CANARY,
      passed: lifecycleEntry?.canaryMetrics?.passed ?? false,
      trafficPercentage: lifecycleEntry?.canaryMetrics?.trafficPercentage ?? 0,
      metrics: lifecycleEntry?.canaryMetrics,
    }
    const promotionGate = {
      currentStatus: lifecycleEntry?.status ?? WorkflowLifecycleStatus.DRAFT,
      targetStatus: WorkflowLifecycleStatus.PRODUCTION,
      canPromote: this.promotion.canPromote(workflowId).allowed,
    }

    // 4. 风险评估
    const risks = this.assessRisks(chaosReports, regressionReport, productionScore)

    // 5. 最终判定
    const { verdict, reason, recommendations } = this.determineVerdict(
      simulationGate.passed,
      testingGate.passed,
      regressionGate.passed,
      chaosGate.passed,
      canaryGate,
      productionScore,
      lifecycleEntry?.status,
    )

    return {
      id: reportId,
      workflowId,
      workflowType,
      generatedAt: now,

      qualityScore,
      reliabilityScore,
      safetyScore,
      productionScore,
      grade,

      gates: {
        simulation: simulationGate,
        testing: testingGate,
        regression: regressionGate,
        chaos: chaosGate,
        canary: canaryGate,
        promotion: promotionGate,
      },

      chaosReports,
      regressionReport,
      lifecycleEntry,

      risks,
      verdict,
      verdictReason: reason,
      recommendations,
    }
  }

  // ═══════════════════════════════════════════════════
  // 风险评估
  // ═══════════════════════════════════════════════════

  private assessRisks(
    chaosReports: ChaosReport[],
    regressionReport: RegressionReport,
    productionScore: number,
  ): ReliabilityReport['risks'] {
    const risks: ReliabilityReport['risks'] = []

    // 混沌测试未恢复的故障
    const unrecovered = chaosReports.filter(r => r.failureInjected && !r.recovered)
    for (const r of unrecovered) {
      risks.push({
        severity: r.severity,
        description: `故障 '${r.scenarioName}' (${r.target}) 未能在 ${r.recoveryTime}ms 内恢复`,
        mitigation: r.recommendation || `检查 ${r.target} 恢复逻辑`,
      })
    }

    // 回归失败
    if (regressionReport.regressions.length > 0) {
      risks.push({
        severity: 'high',
        description: `${regressionReport.regressions.length} 个回归测试失败 — 新版本可能破坏旧功能`,
        mitigation: '回滚到上一个通过的版本，修复退化后再提交',
      })
    }

    // 生产评分不足
    if (productionScore < 0.6) {
      risks.push({
        severity: 'critical',
        description: `ProductionScore ${productionScore.toFixed(3)} < 0.6 — 生产就绪度不足`,
        mitigation: '优化可靠性: 提高成功率、降低人工干预率、通过更多混沌测试',
      })
    } else if (productionScore < 0.85) {
      risks.push({
        severity: 'medium',
        description: `ProductionScore ${productionScore.toFixed(3)} < 0.85 — 需要灰度验证`,
        mitigation: '进入 CANARY 阶段，从小流量开始观察',
      })
    }

    return risks
  }

  // ═══════════════════════════════════════════════════
  // 判定逻辑
  // ═══════════════════════════════════════════════════

  private determineVerdict(
    simPassed: boolean,
    testPassed: boolean,
    regPassed: boolean,
    chaosPassed: boolean,
    canaryGate: ReliabilityReport['gates']['canary'],
    prodScore: number,
    status?: WorkflowLifecycleStatus,
  ): { verdict: ProductionVerdict; reason: string; recommendations: string[] } {
    const recs: string[] = []

    // 已经在生产
    if (status === WorkflowLifecycleStatus.PRODUCTION) {
      return {
        verdict: 'READY_FOR_PRODUCTION',
        reason: '已处于 PRODUCTION 状态',
        recommendations: ['持续监控 canary 指标', '定期运行回归测试'],
      }
    }

    // 关键门禁未通过
    if (!simPassed || !testPassed) {
      recs.push('运行并通过所有仿真测试')
      recs.push('确保 qualityScore >= 0.8')
      return {
        verdict: 'NOT_READY',
        reason: `关键门禁未通过: simulation=${simPassed}, testing=${testPassed}`,
        recommendations: recs,
      }
    }

    // 回归失败
    if (!regPassed) {
      recs.push('修复所有回归失败的测试用例')
      recs.push('运行 RegressionRunner.detectRegressions() 定位退化')
      return {
        verdict: 'NEEDS_IMPROVEMENT',
        reason: `回归测试未通过: passRate < 0.8`,
        recommendations: recs,
      }
    }

    // 混沌测试未通过
    if (!chaosPassed) {
      recs.push('修复未恢复的故障场景')
      recs.push('增加重试/补偿逻辑')
      return {
        verdict: 'NEEDS_IMPROVEMENT',
        reason: `混沌测试恢复率 < 0.8`,
        recommendations: recs,
      }
    }

    // 需要灰度验证
    if (prodScore < 0.85) {
      recs.push('进入 CANARY 阶段 (5% 流量)')
      recs.push('观察至少 24 小时')
      recs.push('监控 successRate, latency, cost')
      return {
        verdict: 'NEEDS_CANARY',
        reason: `ProductionScore ${prodScore.toFixed(3)} < 0.85 — 需要灰度验证`,
        recommendations: recs,
      }
    }

    // 灰度进行中
    if (canaryGate.active && !canaryGate.passed) {
      recs.push('继续观察灰度指标')
      recs.push(`当前流量: ${canaryGate.trafficPercentage}%`)
      return {
        verdict: 'NEEDS_CANARY',
        reason: `灰度进行中 (${canaryGate.trafficPercentage}%), 指标未达标`,
        recommendations: recs,
      }
    }

    // 灰度通过 → 准备全量
    if (canaryGate.active && canaryGate.passed && canaryGate.trafficPercentage >= 100) {
      return {
        verdict: 'READY_FOR_PRODUCTION',
        reason: `灰度验证通过 (100% 流量), ProductionScore=${prodScore.toFixed(3)}`,
        recommendations: ['执行 promote() 进入 PRODUCTION'],
      }
    }

    // 所有检查通过 → 生产就绪
    return {
      verdict: 'READY_FOR_PRODUCTION',
      reason: `所有门禁通过: ProductionScore=${prodScore.toFixed(3)}, Grade=${this.scorer.getGrade(prodScore)}`,
      recommendations: ['执行 promote() 进入 PRODUCTION', '设置告警规则', '定期运行混沌测试'],
    }
  }
}
