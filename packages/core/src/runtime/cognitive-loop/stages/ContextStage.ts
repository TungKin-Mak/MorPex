/**
 * ContextStage — 上下文构建阶段
 *
 * v9.1: 在 IntentStage 之前执行，统一构建 ExecutionContext。
 *
 * 职责：
 *   1. 调用 ContextAssemblyEngine.assemble() 构建完整上下文
 *   2. 将 ExecutionContext 注入 CognitiveContext
 *   3. 发射 CONTEXT_ASSEMBLED 事件
 */

import type { CognitiveStage } from '../CognitivePipeline.js'
import { ContextAssemblyEngine } from '../../../context/ContextAssemblyEngine.js'
import type { EventBus } from '../../../common/EventBus.js'
import type { CognitiveContext } from '../types.js'

export class ContextStage implements CognitiveStage {
  readonly name = 'context_assembly'

  constructor(private engine: ContextAssemblyEngine) {}

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    // 使用 sessionId 作为 missionId 的输入，因为 IncomingMessage 没有 id 字段
    const missionId = `ctx_${ctx.message.sessionId}_${Date.now()}`

    const execCtx = await this.engine.assemble({
      missionId,
      userId: ctx.message.userId,
    })

    // 将组装完成的 ExecutionContext 附加到 CognitiveContext
    ;(ctx as any).assembledContext = execCtx

    // 发射事件（使用 MorPexEvent 格式）
    bus.emit({
      id: `evt_context_${Date.now()}`,
      type: 'context.assembled',
      timestamp: Date.now(),
      executionId: missionId,
      source: 'context-stage',
      payload: {
        contextId: execCtx.contextId,
        version: execCtx.version,
        fragmentCount: execCtx.fragments.length,
        layers: Object.keys(execCtx.layers),
      },
    })

    return ctx
  }
}
