/**
 * LearningStage — 学习阶段（v8.7: Evidence Aggregation）
 *
 * MorPex v8.7: 从 Mission 执行结果中收集证据，聚合后产生 TwinCandidate。
 *
 * 旧流程 (v8.6): Execution → Learning → Twin Update (immediate)
 * 新流程 (v8.7): Execution → Outcome Event → Learning → EvidenceAggregator
 *                  → TwinCandidate → Approval → Twin Update
 *
 * 设计原则:
 *   1. 一次错误行为不会污染人格模型
 *   2. 只有当足够证据形成共识时才建议变更
 *   3. TwinCandidate 需审批后才生效（防止噪音污染）
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import type { CognitiveContext, TwinCandidate, EvidenceAggregation } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

// ═══════════════════════════════════════════════════════════════
// EvidenceAggregator
// ═══════════════════════════════════════════════════════════════

interface RawObservation {
  field: string
  value: string
  sourceEvent: string
  timestamp: number
}

/**
 * EvidenceAggregator — 证据聚合器
 *
 * 收集原始观察，按字段聚合，当足够证据形成共识时生成 TwinCandidate。
 *
 * 共识条件:
 *   - consensusRatio > 0.7 (70% 以上观察同意)
 *   - totalObservations >= 10 (足够数据点)
 *   - 建议的值与当前值不同
 */
class EvidenceAggregator {
  private observations: RawObservation[] = []

  /**
   * record — 记录一条原始观察
   */
  record(field: string, value: string, sourceEvent: string): void {
    this.observations.push({ field, value, sourceEvent, timestamp: Date.now() })
  }

  /**
   * aggregate — 聚合所有观察，返回有足够证据的 TwinCandidate 列表
   *
   * @param currentProfile - 当前画像（用于对比哪些字段真的变了）
   * @returns TwinCandidate[] 建议的变更
   */
  aggregate(currentProfile: Record<string, unknown>): TwinCandidate[] {
    const candidates: TwinCandidate[] = []
    const grouped = this.groupByField()

    for (const [field, obs] of grouped) {
      if (obs.length < 10) continue // 数据不足

      // 统计每个值的投票数
      const voteMap = new Map<string, number>()
      for (const o of obs) {
        voteMap.set(o.value, (voteMap.get(o.value) || 0) + 1)
      }

      // 找到最高票值
      let maxVotes = 0
      let suggestedValue = ''
      for (const [val, count] of voteMap) {
        if (count > maxVotes) {
          maxVotes = count
          suggestedValue = val
        }
      }

      const currentValue = String(currentProfile[field] ?? '')
      const consensusRatio = maxVotes / obs.length

      // 共识条件: >70% 同意, 且与当前值不同
      if (consensusRatio > 0.7 && suggestedValue !== currentValue) {
        candidates.push({
          id: `tc_${field}_${Date.now()}`,
          field,
          oldValue: currentValue,
          newValue: suggestedValue,
          evidence: obs.slice(0, 20).map(o => o.sourceEvent), // 最多 20 条证据
          evidenceCount: maxVotes,
          confidence: Math.min(0.95, consensusRatio),
          status: 'pending',
          createdAt: Date.now(),
        })
      }
    }

    return candidates
  }

  /**
   * getSnapshot — 获取当前所有观察的快照（用于调试/审计）
   */
  getSnapshot(): { field: string; observations: number; uniqueValues: number }[] {
    const grouped = this.groupByField()
    const result: { field: string; observations: number; uniqueValues: number }[] = []
    for (const [field, obs] of grouped) {
      const unique = new Set(obs.map(o => o.value))
      result.push({ field, observations: obs.length, uniqueValues: unique.size })
    }
    return result
  }

  /**
   * clear — 清空观察（在 TwinCandidate 被审批后调用）
   */
  clear(): void {
    this.observations = []
  }

  private groupByField(): Map<string, RawObservation[]> {
    const grouped = new Map<string, RawObservation[]>()
    for (const o of this.observations) {
      const list = grouped.get(o.field) || []
      list.push(o)
      grouped.set(o.field, list)
    }
    return grouped
  }
}

// ═══════════════════════════════════════════════════════════════
// LearningStage
// ═══════════════════════════════════════════════════════════════

