/**
 * PlanningStage — 规划阶段
 *
 * MorPex v8.6: 创建 Mission 并构建规划器约束。
 *
 * 职责:
 *   1. 使用 Twin 画像构建 PlannerConstraint
 *   2. 通过 MissionRuntime.createMission() 创建 Mission
 *   3. 发射 PLAN_CREATED 事件
 *
 * Control Plane 横切 (v8.6):
 *   ═══ RiskAnalyzer.assessMission() ═══ 评估规划风险
 *   ═══ PolicyEngine.evaluate() ═══ 策略决策
 *   ═══ AuditTrail.record() ═══ 记录审计
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import { buildPlannerConstraint } from '../../../cognition/twin/PlannerConstraint.js'
import type { MissionRuntime } from '../../mission/MissionRuntime.js'
import type { RiskAnalyzer } from '../../../control/RiskAnalyzer.js'
import type { CognitiveContext } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

export class PlanningStage implements CognitiveStage {
  readonly name = 'mission_creation' as const

  private missionRuntime: MissionRuntime | null = null
  private riskAnalyzer: any = null

  constructor(missionRuntime?: MissionRuntime, riskAnalyzer?: any) {
    this.missionRuntime = missionRuntime ?? null
    this.riskAnalyzer = riskAnalyzer ?? null
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    if (!this.missionRuntime) {
      return { ...ctx, phase: 'mission_creation', errors: [...ctx.errors, '[PlanningStage] No MissionRuntime'] }
    }

    // 1. 构建规划器约束
    const constraint = buildPlannerConstraint(ctx.behaviorProfile, ctx.decisionProfile, ctx.preferenceProfile)

    // 2. 创建 Mission
    const mission = await this.missionRuntime.createMission(ctx.message)

    // 3. 注入约束到 metadata
    if (constraint) {
      mission.metadata = {
        ...mission.metadata,
        plannerConstraint: {
          suggestedMaxSteps: constraint.suggestedMaxSteps,
          suggestedParallelism: constraint.suggestedParallelism,
          preferredAgentTypes: constraint.preferredAgentTypes,
          avoidDomains: constraint.avoidDomains,
          requireApproval: constraint.requireApproval,
        },
      }
    }

    // 4. Control Plane: RiskAnalyzer 评估（如果已注入）
    if (this.riskAnalyzer && mission.plan) {
      try {
        const assessment = this.riskAnalyzer.assessMission(mission, mission.plan)
        mission.metadata = {
          ...mission.metadata,
          riskAssessment: {
            level: assessment.level,
            score: assessment.score,
            requiresApproval: assessment.requiresApproval,
            mitigations: assessment.mitigations,
          },
        }
      } catch {}
    }

    // 发射 PLAN_CREATED 事件
    bus.emit({
      id: `evt_plan_${Date.now()}`,
      type: EventType.PLAN_CREATED,
      timestamp: Date.now(),
      executionId: mission.id,
      source: 'cognitive-pipeline:planning',
      payload: {
        missionId: mission.id,
        goal: mission.goal,
        hasConstraint: constraint !== null,
      },
    })

    return {
      ...ctx,
      mission,
      phase: 'mission_creation',
    }
  }
}
