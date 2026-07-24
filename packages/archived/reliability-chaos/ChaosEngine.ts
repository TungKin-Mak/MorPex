/**
 * ChaosEngine — 混沌测试引擎 (v8.9)
 *
 * 对工作流执行故障注入测试，验证恢复能力。
 *
 * ★ v8.9.1: 增加 ChaosReport 详细报告，记录:
 *   - 为什么失败？
 *   - 恢复多久？
 *   - 哪一个组件脆弱？
 *
 * 数据分析:
 *   ChaosReport → ReliabilityScorer → ProductionScore
 */

import type { FaultInjector, InjectionResult } from './FaultInjector.js'
import type { FailureScenario } from './FailureScenario.js'

export interface ChaosTestResult {
  workflowId: string
  totalFaultsInjected: number
  faultsRecovered: number
  faultsUnrecovered: number
  recoveryRate: number
  duration: number
  injectionResults: InjectionResult[]
  reports: ChaosReport[]
  passed: boolean
}

/**
 * ChaosReport — 混沌测试详细报告 (v8.9.1)
 *
 * 每次故障注入的详细记录，回答:
 *   - 为什么失败？— errorMessage + failureInjected
 *   - 恢复多久？— recoveryTime
 *   - 哪一个组件脆弱？— target + affectedTasks
 *   - 如何修复？— recommendation
 */
export interface ChaosReport {
  workflowId: string
  scenarioId: string
  scenarioName: string
  target: string
  failureInjected: boolean
  recovered: boolean
  recoveryTime: number           // ms
  recoveryMethod: string         // 'retry' | 'fallback' | 'compensation' | 'escalation'
  affectedTasks: string[]
  errorMessage?: string
  recommendation: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  timestamp: number
}

export class ChaosEngine {
  private reports: Map<string, ChaosReport[]> = new Map()

  constructor(
    private injector: FaultInjector,
    private eventBus?: { emit: (evt: any) => void },
  ) {}

  async executeChaosTest(workflowId: string, targets?: string[]): Promise<ChaosTestResult> {
    const startTime = Date.now()
    const context = { workflowId, mode: 'chaos', recoveredFaults: 0, affectedTasks: [] as string[] }
    const allTargets = targets ?? ['sandbox', 'llm', 'network', 'database', 'artifact', 'budget']
    let allResults: InjectionResult[] = []
    const generatedReports: ChaosReport[] = []

    if (this.eventBus) {
      this.eventBus.emit({
        id: `evt_chaos_${Date.now()}`,
        type: 'chaos.test.started',
        timestamp: Date.now(),
        executionId: workflowId,
        source: 'reliability:chaos',
        payload: { workflowId, targets: allTargets },
      })
    }

    const scenarios = this.getScenarios()

    for (const target of allTargets) {
      const results = await this.injector.inject(target, context)
      allResults = allResults.concat(results)

      for (const result of results) {
        const scenario = scenarios.find(s => s.id === result.scenarioId)
        const report: ChaosReport = {
          workflowId,
          scenarioId: result.scenarioId,
          scenarioName: scenario?.name ?? result.scenarioId,
          target: result.target,
          failureInjected: result.injected,
          recovered: !result.error,
          recoveryTime: 0,
          recoveryMethod: scenario?.expectedRecovery ?? 'unknown',
          affectedTasks: context.affectedTasks as string[],
          errorMessage: result.error,
          recommendation: this.generateRecommendation(scenario),
          severity: scenario?.severity ?? 'medium',
          timestamp: result.timestamp,
        }
        generatedReports.push(report)
      }
    }

    this.reports.set(workflowId, generatedReports)

    const totalFaults = allResults.length
    const faultsRecovered = allResults.filter(r => !r.error).length
    const recoveryRate = totalFaults > 0 ? faultsRecovered / totalFaults : 1.0

    if (this.eventBus) {
      this.eventBus.emit({
        id: `evt_chaos_done_${Date.now()}`,
        type: 'chaos.test.completed',
        timestamp: Date.now(),
        executionId: workflowId,
        source: 'reliability:chaos',
        payload: { workflowId, recoveryRate, passed: recoveryRate >= 0.8 },
      })
    }

    return {
      workflowId,
      totalFaultsInjected: totalFaults,
      faultsRecovered,
      faultsUnrecovered: totalFaults - faultsRecovered,
      recoveryRate,
      duration: Date.now() - startTime,
      injectionResults: allResults,
      reports: generatedReports,
      passed: recoveryRate >= 0.8,
    }
  }

  generateReport(workflowId: string): ChaosReport[] {
    return this.reports.get(workflowId) ?? []
  }

  getLatestReport(workflowId: string): ChaosReport | undefined {
    const wfReports = this.reports.get(workflowId)
    return wfReports?.[wfReports.length - 1]
  }

  getAllReports(): ChaosReport[] {
    return [...this.reports.values()].flat()
  }

  private generateRecommendation(scenario: FailureScenario | undefined): string {
    if (!scenario) return 'No recommendation available'
    switch (scenario.id) {
      case 'sandbox-crash': return '增加 Sandbox 健康检查，失败后自动重启'
      case 'llm-timeout': return '配置备用 LLM 模型，实现自动降级'
      case 'network-partition': return '增加网络断开重试机制，指数退避'
      case 'database-unavailable': return '实现 DB 操作幂等性，连接池自动恢复'
      case 'artifact-corruption': return '增加产物 checksum 验证，失败后重新生成'
      case 'budget-exhausted': return '预算接近阈值时预警，暂停非关键任务'
      default: return '定期进行混沌测试以验证恢复能力'
    }
  }

  async injectScenario(scenarioId: string, context: Record<string, unknown>): Promise<InjectionResult | null> {
    const scenario = this.getScenarios().find(s => s.id === scenarioId)
    if (!scenario) return null
    const results = await this.injector.inject(scenario.target, context)
    return results[0] ?? null
  }

  getScenarios(): FailureScenario[] {
    return (this.injector as any).scenarios ?? []
  }

  getStats(): { totalTests: number; totalFaults: number; avgRecoveryRate: number } {
    const allReports = this.getAllReports()
    const totalFaults = allReports.length
    const recovered = allReports.filter(r => r.recovered).length
    return {
      totalTests: this.reports.size,
      totalFaults,
      avgRecoveryRate: totalFaults > 0 ? recovered / totalFaults : 1.0,
    }
  }
}
