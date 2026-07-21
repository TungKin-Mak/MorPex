/**
 * TwinStage — Twin 检索阶段
 *
 * MorPex v8.6: 从 BehaviorTwin / DecisionTwin / PreferenceModel 检索用户画像。
 *
 * 职责:
 *   1. 构建 BehaviorProfile（含版本号）
 *   2. 构建 DecisionProfile
 *   3. 构建 PreferenceProfile
 *   4. 发射 TWIN_RETRIEVED 事件
 *
 * ★ v8.6: BehaviorTwin 现在支持版本化，buildProfile 返回 version:N
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import type { CognitiveContext } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

export class TwinStage implements CognitiveStage {
  readonly name = 'twin_retrieval' as const

  private behaviorTwin: any = null
  private decisionTwin: any = null
  private preferenceModel: any = null

  constructor(behaviorTwin?: any, decisionTwin?: any, preferenceModel?: any) {
    this.behaviorTwin = behaviorTwin ?? null
    this.decisionTwin = decisionTwin ?? null
    this.preferenceModel = preferenceModel ?? null
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    const uid = ctx.message.userId
    let behaviorProfile: any = null
    let decisionProfile: any = null
    let preferenceProfile: any = null

    if (this.behaviorTwin) {
      try { behaviorProfile = this.behaviorTwin.buildProfile() } catch {}
    }
    if (this.decisionTwin) {
      try { decisionProfile = await this.decisionTwin.buildProfile(uid) } catch {}
    }
    if (this.preferenceModel) {
      try { preferenceProfile = this.preferenceModel.buildProfile() } catch {}
    }

    // 发射 TWIN_RETRIEVED 事件
    bus.emit({
      id: `evt_twin_${Date.now()}`,
      type: EventType.TWIN_RETRIEVED,
      timestamp: Date.now(),
      executionId: uid,
      source: 'cognitive-pipeline:twin',
      payload: {
        userId: uid,
        behaviorVersion: behaviorProfile?.version ?? 0,
        hasDecisionProfile: decisionProfile !== null,
        hasPreferenceProfile: preferenceProfile !== null,
      },
    })

    return {
      ...ctx,
      behaviorProfile,
      decisionProfile,
      preferenceProfile,
      phase: 'twin_retrieval',
    }
  }
}
