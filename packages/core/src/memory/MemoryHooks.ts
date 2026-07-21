/**
 * MemoryHooks — 记忆体系钩子
 *
 * v3.x 重构：pi-agent-core 类型导入集中在 types adapter 中。
 */

import type { AgentEvent, AgentMessage } from '../adapters/pi-types.js';
import type { EventBus, MorPexEvent } from '../common/types.js';
import type { MemoryActivationEngine, ActivationContext } from './MemoryActivationEngine.js';

/** 记忆总线接口 */
export interface MemoryBus {
  remember(params: {
    content: string;
    source: string;
    sourceId: string;
    tags: string[];
    importance: number;
  }): Promise<void>;

  recall(params: {
    text: string;
    topK: number;
  }): Promise<string[]>;
}

/**
 * calculateImportance — 动态计算记忆重要性分数
 *
 * 综合考虑以下因素：
 *   1. **内容长度**：较长的对话包含更多信息，重要性更高
 *      每 500 字符 +1 分
 *   2. **消息数量**：多轮交互比单次问答更重要
 *      每 2 条 assistant 消息 +1 分
 *   3. **来源类型**：反思（reflection）比普通对话更重要
 *      reflection 来源 +2 分
 *
 * 分数范围：1 (最低) ~ 10 (最高)
 *
 * @param content - 记忆文本内容
 * @param assistantMsgCount - assistant 消息数量
 * @param source - 来源类型（execution / reflection 等）
 * @returns 1-10 的重要性分数
 */
export function calculateImportance(
  content: string,
  assistantMsgCount: number,
  source: string = 'execution',
): number {
  let score = 1; // 基础分

  // 内容长度因子：每 500 字符 +1 分
  score += Math.floor(content.length / 500);

  // 消息数量因子：每 2 条 assistant 消息 +1 分
  score += Math.floor(assistantMsgCount / 2);

  // 来源类型因子：反思比普通执行更重要
  if (source === 'reflection' || source === 'refine') {
    score += 2;
  }

  // 确保在 1-10 范围内
  return Math.max(1, Math.min(10, score));
}

/**
 * createAutoMemoryHook — 自动写回钩子
 *
 * 监听 agent_end 事件，提取对话内容，写入记忆系统。
 *
 * 用法：
 *   harness.subscribe(createAutoMemoryHook(memoryBus, executionId, 'default'));
 */
export function createAutoMemoryHook(
  memoryBus: MemoryBus,
  executionId: string = '',
  domainId: string = 'default',
): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    if (event.type !== 'agent_end') return;

    const messages = (event as any).messages as AgentMessage[] | undefined;
    if (!messages || messages.length === 0) return;

    const userMsg = messages.find(m => m.role === 'user');
    const assistantMsgs = messages.filter(m => m.role === 'assistant');

    if (!userMsg || assistantMsgs.length === 0) return;

    const content = assistantMsgs
      .map(m => extractText(m))
      .filter(Boolean)
      .join('\n');

    if (!content) return;

    // 动态计算重要性
    const importance = calculateImportance(content, assistantMsgs.length, 'execution');

    memoryBus.remember({
      content,
      source: 'execution',
      sourceId: executionId,
      tags: ['conversation', domainId],
      importance,
    }).catch((err: unknown) => {
      console.error('[MemoryHooks] 自动写回失败:', (err as Error).message);
    });
  };
}

/**
 * createReasoningMemoryHook — 推理上下文注入钩子
 *
 * 每次 LLM 调用前，从记忆系统检索相关内容，注入到上下文中。
 * 注册到 harness.on('context')。
 *
 * 用法：
 *   harness.on('context', createReasoningMemoryHook(memoryBus));
 */
export function createReasoningMemoryHook(
  memoryBus: MemoryBus,
  topK: number = 5,
): (event: { messages: AgentMessage[] }) => Promise<{ messages: AgentMessage[] }> {
  return async (event: { messages: AgentMessage[] }) => {
    // 提取用户查询
    const queryText = event.messages
      .filter(m => m.role === 'user')
      .map(m => extractText(m))
      .filter(Boolean)
      .join(' ');

    if (!queryText) {
      return { messages: event.messages };
    }

    try {
      // 检索相关记忆
      const memories = await memoryBus.recall({ text: queryText, topK });

      if (memories.length > 0) {
        // 构建 HintMessage 注入
        const hintMsg = buildHintMessage(memories);
        return { messages: [...event.messages, hintMsg] };
      }
    } catch (err) {
      console.warn('[MemoryHooks] 记忆检索失败:', err.message);
    }

    return { messages: event.messages };
  };
}

/**
 * buildHintMessage — 构建记忆 Hint 消息
 */
function buildHintMessage(memories: string[]): AgentMessage {
  const memoryText = memories
    .map((m, i) => `[记忆 ${i + 1}] ${m.substring(0, 500)}`)
    .join('\n\n');

  return {
    role: 'user',
    content: `以下是从记忆系统中检索到的相关历史信息：\n\n${memoryText}\n\n（请参考以上历史信息处理当前请求）`,
  } as AgentMessage;
}

/**
 * extractText — 从消息中提取文本内容
 */
function extractText(msg: any): string {
  if (!msg) return '';

  if (typeof msg.content === 'string') {
    return msg.content;
  }

  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part: any) => part?.type === 'text')
      .map((part: any) => part.text ?? '')
      .join(' ');
  }

  return '';
}

/**
 * Phase 4: createActivationMemoryHook — 使用 MemoryActivationEngine 的增强钩子
 * 支持 state-aware / task-aware / execution-aware 记忆召回
 */
export function createActivationMemoryHook(
  activationEngine: MemoryActivationEngine,
  contextBuilder: (event: AgentEvent) => Partial<ActivationContext>,
) {
  return {
    onAgentEvent: async (event: AgentEvent) => {
      const ctx = contextBuilder(event);
      const memories = await activationEngine.activate(ctx as ActivationContext);
      // Attach activated memories to event for downstream consumers
      (event as any).__activatedMemories = memories;
    },
  };
}
