/**
 * Memory Plugin — 类型定义 (v2)
 *
 * ⚠️ 已废弃：所有类型已迁移到 @morpex/memory 模块。
 * 本文件保留向后兼容的重新导出。
 *
 * v2: MemoryEngine 已删除，使用 MemoryBus 替代。
 */

// Re-export from @morpex/memory
export type {
  MemoryItem,
  MemoryQuery,
  MemoryType,
  MemoryStats,
  MemoryStorageAdapter,
  WriteDecision,
  MemorySystemConfig,
  MemType,
  MemoryGateConfig,
  MemoryGateSignal,
  StageDefinition,
  CompactResult,
  FeedbackResult,
} from '../../../../../memory/src/index.js';

// Legacy aliases
export type MemoryImportance = 1 | 2 | 3 | 4 | 5;
