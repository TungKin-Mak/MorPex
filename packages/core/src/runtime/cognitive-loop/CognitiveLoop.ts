/**
 * CognitiveLoop — 认知循环（v8.6 兼容门面）
 *
 * MorPex v8.6: CognitiveLoop 现在是 CognitivePipeline 的兼容门面。
 * 内部使用 CognitivePipeline + 8 个独立 Stage，对外保持相同接口。
 *
 * 向后兼容:
 *   - process(msg) — 行为不变
 *   - asMessageHandler() — 行为不变
 *   - approveCandidate / denyCandidate / getPendingCandidates — 行为不变
 *   - checkDrift / acceptDrift / rejectDrift — 行为不变
 *   - execWfManual / getHCConfig / getStats — 行为不变
 *
 * 迁移路径:
 *   新代码应直接使用 CognitivePipeline + Stage，
 *   CognitiveLoop 仅作为兼容层保留。
 */

import { EventBus } from '../../common/EventBus.js'
import { EventType } from '../../protocol/events/EventType.js'
import { MissionRuntime } from '../mission/MissionRuntime.js'
import { CognitivePipeline } from './CognitivePipeline.js'
import {
  ContextStage,
  IntentStage,
  GoalStage,
  TwinStage,
  PlanningStage,
  ExecutionStage,
  LearningStage,
  EvolutionStage,
  PersistenceStage,
} from './stages/index.js'
import { ContextAssemblyEngine } from '../../context/ContextAssemblyEngine.js'
import type { IncomingMessage } from '../../interaction/types.js'
import { MissionState } from '../mission/types.js'
import type { Mission } from '../mission/types.js'
import type {
  CognitiveContext,
  LoopStats,
  WorkflowCandidateEntry,
  BehaviorDriftEntry,
} from './types.js'

export class CognitiveLoop {
  private bus: EventBus
  private mr: MissionRuntime
  private pipeline: CognitivePipeline
  private evolutionStage: EvolutionStage

  public behaviorTwin: any = null
  public decisionTwin: any = null
  public preferenceModel: any = null
  public workflowMiner: any = null
  public workflowRegistry: any = null
  public workflowExecutor: any = null
  public brain: any = null
  public workflowSimulator: any = null

  private done: Mission[] = []
  private autoReg = false
  private autoExec = false
  private pendingDrift: BehaviorDriftEntry[] = []
  private lastProfile: any = null
  private goalMgr: any = null
  private riskAnalyzer: any = null
  private permissionModel: any = null
  private brainPersistor: any = null
  private contextEngine: ContextAssemblyEngine | null = null

  private stats: LoopStats = {
    totalLoops: 0,
    successfulLoops: 0,
    failedLoops: 0,
    averageDurationMs: 0,
    learningEvents: 0,
    twinUpdates: 0,
  }

  constructor(bus: EventBus, missionRuntime: MissionRuntime, opts?: any) {
    this.bus = bus
    this.mr = missionRuntime

    if (opts) {
      this.behaviorTwin = opts.behaviorTwin ?? null
      this.decisionTwin = opts.decisionTwin ?? null
      this.preferenceModel = opts.preferenceModel ?? null
      this.workflowMiner = opts.workflowMiner ?? null
      this.workflowRegistry = opts.workflowRegistry ?? null
      this.workflowExecutor = opts.workflowExecutor ?? null
      this.brain = opts.brain ?? null
      this.goalMgr = opts.goalManager ?? null
      this.autoReg = opts.autoRegisterWorkflows ?? false
      this.autoExec = opts.autoExecuteWorkflows ?? false
      this.riskAnalyzer = opts.riskAnalyzer ?? null
      this.permissionModel = opts.permissionModel ?? null
      this.workflowSimulator = opts.workflowSimulator ?? null
      this.brainPersistor = opts.brainPersistor ?? null
      this.contextEngine = opts.contextEngine ?? null
    }

    // 构建内部 Pipeline
    this.evolutionStage = new EvolutionStage(
      this.workflowMiner,
      this.workflowRegistry,
      this.workflowSimulator,
      this.riskAnalyzer,
      this.behaviorTwin,
    )

    // Build stages — ContextStage first if engine available
    const stages: any[] = []
    if (this.contextEngine) {
      stages.push(new ContextStage(this.contextEngine))
    }
    stages.push(
      new IntentStage(),
      new GoalStage(this.goalMgr),
      new TwinStage(this.behaviorTwin, this.decisionTwin, this.preferenceModel),
      new PlanningStage(this.mr, this.riskAnalyzer),
      new ExecutionStage(this.mr, this.permissionModel),
      new LearningStage(this.brain, this.behaviorTwin, this.decisionTwin),
      this.evolutionStage,
      new PersistenceStage(this.brainPersistor),
    )

    this.pipeline = new CognitivePipeline(stages, this.bus)
  }

