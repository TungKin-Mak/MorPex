/**
 * LLMFactory — 大型语言模型初始化工厂
 *
 * ═══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL ROLE
 *   Extracted from StudioServer.initControlPlane() to isolate pi-ai
 *   imports and streaming LLM setup from the server god object.
 *
 *   This is the ONLY module in studio/server/ that imports pi-ai
 *   directly. All other modules access LLM through LLMProvider singleton.
 * ═══════════════════════════════════════════════════════════════════
 */

import type { MorPexEvent, EventBus, MorPexPlugin } from '../../core/src/common/types.js';
import { LLMProvider } from '../../core/src/services/LLMProvider.js';
import { IntentPlugin } from '../../core/src/planes/control-plane/intent/plugin.js';
import { IndustryPlugin } from '../../core/index.js';

/**
 * createLLMAndPlugins — 初始化 LLM 并注册插件
 *
 * 动态导入 pi-ai（类型声明不完善但运行时正常），创建带流式支持
 * 的 LLM 调用函数，设置 LLMProvider 单例，注册 IntentPlugin 和 IndustryPlugin。
 *
 * @returns { controlModel } - pi-ai 模型实例（供 MetaPlanner 等使用）
 */
export async function createLLMAndPlugins(params: {
  eventBus: EventBus;
  createEventId: () => string;
  kernel: { registerPlugin: (plugin: MorPexPlugin) => void };
  getDagExecId: () => string;
  getSessionId: () => string;
}): Promise<{ controlModel: Record<string, unknown> }> {
  const { eventBus, createEventId, kernel, getDagExecId, getSessionId } = params;

  const { getModel, completeSimple, streamSimple } = await import('@earendil-works/pi-ai');
  const model = getModel('deepseek', 'deepseek-v4-flash') as import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>;

  // ── 1. 创建带流式支持的 LLM 调用函数 ──
  const callLLM = async (prompt: string, systemPrompt?: string): Promise<string> => {
    try {
      const stream = streamSimple(model, {
        systemPrompt: systemPrompt ?? '你是一个有用的助手。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      }, { maxTokens: 2000, temperature: 0.3 });

      let fullText = '';
      const iterate = async () => {
        for await (const event of stream) {
          if (event.type === 'text_delta') {
            fullText += event.delta;
            const execId = getDagExecId() || getSessionId() || '';
            if (execId) {
              eventBus.emit({
                id: createEventId(),
                type: 'message_update',
                timestamp: Date.now(),
                executionId: execId,
                source: 'llm',
                payload: { delta: event.delta },
              });
            }
          }
        }
      };

      const winner = await Promise.race([
        stream.result().then(() => 'done' as const),
        iterate().then(() => 'done' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000)),
      ]);

      if (winner === 'timeout') {
        console.warn('[LLM] streamSimple 超时，降级 completeSimple');
      } else if (fullText.trim()) {
        return fullText.trim();
      }
    } catch (err) {
      console.warn('[LLM] streamSimple 异常:', err instanceof Error ? err.message : String(err));
    }

    // Fallback: completeSimple
    const msg = await completeSimple(model, {
      systemPrompt: systemPrompt ?? '你是一个有用的助手。',
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    }, { maxTokens: 2000, temperature: 0.3 });
    const textParts = (msg.content || [])
      .filter((c: { type?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text ?? '');
    return textParts.join('').trim();
  };

  LLMProvider.set(callLLM);
  console.log(`  ├─ LLMProvider    ✅`);

  // ── 2. 注册插件 ──
  const intentPlugin = new IntentPlugin();
  kernel.registerPlugin(intentPlugin);
  const industryPlugin = new IndustryPlugin();
  kernel.registerPlugin(industryPlugin);
  console.log(`  ├─ IntentPlugin   ✅`);
  console.log(`  ├─ IndustryPlugin ✅`);

  return { controlModel: model };
}
