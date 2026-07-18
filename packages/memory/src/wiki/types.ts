/**
 * types.ts — MemoryWiki 类型契约
 *
 * MemoryWiki v1.0: SQLite + Zvec 统一记忆后端
 * 替代 31 个 JSONL 文件的分散持久化
 */

// ═══════════════════════════════════════════════════════════════
// 通用记忆条目
// ═══════════════════════════════════════════════════════════════

export interface MemoryItem {
  /** 唯一 ID（由调用者生成，如 plan_xxx / tpl_xxx / err_xxx） */
  id: string;
  /** 实体类型：PlanRecord | PlanTemplate | ErrorLog | TemplateLineage | ToolQuality | KgEntity | MemoryEntry */
  type: string;
  /** 人类可读名称 */
  name: string;
  /** BGE-M3 1024 维向量（可选，无向量则只存 SQLite） */
  embedding?: number[];
  /** 结构化数据（JSON 列，SQLite 支持 JSON 函数查询） */
  data?: Record<string, unknown>;
  /** 关系边 */
  relations?: MemoryRelation[];
}

export interface MemoryRelation {
  toId: string;
  type: string;
  properties?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 查询
// ═══════════════════════════════════════════════════════════════

export interface QueryOptions {
  /** 向量召回 TopK */
  topK?: number;
  /** 图遍历跳数 */
  hops?: number;
  /** L1 查询缓存 TTL（秒），默认 300 */
  cacheTTL?: number;
}

export interface QueryResult {
  /** 向量召回结果 */
  vectors: VectorHit[];
  /** 图遍历结果 */
  graph: GraphNode[];
  /** 查询时间戳 */
  timestamp: number;
}

export interface VectorHit {
  id: string;
  score: number;
}

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  data: Record<string, unknown> | null;
  /** 距离起始节点的跳数 */
  hop: number;
}

// ═══════════════════════════════════════════════════════════════
// Embedding 提供者接口（依赖注入）
// ═══════════════════════════════════════════════════════════════

export interface EmbeddingProvider {
  /** 计算文本的向量（可能命中缓存） */
  embed(text: string): Promise<number[] | null>;
  /** 缓存统计 */
  cacheStats?: () => { hits: number; misses: number; hitRate: number };
}

// ═══════════════════════════════════════════════════════════════
// MemoryWiki 配置
// ═══════════════════════════════════════════════════════════════

export interface MemoryWikiConfig {
  /** SQLite 数据库路径 */
  dbPath?: string;
  /** zvec 向量库路径 */
  zvecPath?: string;
  /** Embedding 提供者（VectorStore 的 getEmbedding） */
  embedder?: EmbeddingProvider;
  /** L1 查询缓存大小 */
  queryCacheMax?: number;
  /** L1 查询缓存 TTL（毫秒） */
  queryCacheTTL?: number;
  /** L2 Embedding 缓存大小 */
  embedCacheMax?: number;
  /** L2 Embedding 缓存 TTL（毫秒） */
  embedCacheTTL?: number;
}

// ═══════════════════════════════════════════════════════════════
// 迁移
// ═══════════════════════════════════════════════════════════════

export interface MigrationSource {
  /** JSONL 文件路径 */
  path: string;
  /** 目标表名 */
  table: string;
  /** 行解析器：JSONL 行 → MemoryItem */
  parser: (line: Record<string, unknown>) => MemoryItem;
}

export interface MigrationResult {
  source: string;
  table: string;
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
  durationMs: number;
}
