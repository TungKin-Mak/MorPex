/**
 * @morpex/memory — 入口 (v2)
 *
 * Memory System: MemoryWiki (SQLite-only) + HistoryStore + 统一记忆层 (MemoryAPI/cognee)
 */

// ── 存储适配器 ──
export { JSONLWriter } from './storage/JSONLWriter.js';
export { HistoryStore } from './storage/HistoryStore.js';
export type { CycleRecord, TaskRecord, ExecutionRecord, HistoryRecord } from './storage/HistoryStore.js';

// ── MemoryWiki v1.0 (SQLite 统一后端) ──
export { MemoryWiki } from './wiki/MemoryWiki.js';
export { MEMORY_WIKI_SCHEMA, TABLES } from './wiki/schema.js';
export { migrateJSONLtoSQLite, getMigrationSources } from './wiki/migrate.js';
export type {
  MemoryItem as WikiMemoryItem, MemoryRelation as WikiMemoryRelation,
  QueryOptions as WikiQueryOptions, QueryResult as WikiQueryResult,
  VectorHit, GraphNode, MemoryWikiConfig,
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

// ── 基础类型 ──
export type {
  MemoryItem, MemoryQuery, MemoryType,
  MemoryStats, MemoryStorageAdapter,
  WriteDecision, MemorySystemConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// 统一记忆层（MemoryAPI — cognee 引擎 + 白名单 + 确认队列 + 强制门禁）
// 新增于记忆系统统一改造。只增不改，保留上方旧导出以兼容现有消费点。
// ═══════════════════════════════════════════════════════════════════

// ── 统一契约 ──
export type {
  MemoryAPI,
  MemoryEngine,
  MemoryHit,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryQuerySource,
  NeedHumanReason,
  UpsertEntityInput,
  UpsertResult,
  ConfirmTicket,
  ConfirmDecision,
  ReflectResult,
  EngineHit,
  EngineSearchOptions,
  EngineWriteOptions,
} from './memory-types.js';

// ── API 实现 + 工厂 ──
export { MemoryApi, DEFAULT_CONFIRMATION_DB, AUTO_WRITE_CONFIDENCE } from './api/MemoryApi.js';
export type { MemoryApiOptions } from './api/MemoryApi.js';
export { createMemoryApi } from './api/factory.js';

// ── 本体白名单 ──
export {
  ENTITY_TYPES, RELATION_TYPES, DOMAIN_ONTOLOGY,
  isEntityType, isRelationType, entitiesForDomain, relationsForDomain,
} from './ontology/schema.js';
export type { CompanyEntityType, CompanyRelationType } from './ontology/schema.js';
export { validateUpsert } from './ontology/validate.js';

// ── 确认队列 ──
export { ConfirmationQueue } from './confirmation/queue.js';

// ── 门禁 ──
export { ForceRetriever, buildEvidenceContext, CONFIDENCE_HUMAN_THRESHOLD } from './gate/ForceRetrieve.js';
export { isCompanyKnowledgeDomain, requiresGraphFacts } from './gate/domain.js';

// ── 引擎适配器 ──
export { CogneeClient } from './engines/cognee/client.js';
export type { CogneeConfig } from './engines/cognee/client.js';
export { CogneeEngine } from './engines/cognee/CogneeEngine.js';
export { MockEngine } from './engines/mock/MockEngine.js';
export { createEngine } from './engines/factory.js';
export type { EngineFactoryOptions } from './engines/factory.js';
