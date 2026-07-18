/**
 * wiki/index.ts — MemoryWiki Barrel Export
 */

export { MemoryWiki } from './MemoryWiki.js';
export { MEMORY_WIKI_SCHEMA, TABLES } from './schema.js';
export { migrateJSONLtoSQLite, getMigrationSources } from './migrate.js';
export { DocWatcher } from './DocWatcher.js';
export type { DocWatcherConfig } from './DocWatcher.js';
export { DocTopology } from './DocTopology.js';
export { MemoryRetriever } from './MemoryRetriever.js';
export type { RetrievalResult, ErrorRetrievalResult } from './MemoryRetriever.js';
export type {
  MemoryItem, MemoryRelation, QueryOptions, QueryResult,
  VectorHit, GraphNode, EmbeddingProvider, MemoryWikiConfig,
  MigrationSource, MigrationResult,
} from './types.js';
export type { TableName } from './schema.js';
