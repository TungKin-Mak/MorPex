/**
 * MemoryMessages — Agentic 模式消息类型扩展
 *
 * 提供工具函数用于在 AgentLoopConfig.convertToLlm 中将自定义消息
 * (memoryHint, dagNodeStatus) 转为 LLM 可理解的 user 消息格式。
 *
 * 声明合并移到了 ../adapters/pi-augmentations.ts。
 */

import type { AgentMessage } from '../adapters/pi-types.js';

// ═══════════════════════════════════════════════════════════════
// 声明合并激活（导入适配层的模块扩展）
// ═══════════════════════════════════════════════════════════════

import '../adapters/pi-augmentations.js';

// ═══════════════════════════════════════════════════════════════
// 类型守卫
// ═══════════════════════════════════════════════════════════════

/**
 * isMemoryHintMessage — 判断是否为记忆注入消息
 */
export function isMemoryHintMessage(msg: AgentMessage): boolean {
  return (msg as any).role === 'memoryHint' && Array.isArray((msg as any).memories);
}

/**
 * isDagNodeStatusMessage — 判断是否为 DAG 节点状态消息
 */
export function isDagNodeStatusMessage(msg: AgentMessage): boolean {
  return (msg as any).role === 'dagNodeStatus' && typeof (msg as any).nodeId === 'string';
}

// ═══════════════════════════════════════════════════════════════
// 转换函数
// ═══════════════════════════════════════════════════════════════

/**
 * convertMemoryHintToLlm — 将 memoryHint 消息转为 user message
 *
 * 用于 AgentLoopConfig.convertToLlm 中。
 * 将自定义的 memoryHint 消息转为 LLM 可理解的 user 消息格式。
 */
export function convertMemoryHintToLlm(msg: AgentMessage): AgentMessage {
  const hint = msg as any;
  if (hint.role !== 'memoryHint' || !Array.isArray(hint.memories)) {
    return msg;
  }

  return {
    role: 'user',
    content: `[相关记忆]\n${hint.memories.join('\n---\n')}`,
  } as AgentMessage;
}

/**
 * convertDagNodeStatusToLlm — 将 DAG 节点状态消息转为 user message
 *
 * 用于 AgentLoopConfig.convertToLlm 中。
 */
export function convertDagNodeStatusToLlm(msg: AgentMessage): AgentMessage {
  const dns = msg as any;
  if (dns.role !== 'dagNodeStatus') return msg;

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    running: '🔄',
    success: '✅',
    failed: '❌',
  };

  return {
    role: 'user',
    content: `[DAG 节点状态] ${statusEmoji[dns.status] ?? '❓'} ${dns.nodeId} (${dns.domain}) → ${dns.status}`,
  } as AgentMessage;
}

/**
 * createCustomConvertToLlm — 创建完整的 convertToLlm 回调
 *
 * 包含所有自定义消息类型的转换逻辑。
 * 可直接赋值给 AgentLoopConfig.convertToLlm。
 *
 * @returns convertToLlm 回调函数
 *
 * 用法：
 *   const loopConfig: AgentLoopConfig = {
 *     convertToLlm: createCustomConvertToLlm(),
 *     // ...
 *   };
 */
export function createCustomConvertToLlm(): (messages: AgentMessage[]) => AgentMessage[] {
  return (messages: AgentMessage[]): AgentMessage[] => {
    return messages.map(msg => {
      if (isMemoryHintMessage(msg)) return convertMemoryHintToLlm(msg);
      if (isDagNodeStatusMessage(msg)) return convertDagNodeStatusToLlm(msg);
      return msg;
    });
  };
}