export class LearningStage implements CognitiveStage {
  readonly name = 'learning' as const

  private brain: any = null
  private behaviorTwin: any = null
  private decisionTwin: any = null
  private eventStore: any = null       // v8.9.2: DecisionEvent recording
  private evidenceAggregator: EvidenceAggregator
  private pendingCandidates: TwinCandidate[] = []

  constructor(brain?: any, behaviorTwin?: any, decisionTwin?: any, eventStore?: any) {
    this.brain = brain ?? null
    this.behaviorTwin = behaviorTwin ?? null
    this.decisionTwin = decisionTwin ?? null
    this.eventStore = eventStore ?? null
    this.evidenceAggregator = new EvidenceAggregator()
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    const missionId = ctx.mission?.id || ctx.message?.sessionId || 'unknown'
    console.log(`🔄 [LearningStage] 开始执行 — Mission: ${missionId}`)

    if (!ctx.mission || !ctx.result) {
      console.log(`   ⏭️  跳过: 无 Mission 或 Result`)
      return { ...ctx, phase: 'learning' }
    }

    // ── Step 1: 收集原始观察 ──
    const outcome = ctx.result.state === 'COMPLETED' ? 'success' : 'failure'
    console.log(`   📋 Mission 结果: ${outcome} | 步骤: ${ctx.result.stepsCompleted || 0}/${ctx.result.stepsTotal || 0}`)

    // 从执行结果生成源事件 ID
    const sourceEvent = `mission_${ctx.mission.id}_${outcome}`

    // 记录到 BehaviorTwin（原始数据收集）
    if (this.behaviorTwin) {
      try {
        this.behaviorTwin.recordMission(ctx.mission, ctx.result)

        // 记录证据到聚合器 — 推断风险偏好变化
        const riskLevel = (ctx.mission as any).plan?.riskLevel || 'medium'
        this.evidenceAggregator.record('riskTolerance', riskLevel, sourceEvent)

        // 记录步骤复杂度变化
        const stepsCompleted = ctx.result.stepsCompleted || 0
        const decomposition = stepsCompleted <= 3 ? 'coarse' : stepsCompleted <= 6 ? 'moderate' : 'fine-grained'
        this.evidenceAggregator.record('taskDecomposition', decomposition, sourceEvent)
      } catch {}
    }

    // 记录到 DecisionTwin
    if (this.decisionTwin && ctx.intent) {
      try {
        this.decisionTwin.recordOutcome(ctx.intent.goal, 'executed', 'ok', true)
      } catch {}
    }

    // 记录到 PersonalBrain
    if (this.brain) {
      try {
        await this.brain.recordEpisode(
          'M ' + ctx.mission.id,
          { s: ctx.result.state },
          ['mission'],
        )
      } catch {}
    }

    // ── Step 1.5: Record DecisionEvent (v8.9.2) ──
    if (this.eventStore && typeof this.eventStore.appendDecision === 'function') {
      try {
        this.eventStore.appendDecision({
          executionId: ctx.mission.id,
          source: 'cognitive-pipeline:learning',
          input: { missionGoal: ctx.mission.goal, resultState: ctx.result.state },
          reasoning: `Mission ${ctx.result.state}: steps=${ctx.result.stepsCompleted}/${ctx.result.stepsTotal}`,
          evidence: [`mission_${ctx.mission.id}`],
          decision: ctx.result.state === 'COMPLETED' ? 'record_success' : 'record_failure',
          confidence: ctx.result.state === 'COMPLETED' ? 0.9 : 0.5,
          twinVersion: this.behaviorTwin?.getCurrentVersion?.() ?? 0,
        })
      } catch {}
    }

    // ── Step 2: Evidence Aggregation — 聚合证据，生成 TwinCandidate ──
    let candidateCount = 0
    if (this.behaviorTwin) {
      try {
        const currentProfile = this.behaviorTwin.buildProfile() as unknown as Record<string, unknown>
        const newCandidates = this.evidenceAggregator.aggregate(currentProfile)
        candidateCount = newCandidates.length

        if (candidateCount > 0) {
          console.log(`   🧬 EvidenceAggregator 生成 ${candidateCount} 个 TwinCandidate:`)
        } else {
          console.log(`   📊 EvidenceAggregator: 证据不足，无候选 (snapshot: ${JSON.stringify(this.evidenceAggregator.getSnapshot())})`)
        }

        for (const candidate of newCandidates) {
          console.log(`      → ${candidate.field}: "${candidate.oldValue}" → "${candidate.newValue}" (置信度: ${(candidate.confidence * 100).toFixed(0)}%, 证据: ${candidate.evidenceCount}条)`)
          // 不重复添加同一字段的候选
          const existing = this.pendingCandidates.find(
            c => c.field === candidate.field && c.status === 'pending',
          )
          if (!existing) {
            this.pendingCandidates.push(candidate)

            // 发射 TWIN_CANDIDATE_CREATED 事件
            bus.emit({
              id: `evt_tc_${candidate.id}`,
              type: EventType.WORKFLOW_CREATED as any, // 复用现有事件类型
              timestamp: Date.now(),
              executionId: ctx.mission!.id,
              source: 'cognitive-pipeline:learning',
              payload: {
                candidateId: candidate.id,
                field: candidate.field,
                oldValue: candidate.oldValue,
                newValue: candidate.newValue,
                confidence: candidate.confidence,
                evidenceCount: candidate.evidenceCount,
                status: 'pending',
              },
            })
          }
        }
      } catch {}
    }

    // 发射 MEMORY_UPDATED 事件
    bus.emit({
      id: `evt_learn_${Date.now()}`,
      type: EventType.MEMORY_UPDATED,
      timestamp: Date.now(),
      executionId: ctx.mission.id,
      source: 'cognitive-pipeline:learning',
      payload: {
        missionId: ctx.mission.id,
        state: ctx.result.state,
        stepsCompleted: ctx.result.stepsCompleted,
        stepsTotal: ctx.result.stepsTotal,
      },
    })

    console.log(`✅ [LearningStage] 完成 — candidates: ${this.pendingCandidates.filter(c => c.status === 'pending').length} pending, ${this.evidenceAggregator.getSnapshot().length} fields observed`)

    return {
      ...ctx,
      phase: 'learning',
    }
  }

