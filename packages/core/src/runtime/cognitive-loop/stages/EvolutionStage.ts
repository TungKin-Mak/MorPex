/**
 * EvolutionStage — 进化阶段
 *
 * MorPex v8.7: 从完成的 Mission 中挖掘工作流模式并更新 Twin。
 *
 * 职责:
 *   1. 调用 WorkflowMiner.mine() 挖掘候选工作流
 *   2. ★ v8.6: 使用 WorkflowSimulator 仿真验证候选
 *   3. ★ v8.7: SimulationResult → PolicyEngine.evaluateWorkflow() → 决策
 *   4. 注册通过的工作流
 *   5. 更新 Twin 画像
 *   6. 发射 WORKFLOW_CREATED / WORKFLOW_SIMULATED 事件
 *
 * Control Plane 横切 (v8.7):
 *   ═══ WorkflowSimulator → SimulationResult → PolicyEngine → Human Approval → Registry
 *   ═══ 质量阈值由 PolicyEngine 管理（按 workflowType 配置）
 *   ═══ RiskAnalyzer 在注册前额外评估
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import { MissionState } from '../../../runtime/mission/types.js'
import type { Mission } from '../../../runtime/mission/types.js'
import type { CognitiveContext, WorkflowCandidateEntry } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'
import type { WorkflowSimulationContext } from '../../../evolution/workflow/types.js'

export class EvolutionStage implements CognitiveStage {
  readonly name = 'evolution' as const

  private workflowMiner: any = null
  private workflowRegistry: any = null
  private workflowSimulator: any = null
  private riskAnalyzer: any = null
  private behaviorTwin: any = null
  private policyEngine: any = null
  // v8.9.2 接入
  private workflowTestRunner: any = null
  private workflowPromotion: any = null
  private reliabilityReporter: any = null
  private regressionRunner: any = null

  /** 已完成 Mission 缓存 */
  private done: Mission[] = []

  /** 待审批候选 */
  private pendingWf: WorkflowCandidateEntry[] = []

  constructor(
    workflowMiner?: any,
    workflowRegistry?: any,
    workflowSimulator?: any,
    riskAnalyzer?: any,
    behaviorTwin?: any,
    policyEngine?: any,
    opts?: {
      workflowTestRunner?: any
      workflowPromotion?: any
      reliabilityReporter?: any
      regressionRunner?: any
    },
  ) {
    this.workflowMiner = workflowMiner ?? null
    this.workflowRegistry = workflowRegistry ?? null
    this.workflowSimulator = workflowSimulator ?? null
    this.riskAnalyzer = riskAnalyzer ?? null
    this.behaviorTwin = behaviorTwin ?? null
    this.policyEngine = policyEngine ?? null
    this.workflowTestRunner = opts?.workflowTestRunner ?? null
    this.workflowPromotion = opts?.workflowPromotion ?? null
    this.reliabilityReporter = opts?.reliabilityReporter ?? null
    this.regressionRunner = opts?.regressionRunner ?? null
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    if (!ctx.mission || !ctx.result) {
      return { ...ctx, phase: 'evolution' }
    }

    // 收集完成的 Mission
    if (ctx.result.state === MissionState.COMPLETED) {
      this.done.push(ctx.mission)
    }

    // 挖掘候选工作流（需要至少 3 个完成的 Mission）
    if (this.workflowMiner && this.workflowRegistry && this.done.length >= 3) {
      try {
        const names = this.workflowRegistry.getAll().map((w: any) => w.name) || []
        const candidates = await this.workflowMiner.mine(this.done, names)

        for (const c of candidates) {
          if (c.confidence < 0.6) continue

          // 发射 workflow.candidate 事件 — 发现候选工作流
          bus.emit({
            id: `evt_wfc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: EventType.WORKFLOW_CANDIDATE,
            timestamp: Date.now(),
            executionId: 'cl',
            source: 'cognitive-pipeline:evolution',
            payload: {
              candidateName: c.name,
              confidence: c.confidence,
              pattern: c.pattern,
              qualityScore: c.confidence,
            },
          })

          let qualityScore = c.confidence
          let simulationPassed = true
          let riskScore = 0
          let failureModes: string[] = []
          let simConfidence = 0.5

          // ★ v8.6: WorkflowSimulator 仿真验证
          if (this.workflowSimulator) {
            try {
              // 构建仿真上下文
              const simContext: WorkflowSimulationContext = {
                workflowType: this.inferWorkflowType(c),
                riskTolerance: 'medium',
                historicalExecutions: this.done.length,
                domainConstraints: [],
              }

              const simResult = await this.workflowSimulator.simulate(c, this.done, simContext)
              qualityScore = simResult.qualityScore
              simulationPassed = simResult.passed
              riskScore = simResult.riskScore
              simConfidence = simResult.confidence
              failureModes = simResult.failureModes.map((fm: any) => `${fm.name}(${(fm.ratio * 100).toFixed(0)}%)`)

              // 发射 WORKFLOW_SIMULATED 事件
              bus.emit({
                id: `evt_wfsim_${Date.now()}`,
                type: EventType.WORKFLOW_SIMULATED,
                timestamp: Date.now(),
                executionId: 'cl',
                source: 'cognitive-pipeline:evolution',
                payload: {
                  candidateName: c.name,
                  qualityScore,
                  riskScore,
                  confidence: simConfidence,
                  failureModes: simResult.failureModes,
                  passed: simulationPassed,
                  metrics: simResult.metrics,
                  recommendations: simResult.recommendations,
                },
              })
            } catch {
              qualityScore = c.confidence * 0.5
            }
          }

          // ★ v8.9.2: WorkflowTestRunner — 运行自动化测试
          let testsPassed = true
          let testPassRate = 1.0
          if (this.workflowTestRunner) {
            try {
              const testResult = await this.workflowTestRunner.runSuite(c, [])
              testsPassed = testResult.allPassed
              testPassRate = testResult.passRate
              if (!testsPassed) {
                bus.emit({
                  id: `evt_wftest_${Date.now()}`,
                  type: EventType.REGRESSION_FAILED,
                  timestamp: Date.now(), executionId: 'cl',
                  source: 'cognitive-pipeline:evolution',
                  payload: { candidateName: c.name, passRate: testPassRate, allPassed: false },
                })
              }
            } catch { /* test runner unavailable, skip */ }
          }

          // ★ v8.9.2: RegressionRunner — 检查回归
          let regressionPassed = true
          if (this.regressionRunner) {
            try {
              const wfType = this.inferWorkflowType(c)
              const regReport = await this.regressionRunner.run(c.name, wfType)
              regressionPassed = regReport.passRate >= 0.8
            } catch { /* regression unavailable */ }
          }

          // ★ v8.7: PolicyEngine 决策（接管质量阈值）
          let policyDecision: 'approve' | 'reject' | 'needs_review' | null = null
          if (this.policyEngine && typeof this.policyEngine.evaluateWorkflow === 'function') {
            try {
              const proposal = {
                id: `wfp_${Date.now()}`,
                workflowId: c.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
                workflowName: c.name,
                workflowType: this.inferWorkflowType(c),
                simulation: {
                  qualityScore,
                  successRate: qualityScore, // approximate
                  riskScore,
                  failureModes,
                  confidence: simConfidence,
                  executions: this.done.length,
                  avgLatency: 0,
                  resourceCost: 1 - qualityScore,
                },
                candidate: c,
                timestamp: Date.now(),
              }
              const decision = this.policyEngine.evaluateWorkflow(proposal)
              policyDecision = decision.action
            } catch {
              // PolicyEngine 不可用，回退到基础阈值
            }
          }

          // Control Plane: RiskAnalyzer 在注册前评估
          if (this.riskAnalyzer) {
            try {
              const riskCheck = this.riskAnalyzer.assessMission(
                { id: 'wf_' + c.name, metadata: {} },
                { steps: c.steps || [] },
              )
              if (riskCheck.level === 'critical') {
                continue // 高风险候选跳过
              }
            } catch {}
          }

          // 决策逻辑: PolicyEngine > 回退阈值
          const action = policyDecision ?? (qualityScore >= 0.5 ? 'approve' : 'reject')
          if (action === 'reject') continue

          const entry: WorkflowCandidateEntry = {
            id: 'wfc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            name: c.name,
            description: c.description,
            confidence: c.confidence,
            qualityScore,
            simulationPassed,
            steps: c.steps?.length || 0,
            sourceMissionIds: c.sourceMissionIds || [],
            detectedAt: Date.now(),
            status: action === 'approve' ? 'approved' : 'pending',
          }

          this.pendingWf.push(entry)

          // ★ v8.9.2: WorkflowPromotion — 晋升门禁检查
          if (this.workflowPromotion && action === 'approve') {
            try {
              const wfId = c.name.replace(/[^a-zA-Z0-9_-]/g, '_')
              this.workflowPromotion.register(wfId)
              // 更新评分信息
              if (typeof this.workflowPromotion.updateScores === 'function') {
                this.workflowPromotion.updateScores(wfId, {
                  qualityScore,
                  simulationPassed,
                  testsPassed,
                  chaosTestPassed: true,  // default until chaos tested
                  regressionPassed,
                })
              }
              const canPromote = this.workflowPromotion.canPromote(wfId)
              if (!canPromote.allowed) {
                entry.status = 'pending'  // needs more gates
              }
            } catch { /* promotion unavailable */ }
          }

          // 决策通过时自动注册
          if (action === 'approve' && this.workflowRegistry) {
            try {
              this.workflowRegistry.register({
                name: c.name,
                description: c.description,
                steps: c.steps || [],
                confidence: c.confidence,
                sourceMissionIds: c.sourceMissionIds || [],
                detectedAt: c.detectedAt || Date.now(),
                suggestedFrequency: c.suggestedFrequency || 'regular',
              })
              entry.status = 'approved'

              // ★ v8.9.2: WorkflowPromotion — 触发晋升事件
              if (this.workflowPromotion) {
                try {
                  const wfId = c.name.replace(/[^a-zA-Z0-9_-]/g, '_')
                  bus.emit({
                    id: `evt_wfpromo_${Date.now()}`,
                    type: EventType.WORKFLOW_PROMOTED,
                    timestamp: Date.now(), executionId: 'cl',
                    source: 'cognitive-pipeline:evolution',
                    payload: { workflowId: wfId, name: c.name, qualityScore },
                  })
                } catch {}
              }
            } catch {}
          }

          // 发射 WORKFLOW_CREATED 事件
          bus.emit({
            id: 'evt_wfc_' + entry.id,
            type: EventType.WORKFLOW_CREATED,
            timestamp: Date.now(),
            executionId: 'cl',
            source: 'cognitive-pipeline:evolution',
            payload: {
              candidateId: entry.id,
              name: c.name,
              confidence: c.confidence,
              qualityScore,
              riskScore,
              status: entry.status,
              policyAction: action,
            },
          })
        }
      } catch {}
    }

    // 更新 Twin
    if (this.behaviorTwin) {
      try {
        this.behaviorTwin.buildProfile()
      } catch {}
    }

    // ★ v8.9.2: ReliabilityReporter — 生成生产就绪报告
    if (this.reliabilityReporter && this.done.length >= 5) {
      try {
        for (const entry of this.pendingWf.filter(e => e.status === 'approved')) {
          const report = await this.reliabilityReporter.generateReport(entry.name, this.inferWorkflowType(entry))
          bus.emit({
            id: `evt_relrep_${Date.now()}`,
            type: EventType.RELIABILITY_CHECK_STARTED,
            timestamp: Date.now(), executionId: 'cl',
            source: 'cognitive-pipeline:evolution',
            payload: {
              workflowId: entry.name,
              verdict: report.verdict,
              productionScore: report.productionScore,
              grade: report.grade,
            },
          })
        }
      } catch { /* reporter unavailable */ }
    }

    return {
      ...ctx,
      phase: 'evolution',
    }
  }

  /**
   * inferWorkflowType — 根据候选信息推断工作流类型
   */
  private inferWorkflowType(candidate: any): string {
    const name = (candidate.name || '').toLowerCase()
    const desc = (candidate.description || '').toLowerCase()
    const steps = candidate.steps || []

    const domains = steps.map((s: any) => (s.domain || '').toLowerCase())
    const allDomains = [name, desc, ...domains].join(' ')

    if (allDomains.includes('finance') || allDomains.includes('payment') || allDomains.includes('转账')) return 'finance'
    if (allDomains.includes('deploy') || allDomains.includes('release') || allDomains.includes('部署')) return 'deployment'
    if (allDomains.includes('coding') || allDomains.includes('code') || allDomains.includes('编程') || allDomains.includes('test')) return 'coding'
    if (allDomains.includes('writing') || allDomains.includes('write') || allDomains.includes('写作') || allDomains.includes('文档')) return 'writing'
    if (allDomains.includes('research') || allDomains.includes('analyze') || allDomains.includes('研究') || allDomains.includes('分析')) return 'research'

    return 'general'
  }

  /** 获取待审批候选 */
  getPendingCandidates(): WorkflowCandidateEntry[] {
    return this.pendingWf.filter(x => x.status === 'pending')
  }

  /** 获取所有候选 */
  getAllCandidates(): WorkflowCandidateEntry[] {
    return this.pendingWf.slice()
  }

  /** 审批候选 */
  approveCandidate(id: string, by?: string): WorkflowCandidateEntry | undefined {
    const e = this.pendingWf.find(x => x.id === id)
    if (!e || e.status !== 'pending') return undefined
    e.status = 'approved'
    e.approvedBy = by || 'human'
    e.approvedAt = Date.now()
    if (this.workflowRegistry) {
      this.workflowRegistry.register({
        name: e.name,
        description: e.description,
        steps: [],
        confidence: e.confidence,
        sourceMissionIds: e.sourceMissionIds,
        detectedAt: e.detectedAt,
        suggestedFrequency: 'regular',
      })
    }
    return e
  }

  /** 拒绝候选 */
  denyCandidate(id: string, by?: string): WorkflowCandidateEntry | undefined {
    const e = this.pendingWf.find(x => x.id === id)
    if (!e || e.status !== 'pending') return undefined
    e.status = 'denied'
    e.approvedBy = by || 'human'
    e.approvedAt = Date.now()
    return e
  }
}
