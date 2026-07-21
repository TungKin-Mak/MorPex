/**
 * GoalStage — 目标匹配阶段
 *
 * MorPex v8.6: 将检测到的意图与已有目标匹配。
 *
 * 职责:
 *   1. 使用 GoalManager 的 Jaccard 匹配算法
 *   2. 更新 context.matchedGoals
 *   3. 发射 GOAL_MATCHED 事件
 *
 * Control Plane 横切:
 *   - 无直接控制，但结果会被后续 PlanningStage 中的 RiskAnalyzer 使用
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import type { CognitiveContext } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

export class GoalStage implements CognitiveStage {
  readonly name = 'goal_matching' as const

  private goalManager: any = null

  constructor(goalManager?: any) {
    this.goalManager = goalManager ?? null
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    const matchedGoals: string[] = []

    // 如果有 GoalManager，尝试匹配
    if (this.goalManager && ctx.intent) {
      try {
        const matches = await this.goalManager.findMatches(ctx.intent.goal)
        if (matches && matches.length > 0) {
          matchedGoals.push(...matches.map((m: any) => m.id || m))
          ctx.intent.isNewGoal = false
        }
      } catch {
        // 匹配失败使用空列表
      }
    }

    // 发射 GOAL_MATCHED 事件
    bus.emit({
      id: `evt_goal_${Date.now()}`,
      type: EventType.GOAL_MATCHED,
      timestamp: Date.now(),
      executionId: ctx.message.userId,
      source: 'cognitive-pipeline:goal',
      payload: {
        matchedGoals,
        isNewGoal: ctx.intent.isNewGoal,
        goal: ctx.intent.goal,
      },
    })

    return {
      ...ctx,
      matchedGoals,
      phase: 'goal_matching',
    }
  }
}