  // ── Human Control API ──

  /**
   * getPendingTwinCandidates — 获取待审批的 TwinCandidate 列表
   */
  getPendingTwinCandidates(): TwinCandidate[] {
    return this.pendingCandidates.filter(c => c.status === 'pending')
  }

  /**
   * getAllTwinCandidates — 获取所有 TwinCandidate
   */
  getAllTwinCandidates(): TwinCandidate[] {
    return this.pendingCandidates.slice()
  }

  /**
   * approveTwinCandidate — 审批通过 TwinCandidate
   *
   * 将候选变更应用到 BehaviorTwin 并清空聚合器。
   */
  approveTwinCandidate(id: string, by?: string): TwinCandidate | undefined {
    const candidate = this.pendingCandidates.find(c => c.id === id)
    if (!candidate || candidate.status !== 'pending') return undefined

    candidate.status = 'approved'
    candidate.approvedBy = by || 'human'
    candidate.approvedAt = Date.now()

    // 注意: 实际的行为变更在 EvolutionStage 中通过 buildProfile() 触发
    // TwinCandidate 的审批表示"此变更方向被确认"，后续 buildProfile 会更积极采纳
    // 清空聚合器，开始新的证据收集周期
    this.evidenceAggregator.clear()

    return candidate
  }

  /**
   * rejectTwinCandidate — 拒绝 TwinCandidate
   */
  rejectTwinCandidate(id: string, by?: string): TwinCandidate | undefined {
    const candidate = this.pendingCandidates.find(c => c.id === id)
    if (!candidate || candidate.status !== 'pending') return undefined

    candidate.status = 'rejected'
    candidate.approvedBy = by || 'human'
    candidate.approvedAt = Date.now()

    // 清空聚合器，避免相同建议反复出现
    this.evidenceAggregator.clear()

    return candidate
  }

  /**
   * getAggregationSnapshot — 获取证据聚合状态（调试用）
   */
  getAggregationSnapshot(): { field: string; observations: number; uniqueValues: number }[] {
    return this.evidenceAggregator.getSnapshot()
  }
}
