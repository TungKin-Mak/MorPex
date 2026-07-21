/**
 * @morpex/memory — 入口 (v2)
 *
 * Memory System: MemoryWiki (SQLite + ZVec) + ZVecStorage + HistoryStore
 */

// ── 存储适配器 ──
export { ZVecStorage } from './storage/ZVecStorage.js';
export { JSONLWriter } from './storage/JSONLWriter.js';
export { HistoryStore } from './storage/HistoryStore.js';
export type { CycleRecord, TaskRecord, ExecutionRecord, HistoryRecord } from './storage/HistoryStore.js';

// ── MemoryWiki v1.0 (SQLite + Zvec 统一后端) ──
export { MemoryWiki } from './wiki/MemoryWiki.js';
export { MEMORY_WIKI_SCHEMA, TABLES } from './wiki/schema.js';
export { migrateJSONLtoSQLite, getMigrationSources } from './wiki/migrate.js';
export type {
  MemoryItem as WikiMemoryItem, MemoryRelation as WikiMemoryRelation,
  QueryOptions as WikiQueryOptions, QueryResult as WikiQueryResult,
  VectorHit, GraphNode, EmbeddingProvider, MemoryWikiConfig,
  MigrationSource, MigrationResult,
} from './wiki/types.js';
export type { TableName } from './wiki/schema.js';

// ── Wiki 工具（DocWatcher + DocTopology + MemoryRetriever）──
export { DocWatcher } from './wiki/DocWatcher.js';
export type { DocWatcherConfig } from './wiki/DocWatcher.js';
export { DocTopology } from './wiki/DocTopology.js';
export { MemoryRetriever } from './wiki/MemoryRetriever.js';
export type { RetrievalResult, ErrorRetrievalResult } from './wiki/MemoryRetriever.js';

// ── JSONL 存储运维工具 ──
export { JSONLCompactor } from './storage/Compactor.js';
export type { CompactorConfig } from './storage/Compactor.js';
export { LogRotator } from './storage/LogRotator.js';
export type { LogRotatorConfig } from './storage/LogRotator.js';

// ── 向量 ──
export { EmbeddingClient } from './vector/EmbeddingClient.js';
export { recoverZVecLocks } from './vector/ZVecLockRecovery.js';

// ── 基础类型 ──
export type {
  MemoryItem, MemoryQuery, MemoryType,
  MemoryStats, MemoryStorageAdapter,
  WriteDecision, MemorySystemConfig,
} from './types.js';
