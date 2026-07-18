/**
 * Memory — 记忆系统统一出口
 *
 * 导出 v2.4 全部记忆模块：
 *   - MemoryHooks: 自动写回 + 推理注入
 *   - MemoryMessages: 声明合并扩展
 *   - VectorStoreAdapter: 向量存储适配器
 */

export { createAutoMemoryHook, createReasoningMemoryHook } from './MemoryHooks.js';
export type { MemoryBus } from './MemoryHooks.js';

export {
  convertMemoryHintToLlm,
  convertDagNodeStatusToLlm,
  createCustomConvertToLlm,
  isMemoryHintMessage,
  isDagNodeStatusMessage,
} from './MemoryMessages.js';

export { VectorStoreAdapter, createMemoryBus } from './VectorStoreAdapter.js';
