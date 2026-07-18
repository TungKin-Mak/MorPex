/**
 * @morpex/memory — 入口 (v2)
 *
 * Memory System v2: Main Pool (竞争池) + Archive (归档池) + Temp Pool (阶段临时池)
 *
 * 使用方式:
 *   import { createMemoryBus } from '@morpex/memory';
 *   const { bus } = createMemoryBus({ dataDir: './data/memory-bus' });
 *   await bus.initialize();
 *   await bus.remember({ content: '...', memType: 'knowledge' });
 *   const r = await bus.recall({ text: '...', includeArchive: true });
 *   await bus.shutdown();
 */

// ── 核心 ──
// MemoryEngine removed in v2 — use MemoryBus instead
export { WriteGate } from './core/WriteGate.js';
export { MemoryBus } from './core/MemoryBus.js';
export type {
  MemoryPayload, RecallQuery, RecallResult, RecallStrategy,
  IndexEntry, GateLogEntry, MemoryBusConfig, ImproveResult,
} from './core/MemoryBus.js';

// ── 存储适配器 ──
export { ZVecStorage } from './storage/ZVecStorage.js';
export { JSONLWriter } from './storage/JSONLWriter.js';
export { HistoryStore } from './storage/HistoryStore.js';
export type { CycleRecord, TaskRecord, ExecutionRecord, HistoryRecord } from './storage/HistoryStore.js';

// ── ECL 流水线 ──
export { ECLCognifyEngine, createCognifyEngine } from './core/ECLCognifyEngine.js';
export type { ExtractedEntity, ExtractedRelation, CognifyResult, CognifyConfig } from './core/ECLCognifyEngine.js';

// ── 文档摄入 ──
export { DocumentIngestion } from './core/DocumentIngestion.js';
export type { IngestionResult, ChunkRecord } from './core/DocumentIngestion.js';

// ── 用户画像 ──
export { UserProfileEngine } from './core/UserProfileEngine.js';
export type { UserTrait, ProfileUpdateResult } from './core/UserProfileEngine.js';

// ── 检查点系统 ──
export { TaskCheckpointManager, createEmptyCheckpoint } from './core/TaskCheckpointManager.js';
export type { CheckpointPayload, CheckpointSummary, CleanResult } from './core/TaskCheckpointManager.js';

// ── 配置持久化 ──
export { ConfigStore } from './core/ConfigStore.js';
export type { SystemConfig } from './core/ConfigStore.js';

// ── 工作区索引 ──
export { WorkspaceIndexer } from './core/WorkspaceIndexer.js';
export type { WorkspaceEntry, IndexStats } from './core/WorkspaceIndexer.js';

// ── 聊天记忆提取 ──
export { ChatMemoryExtractor } from './core/ChatMemoryExtractor.js';
export type { ExtractableMessage, ExtractionResult } from './core/ChatMemoryExtractor.js';

// ── Markdown 知识库索引 ──
export { MarkdownIndexer } from './core/MarkdownIndexer.js';
export type { MarkdownFile, IndexResult as MarkdownIndexResult, MarkdownIndexerConfig } from './core/MarkdownIndexer.js';

// ── 向量 ──
export { EmbeddingClient } from './vector/EmbeddingClient.js';
export { recoverZVecLocks } from './vector/ZVecLockRecovery.js';

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

// ── v2 类型 ──
export type {
  MemType,
  MemoryGateConfig,
  MemoryGateSignal,
  StageDefinition,
  CompactResult,
  FeedbackResult,
} from './types.js';

// ── v2 类型 (MemoryBus 内定义) ──
export type { ScoreWeights } from './core/MemoryBus.js';

// ── 基础类型 ──
export type {
  MemoryItem, MemoryQuery, MemoryType,
  MemoryStats, MemoryStorageAdapter,
  WriteDecision, MemorySystemConfig,
} from './types.js';

// ── 工厂函数 ──

