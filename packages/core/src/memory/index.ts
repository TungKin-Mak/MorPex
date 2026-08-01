/**
 * @morpex/core/memory — Memory hooks and message types
 */
export { createAutoMemoryHook, createReasoningMemoryHook } from './MemoryHooks.js';
export type { MemoryBus } from './MemoryHooks.js';
export { convertMemoryHintToLlm, convertDagNodeStatusToLlm, createCustomConvertToLlm, isMemoryHintMessage, isDagNodeStatusMessage } from './MemoryMessages.js';
export { MemoryActivationEngine } from './MemoryActivationEngine.js';
export type { ActivationContext, ActivationResult, MemoryActivationSource } from './MemoryActivationEngine.js';
export { setGlobalActivationEngine, getGlobalActivationEngine } from './activationRegistry.js';

// ═══ 记忆统一入口：hooks 记忆总线 → 统一记忆层（MemoryAPI）═══
export { createMemoryApiBus, createMemoryActivationSource, hitToMemoryRecord } from './MemoryApiBus.js';
