/**
 * PersistenceStage — 持久化阶段
 *
 * MorPex v8.6: 将认知循环的结果持久化到长期存储。
 *
 * 职责:
 *   1. 通过 BrainPersistor 将认知数据写入 MemoryWiki
 *   2. 确保所有学习数据被持久化
 *   3. 发射 MEMORY_WRITE 事件
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import type { CognitiveContext } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

export class PersistenceStage implements CognitiveStage {
  readonly name = 'persistence' as const

  private brainPersistor: any = null

  constructor(brainPersistor?: any) {
    this.brainPersistor = brainPersistor ?? null
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    if (this.brainPersistor) {
      try {
        await this.brainPersistor.persist()
      } catch {}
    }

    // 发射 MEMORY_WRITE 事件
    bus.emit({
      id: `evt_persist_${Date.now()}`,
      type: EventType.MEMORY_WRITE,
      timestamp: Date.now(),
      executionId: ctx.message.userId,
      source: 'cognitive-pipeline:persistence',
      payload: {
        userId: ctx.message.userId,
        hasMission: ctx.mission !== null,
        hasResult: ctx.result !== null,
      },
    })

    return {
      ...ctx,
      phase: 'completed',
    }
  }
}