import { MemoryBus } from './core/MemoryBus.js';
import type { MemoryBusConfig } from './core/MemoryBus.js';
import { ZVecStorage } from './storage/ZVecStorage.js';
import { ECLCognifyEngine } from './core/ECLCognifyEngine.js';
import { DocumentIngestion } from './core/DocumentIngestion.js';
import { UserProfileEngine } from './core/UserProfileEngine.js';
import { TaskCheckpointManager } from './core/TaskCheckpointManager.js';
import { ConfigStore } from './core/ConfigStore.js';
import { WorkspaceIndexer } from './core/WorkspaceIndexer.js';
import { MarkdownIndexer } from './core/MarkdownIndexer.js';
import type { MarkdownIndexerConfig } from './core/MarkdownIndexer.js';
import { ChatMemoryExtractor } from './core/ChatMemoryExtractor.js';
import { EmbeddingClient } from './vector/EmbeddingClient.js';

/**
 * 创建 Cognee+Letta 风格的三维一体记忆总线 (v2)
 *
 * 自动装配：MemoryBus + ZVecStorage + ECLCognifyEngine + DocumentIngestion + UserProfileEngine
 *
 * @example
 * ```typescript
 * const { bus } = createMemoryBus({ dataDir: './data/memory-bus' });
 * await bus.initialize();
 * await bus.remember({ content: '用户偏好轻量级方案', memType: 'profile', importance: 4 });
 * await bus.planStages([
 *   { name: '需求分析', goal: '...', output: '...', memoryGates: { ... } },
 * ]);
 * const signal = bus.audit('继续昨天的硬件选型', '需求分析');
 * const corrections = await bus.interceptInput('EC芯片型号是?');
 * ```
 */
export function createMemoryBus(config?: MemoryBusConfig): {
  bus: MemoryBus;
  vectorStore: ZVecStorage;
  cognify: ECLCognifyEngine;
  ingestion: DocumentIngestion;
  profile: UserProfileEngine;
  checkpoints: TaskCheckpointManager;
  readonly configStore: ConfigStore;
  readonly workspaceIndex: WorkspaceIndexer;
  readonly chatExtractor: ChatMemoryExtractor;
  readonly markdownIndexer: MarkdownIndexer;
} {
  const dataDir = config?.dataDir ?? './data/memory-bus';
  const bus = new MemoryBus(config);
  
  const vectorStore = new ZVecStorage({
    dataPath: `${dataDir}/zvec`,
    embedUrl: config?.embedUrl,
    dimension: config?.vectorDimension,
  });
  bus.setVectorStore(vectorStore);

  const cognify = new ECLCognifyEngine({
    llmEndpoint: 'http://localhost:11434/api/generate',
    llmModel: 'deepseek-r1:1.5b',
  });
  cognify.bindGraph(bus.getGraph());

  const embedder = new EmbeddingClient(config?.embedUrl);
  const ingestion = new DocumentIngestion(bus, cognify, embedder);

  const profile = new UserProfileEngine();

  const checkpoints = new TaskCheckpointManager();

  // ── 惰性初始化：以下组件仅在首次访问时创建（按需取用，单例缓存）──

  let _configStore: ConfigStore | null = null;
  let _workspaceIndex: WorkspaceIndexer | null = null;
  let _chatExtractor: ChatMemoryExtractor | null = null;
  let _markdownIndexer: MarkdownIndexer | null = null;

  return {
    bus,
    vectorStore,
    cognify,
    ingestion,
    profile,
    checkpoints,
    get configStore() {
      if (!_configStore) {
        console.log('[MemoryBus] 惰性初始化: ConfigStore');
        _configStore = new ConfigStore();
      }
      return _configStore;
    },
    get workspaceIndex() {
      if (!_workspaceIndex) {
        console.log('[MemoryBus] 惰性初始化: WorkspaceIndexer');
        _workspaceIndex = new WorkspaceIndexer();
      }
      return _workspaceIndex;
    },
    get chatExtractor() {
      if (!_chatExtractor) {
        console.log('[MemoryBus] 惰性初始化: ChatMemoryExtractor');
        _chatExtractor = new ChatMemoryExtractor(bus, cognify, profile);
      }
      return _chatExtractor;
    },
    get markdownIndexer() {
      if (!_markdownIndexer) {
        console.log('[MemoryBus] 惰性初始化: MarkdownIndexer');
        _markdownIndexer = new MarkdownIndexer(bus, ingestion, cognify);
      }
      return _markdownIndexer;
    },
  };
}
