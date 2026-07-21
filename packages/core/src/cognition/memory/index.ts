/**
 * cognition/memory — Personal Brain 统一导出
 *
 * Phase 6 / MorPex v8: 五层记忆体系。
 */

// ── 类型 ──
export type {
  MemoryLayer,
  MemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  BrainStats,
  WorkflowMemoryEntry,
  DecisionMemoryEntry,
  PreferenceMemoryEntry,
} from './types.js';

export { ALL_LAYERS, LAYER_TTL } from './types.js';

// ── 类 ──
export { PersonalBrain } from './PersonalBrain.js';
export { BrainPersistor } from './BrainPersistor.js';
export { WorkflowMemory } from './WorkflowMemory.js';
export { DecisionMemory } from './DecisionMemory.js';