  async process(msg: IncomingMessage): Promise<CognitiveContext> {
    const startTime = Date.now()
    try {
      const ctx = await this.pipeline.process(msg)

      // ★ v8.6: 收集完成的 Mission（给 checkDrift 使用）
      if (ctx.result && ctx.result.state === MissionState.COMPLETED) {
        this.done.push(ctx.mission!)
      }

      this.stats.totalLoops++
      if (ctx.phase === 'completed') {
        this.stats.successfulLoops++
      } else {
        this.stats.failedLoops++
      }
      this.stats.averageDurationMs = this.calcAvg(Date.now() - startTime)

      // 统计学习事件
      if (ctx.phase !== 'failed') {
        this.stats.learningEvents++
      }

      return ctx
    } catch (err: any) {
      this.stats.totalLoops++
      this.stats.failedLoops++
      return {
        message: msg,
        intent: { goal: '', keywords: [], confidence: 0, isNewGoal: false },
        matchedGoals: [],
        behaviorProfile: null,
        decisionProfile: null,
        preferenceProfile: null,
        mission: null,
        result: null,
        startedAt: startTime,
        completedAt: Date.now(),
        phase: 'failed',
        errors: [err?.message || String(err)],
      }
    }
  }

  asMessageHandler() {
    return async (msg: IncomingMessage) => {
      const ctx = await this.process(msg)
      return {
        content: ctx.result?.output ? String(ctx.result.output) : 'Phase: ' + ctx.phase,
        channel: msg.channel,
        userId: msg.userId,
        sessionId: msg.sessionId,
        type: 'text' as const,
        metadata: { missionId: ctx.mission?.id, phase: ctx.phase, errors: ctx.errors.length },
      }
    }
  }

  // ── Human Control API (委托给 EvolutionStage) ──

  getPendingCandidates(): WorkflowCandidateEntry[] {
    return this.evolutionStage.getPendingCandidates()
  }

  getAllCandidates(): WorkflowCandidateEntry[] {
    return this.evolutionStage.getAllCandidates()
  }

  approveCandidate(id: string, by?: string): WorkflowCandidateEntry | undefined {
    return this.evolutionStage.approveCandidate(id, by)
  }

  denyCandidate(id: string, by?: string): WorkflowCandidateEntry | undefined {
    return this.evolutionStage.denyCandidate(id, by)
  }

  // ── Behavior Drift (保留在 CognitiveLoop 层) ──

  getPendingDrifts(): BehaviorDriftEntry[] {
    return this.pendingDrift.filter(function(x) { return x.status === 'pending' })
  }

  acceptDrift(id: string, by?: string): BehaviorDriftEntry | undefined {
    const e = this.pendingDrift.find(function(x) { return x.id === id })
    if (!e || e.status !== 'pending') return undefined
    e.status = 'accepted'
    e.confirmedBy = by || 'human'
    e.confirmedAt = Date.now()
    this.lastProfile = e.currentProfile
    return e
  }

  rejectDrift(id: string, by?: string): BehaviorDriftEntry | undefined {
    const e = this.pendingDrift.find(function(x) { return x.id === id })
    if (!e || e.status !== 'pending') return undefined
    e.status = 'rejected'
    e.confirmedBy = by || 'human'
    e.confirmedAt = Date.now()
    return e
  }

  checkDrift(): BehaviorDriftEntry | null {
    if (!this.behaviorTwin) return null
    const cur = this.behaviorTwin.buildProfile()
    if (!this.lastProfile) { this.lastProfile = cur; return null }
    const ch: string[] = []
    if (this.lastProfile.planningStyle !== cur.planningStyle) ch.push('planningStyle: ' + this.lastProfile.planningStyle + '->' + cur.planningStyle)
    if (this.lastProfile.riskTolerance !== cur.riskTolerance) ch.push('riskTolerance: ' + this.lastProfile.riskTolerance + '->' + cur.riskTolerance)
    if (this.lastProfile.taskDecomposition !== cur.taskDecomposition) ch.push('taskDecomposition: ' + this.lastProfile.taskDecomposition + '->' + cur.taskDecomposition)
    if (ch.length === 0) return null
    const e: BehaviorDriftEntry = {
      id: 'bd_' + Date.now(),
      detectedAt: Date.now(),
      changes: ch,
      previousProfile: this.lastProfile,
      currentProfile: cur,
      status: 'pending',
    }
    this.pendingDrift.push(e)
    this.bus.emit({
      id: 'evt_drift_' + e.id,
      type: EventType.BEHAVIOR_DRIFT,
      timestamp: Date.now(),
      executionId: 'bt',
      source: 'cl',
      payload: { driftId: e.id, changes: ch, pending: true },
    })
    return e
  }

  // ── Workflow Execution ──

  async execWfManual(wfId: string): Promise<{ success: boolean; missionId?: string; error?: string }> {
    if (!this.workflowExecutor) return { success: false, error: 'not ready' }
    try {
      const r = await this.workflowExecutor.execute(wfId)
      return { success: r.success, missionId: r.missionId, error: r.error }
    } catch (err: any) {
      return { success: false, error: err ? err.message : String(err) }
    }
  }

  getHCConfig() {
    return {
      autoReg: this.autoReg,
      autoExec: this.autoExec,
      pendingWf: this.getPendingCandidates().length,
      pendingDrift: this.getPendingDrifts().length,
    }
  }

  getStats(): LoopStats {
    return { ...this.stats }
  }

  private calcAvg(d: number): number {
    return this.stats.averageDurationMs === 0 ? d : Math.round(this.stats.averageDurationMs * 0.7 + d * 0.3)
  }
}
