/**
 * IntentStage — 意图检测阶段
 *
 * MorPex v8.6: 从用户消息中提取意图。
 *
 * 职责:
 *   1. 分析用户消息内容，提取关键词和意图
 *   2. 计算意图置信度
 *   3. 通过 EventBus 发射 INTENT_DETECTED 事件
 *   4. ★ v8.6: 记录 DecisionEvent（输入→推理→决策）
 *
 * Control Plane 横切:
 *   - RiskAnalyzer: 评估意图的风险等级
 *   - AuditTrail: 记录意图检测的审计信息
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import type { IncomingMessage } from '../../../interaction/types.js'
import type { CognitiveContext, DetectedIntent } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

export class IntentStage implements CognitiveStage {
  readonly name = 'intent_detection' as const

  constructor() {}

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    const msg = ctx.message
    const intent = this.detectIntent(msg)

    // 发射 INTENT_DETECTED 事件
    bus.emit({
      id: `evt_intent_${Date.now()}`,
      type: EventType.INTENT_DETECTED,
      timestamp: Date.now(),
      executionId: msg.userId,
      source: 'cognitive-pipeline:intent',
      payload: {
        goal: intent.goal,
        keywords: intent.keywords,
        confidence: intent.confidence,
        isNewGoal: intent.isNewGoal,
      },
    })

    return {
      ...ctx,
      intent,
      phase: 'intent_detection',
    }
  }

  private detectIntent(msg: IncomingMessage): DetectedIntent {
    const c = msg.content.trim()
    const sw = new Set(['the','a','an','is','are','to','of','in','for','on','and','的','了','在','是','我','有','和','就','不'])
    const kw = [...new Set(c.toLowerCase().split(/[s,，。！？、；：()]+/).filter((w: string) => w.length > 1 && !sw.has(w)))]
    return {
      goal: c,
      keywords: kw,
      domain: undefined,
      confidence: kw.length > 0 ? Math.min(kw.length / 5, 1.0) : 0.3,
      isNewGoal: true,
    }
  }
}
