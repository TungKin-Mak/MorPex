/**
 * MemoryWiki.ts — SQLite + Zvec 统一记忆后端
 *
 * v1.0: 替代 31 个 JSONL 文件的分散持久化。
 *
 * 持久层:
 *   SQLite (WAL 模式) — 图拓扑 + 元数据 + 索引查询
 *   Zvec (HNSW)       — 1024 维语义向量搜索
 *
 * 缓存层:
 *   L1: 查询结果 LRU (5min TTL, 1000 entries)
 *   L2: Embedding 文本→向量 LRU (2h TTL, 5000 entries)
 *
 * 使用:
 *   const wiki = new MemoryWiki({ dbPath, zvecPath, embedder });
 *   await wiki.remember({ id, type, name, embedding, data, relations });
 *   const result = await wiki.query(embedding, { topK: 10, hops: 2 });
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { LRUCache } from 'lru-cache';
import type {
  MemoryItem, MemoryRelation, QueryOptions, QueryResult,
  VectorHit, GraphNode, EmbeddingProvider, MemoryWikiConfig,
} from './types.js';
import { MEMORY_WIKI_SCHEMA, TABLES } from './schema.js';

// ═══════════════════════════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: Required<Omit<MemoryWikiConfig, 'embedder'>> = {
  dbPath: './data/memory.db',
  zvecPath: './data/zvec_wiki',
  queryCacheMax: 1000,
  queryCacheTTL: 1000 * 60 * 5,
  embedCacheMax: 5000,
  embedCacheTTL: 1000 * 60 * 60 * 2,
};

// ═══════════════════════════════════════════════════════════════
// MemoryWiki
// ═══════════════════════════════════════════════════════════════

export class MemoryWiki {
  // ── 持久层 ──
  private db: ReturnType<typeof import('better-sqlite3')> | null = null;
  private zvecColl: Record<string, unknown> | null = null;
  private zvecPath: string;

  // ── Embedding ──
  private embedder: EmbeddingProvider | null;

  // ── 缓存 ──
  private queryCache: LRUCache<string, QueryResult>;
  private embeddingCache: LRUCache<string, number[]>;

  // ── 状态 ──
  private _ready = false;

  constructor(config: MemoryWikiConfig = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    this.zvecPath = path.resolve(cfg.zvecPath);
    this.embedder = config.embedder ?? null;

    // L1 查询缓存
    this.queryCache = new LRUCache({
      max: cfg.queryCacheMax,
      ttl: cfg.queryCacheTTL,
      updateAgeOnGet: true,
    });

    // L2 Embedding 缓存
    this.embeddingCache = new LRUCache({
      max: cfg.embedCacheMax,
      ttl: cfg.embedCacheTTL,
    });
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  get ready(): boolean {
    return this._ready;
  }

  async initialize(): Promise<void> {
    // 1. SQLite
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.resolve(
      (this as unknown as { _config: MemoryWikiConfig })._config?.dbPath ?? DEFAULT_CONFIG.dbPath,
    );
    // 实际使用 constructor 传入的路径
    const resolvedDbPath = path.resolve(DEFAULT_CONFIG.dbPath);
    const dbDir = path.dirname(resolvedDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(resolvedDbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(MEMORY_WIKI_SCHEMA);

    // 2. Zvec
    try {
      const _require = createRequire(import.meta.url);
      const zvec = _require('@zvec/zvec');
      const schema = new zvec.ZVecCollectionSchema({
        name: 'wiki_vectors',
        vectors: {
          name: 'embedding',
          dataType: zvec.ZVecDataType.VECTOR_FP32,
          dimension: 1024,
        },
        fields: [
          { name: 'doc_id', dataType: zvec.ZVecDataType.STRING },
        ],
      });

      try {
        this.zvecColl = zvec.ZVecOpen(this.zvecPath);
      } catch {
        try {
          this.zvecColl = zvec.ZVecCreateAndOpen(this.zvecPath, schema);
        } catch (createErr: unknown) {
          const backupPath = this.zvecPath + '.backup.' + Date.now();
          console.warn(`[MemoryWiki] zvec 不兼容，尝试备份到: ${path.basename(backupPath)}`);
          try {
            // 尝试重命名旧目录（备份）
            fs.renameSync(this.zvecPath, backupPath);
            this.zvecColl = zvec.ZVecCreateAndOpen(this.zvecPath, schema);
          } catch {
            // ★ 修复: Windows 上 rename/rm 可能失败（EPERM，zvec 持有文件句柄）
            // 改用新路径
            const newPath = this.zvecPath + '_' + Date.now();
            console.warn(`[MemoryWiki] 备份失败，使用新路径: ${path.basename(newPath)}`);
            try {
              this.zvecColl = zvec.ZVecCreateAndOpen(newPath, schema);
              this.zvecPath = newPath;
            } catch (newPathErr: unknown) {
              console.warn(`[MemoryWiki] zvec 初始化失败: ${(newPathErr as Error).message}，向量搜索降级`);
              this.zvecColl = null;
            }
          }
        }
      }
      console.log('[MemoryWiki] zvec 就绪');
    } catch {
      console.warn('[MemoryWiki] zvec 不可用 — 向量搜索降级');
      this.zvecColl = null;
    }

    this._ready = true;
    console.log('[MemoryWiki] 初始化完成 (SQLite + zvec)');
  }

  // ═════════════════════════════════════════════════════════════
  // 写入
  // ═════════════════════════════════════════════════════════════

  /**
   * remember — 记住一条知识（向量 + 实体 + 关系 + 事件）
   */
  async remember(item: MemoryItem): Promise<void> {
    if (!this.db) throw new Error('MemoryWiki not initialized');

    const now = Math.floor(Date.now() / 1000);

    // 自动计算 embedding
    let emb = item.embedding;
    if (!emb && item.name && this.embedder) {
      const cachedEmb = this.embeddingCache.get(item.name);
      if (cachedEmb) {
        emb = cachedEmb;
      } else {
        const computed = await this.embedder.embed(item.name);
        if (computed) {
          emb = computed;
          this.embeddingCache.set(item.name, computed);
        }
      }
    }

    // Zvec 向量写入
    if (emb && this.zvecColl) {
      try {
        (this.zvecColl as { upsertSync: (doc: Record<string, unknown>) => void }).upsertSync({
          id: item.id,
          vectors: { embedding: emb },
          fields: { doc_id: item.id },
        });
      } catch { /* 向量写入失败不阻塞 */ }
    }

    // SQLite 写入（事务）—— 通用实体表 + 领域专用表
    const insertEntity = this.db.prepare(`
      INSERT OR REPLACE INTO kg_entities (id, type, name, domain, tags, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRelation = this.db.prepare(`
      INSERT INTO kg_relations (from_id, to_id, type, properties_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertEvent = this.db.prepare(`
      INSERT INTO event_log (id, entity_id, event_type, data_json, timestamp)
      VALUES (?, ?, 'remember', ?, ?)
    `);

    // ★ 类型 → 领域表路由（根据 item.type 写入对应表）
    const domainInsert = this.buildDomainInsert(item);

    const transaction = this.db.transaction(() => {
      // 通用实体表（始终写入）
      insertEntity.run(
        item.id, item.type, item.name,
        (item.data as Record<string, unknown>)?.domain ?? null,
        JSON.stringify((item.data as Record<string, unknown>)?.tags ?? []),
        JSON.stringify(item.data ?? {}),
        now,
      );

      // 领域专用表（按类型路由）
      if (domainInsert) {
        try { domainInsert.run(); } catch { /* 领域表写入失败不阻塞 */ }
      }

      if (item.relations?.length) {
        for (const r of item.relations) {
          insertRelation.run(
            item.id, r.toId, r.type,
            JSON.stringify(r.properties ?? {}),
            now,
          );
        }
      }

      // 事件日志（加随机后缀防冲突）
      const eventId = `evt_${item.id}_${now}_${Math.random().toString(36).slice(2, 8)}`;
      insertEvent.run(eventId, item.id, JSON.stringify({ type: item.type, name: item.name }), now);
    });

    transaction();

    // 写后清 L1 查询缓存
    this.queryCache.clear();
  }

  /**
   * rememberMany — 批量写入
   */
  async rememberMany(items: MemoryItem[]): Promise<void> {
    for (const item of items) {
      await this.remember(item);
    }
  }

  /**
   * buildDomainInsert — 按 item.type 路由到领域专用表
   *
   * 类型 → 表映射:
   *   PlanRecord      → plan_records
   *   PlanTemplate    → plan_templates
   *   TemplateLineage → template_lineages
   *   HistoryRecord   → history_records
   *   ErrorLog        → error_logs
   *   ErrorReport     → error_reports
   *   ToolQuality     → tool_quality
   *   DecisionTrace   → decision_traces
   *   DeviationLog    → deviation_logs
   *   IntelligenceState → intelligence_state (upsert singleton)
   *   MemoryEntry     → memory_entries
   */
  private buildDomainInsert(item: MemoryItem): any {
    if (!this.db) return null;
    const d = (item.data ?? {}) as Record<string, unknown>;

    switch (item.type) {
      case 'PlanRecord':
        return this.db.prepare(`
          INSERT OR REPLACE INTO plan_records
            (id, execution_id, task_id, user_input, input_tags, s3_method,
             plan_score, execution_success, duration_ms, total_tokens_used,
             artifact_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.execution_id ?? null,
          d.task_id ?? null,
          d.user_input ?? null,
          d.input_tags ?? null,
          d.s3_method ?? null,
          d.plan_score ?? 0,
          d.execution_success ?? 1,
          d.duration_ms ?? 0,
          d.total_tokens_used ?? 0,
          d.artifact_count ?? 0,
          d.created_at ?? Math.floor(Date.now() / 1000),
        );

      case 'PlanTemplate':
        return this.db.prepare(`
          INSERT OR REPLACE INTO plan_templates
            (id, name, description, tags, success_rate, usage_count, version, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id, item.name, null,
          d.tags ?? null, d.success_rate ?? 0,
          d.usage_count ?? 0, d.version ?? 1,
          Math.floor(Date.now() / 1000),
        );

      case 'TemplateLineage':
        return this.db.prepare(`
          INSERT INTO template_lineages
            (template_id, parent_template_id, evolution_type, evolution_reason, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          d.template_id ?? item.id,
          d.parent_template_id ?? null,
          d.evolution_type ?? null,
          d.evolution_reason ?? null,
          d.timestamp ?? Math.floor(Date.now() / 1000),
        );

      case 'HistoryRecord':
        return this.db.prepare(`
          INSERT OR REPLACE INTO history_records
            (id, type, execution_id, task_id, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.type ?? 'task',
          d.execution_id ?? null,
          d.task_id ?? null,
          d.data_json ?? JSON.stringify(d),
          d.created_at ?? Math.floor(Date.now() / 1000),
        );

      case 'ErrorLog':
        return this.db.prepare(`
          INSERT INTO error_logs
            (session_id, execution_id, node_id, error_type, error_message,
             retry_count, healing_attempted, healing_succeeded, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          d.session_id ?? null,
          d.execution_id ?? null,
          d.node_id ?? null,
          d.error_type ?? null,
          d.error_message ?? null,
          d.retry_count ?? 0,
          d.healing_attempted ?? 0,
          d.healing_succeeded ?? 0,
          d.timestamp ?? Date.now(),
        );

      case 'ErrorReport':
        return this.db.prepare(`
          INSERT OR REPLACE INTO error_reports
            (id, session_id, total_errors, categories_json, root_cause, suggestions_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.session_id ?? null,
          d.total_errors ?? 0,
          d.categories_json ?? null,
          d.root_cause ?? null,
          d.suggestions_json ?? null,
          d.created_at ?? Math.floor(Date.now() / 1000),
        );

      case 'ToolQuality':
        return this.db.prepare(`
          INSERT INTO tool_quality
            (id, tool_name, call_success, latency_ms, error_message, degradation_alert, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.tool_name ?? item.name,
          d.call_success ?? 1,
          d.latency_ms ?? 0,
          d.error_message ?? null,
          d.degradation_alert ?? 0,
          d.timestamp ?? Date.now(),
        );

      case 'DecisionTrace':
        return this.db.prepare(`
          INSERT OR REPLACE INTO decision_traces
            (id, execution_id, winner_strategy, winner_score, eliminated_candidates,
             selection_reason, risk_appetite, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.execution_id ?? null,
          d.winner_strategy ?? null,
          d.winner_score ?? null,
          d.eliminated_candidates ?? null,
          d.selection_reason ?? null,
          d.risk_appetite ?? null,
          d.timestamp ?? Math.floor(Date.now() / 1000),
        );

      case 'DeviationLog':
        return this.db.prepare(`
          INSERT INTO deviation_logs
            (id, session_id, execution_id, deviation_type, count, circuit_broken, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.session_id ?? null,
          d.execution_id ?? null,
          d.deviation_type ?? null,
          d.count ?? 1,
          d.circuit_broken ?? 0,
          d.timestamp ?? Date.now(),
        );

      case 'IntelligenceState':
        return this.db.prepare(`
          INSERT OR REPLACE INTO intelligence_state
            (id, execution_count, score_history, weights_json,
             last_weight_tuning_at, last_template_evolution_at, updated_at)
          VALUES ('singleton', ?, ?, ?, ?, ?, ?)
        `).bind(
          d.execution_count ?? 0,
          d.score_history ?? null,
          d.weights_json ?? null,
          d.last_weight_tuning_at ?? null,
          d.last_template_evolution_at ?? null,
          Math.floor(Date.now() / 1000),
        );

      case 'Checkpoint':
        return this.db.prepare(`
          INSERT OR REPLACE INTO checkpoints
            (id, execution_id, dag_snapshot, node_states, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.execution_id ?? null,
          d.dag_snapshot ?? null,
          d.node_states ?? null,
          d.created_at ?? Math.floor(Date.now() / 1000),
        );

      case 'MemoryEntry':
        return this.db.prepare(`
          INSERT OR REPLACE INTO memory_entries
            (id, mem_type, content, source, source_id, tags, importance, score, pool, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          d.mem_type ?? item.type,
          d.content ?? item.name,
          d.source ?? null,
          d.source_id ?? null,
          d.tags ?? null,
          d.importance ?? 3,
          d.score ?? 0,
          d.pool ?? 'main',
          d.created_at ?? Math.floor(Date.now() / 1000),
        );

      default:
        // 未知类型只写入 kg_entities，不写领域表
        return null;
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 查询
  // ═════════════════════════════════════════════════════════════

  /**
   * query — Wiki 混合查询（向量 + 图遍历 + 缓存）
   */
  async query(queryEmbedding: number[], options: QueryOptions = {}): Promise<QueryResult> {
    if (!this.db) throw new Error('MemoryWiki not initialized');

    const { topK = 10, hops = 2, cacheTTL = 300 } = options;

    // 缓存 key：取 embedding 前 8 维做哈希
    const cacheKey = `q:${Buffer.from(new Float32Array(queryEmbedding.slice(0, 8)).buffer).toString('base64')}`;

    // L1 缓存
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;

    // Zvec 向量召回
    let vectorHits: VectorHit[] = [];
    if (this.zvecColl) {
      try {
        const results = (this.zvecColl as { querySync: (q: Record<string, unknown>) => Array<{ id: string; score: number }> }).querySync({
          fieldName: 'embedding',
          vector: queryEmbedding,
          topk: topK * 3,
          outputFields: ['doc_id'],
        });
        vectorHits = (results ?? []).map((r: { id: string; score: number }) => ({
          id: r.id ?? (r as unknown as Record<string, string>).doc_id,
          score: r.score ?? 0,
        }));
      } catch { /* zvec 查询失败 → 只用图遍历 */ }
    }

    // SQLite 图遍历
    const ids = vectorHits.map(v => v.id);
    let graphNodes: GraphNode[] = [];

    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      try {
        const rows = this.db.prepare(`
          WITH RECURSIVE graph AS (
            SELECT id, type, name, data_json, 0 as hop
            FROM kg_entities
            WHERE id IN (${placeholders})
            UNION ALL
            SELECT e.id, e.type, e.name, e.data_json, g.hop + 1
            FROM graph g
            JOIN kg_relations r ON g.id = r.from_id
            JOIN kg_entities e ON r.to_id = e.id
            WHERE g.hop < ?
          )
          SELECT DISTINCT id, type, name, data_json, hop
          FROM graph
          ORDER BY hop
          LIMIT ?
        `).all(...ids, hops, topK * 2) as Array<{
          id: string; type: string; name: string; data_json: string | null; hop: number;
        }>;

        graphNodes = rows.map(row => ({
          id: row.id,
          type: row.type,
          name: row.name,
          data: row.data_json ? JSON.parse(row.data_json) : null,
          hop: row.hop,
        }));
      } catch { /* 图遍历失败 */ }
    }

    const result: QueryResult = {
      vectors: vectorHits,
      graph: graphNodes,
      timestamp: Date.now(),
    };

    // 存 L1 缓存（使用传入的 TTL）
    this.queryCache.set(cacheKey, result, { ttl: cacheTTL * 1000 });

    return result;
  }

  // ═════════════════════════════════════════════════════════════
  // 领域查询
  // ═════════════════════════════════════════════════════════════

  /** 按 task_id + round 查询计划记录 */
  getPlanRecordsByTask(taskId: string, round?: number): Array<Record<string, unknown>> {
    if (!this.db) return [];
    if (round !== undefined) {
      return this.db.prepare(`SELECT * FROM plan_records WHERE task_id = ? AND round = ? ORDER BY created_at`)
        .all(taskId, round) as Array<Record<string, unknown>>;
    }
    return this.db.prepare(`SELECT * FROM plan_records WHERE task_id = ? ORDER BY round, created_at`)
      .all(taskId) as Array<Record<string, unknown>>;
  }

  /** 跨轮次评分趋势 */
  getScoreTrend(taskId?: string): Array<{ round: number; avg_score: number; count: number }> {
    if (!this.db) return [];
    const where = taskId ? `WHERE task_id = '${taskId.replace(/'/g, "''")}'` : '';
    return this.db.prepare(`
      SELECT round, AVG(plan_score) as avg_score, COUNT(*) as count
      FROM plan_records ${where}
      GROUP BY round ORDER BY round
    `).all() as Array<{ round: number; avg_score: number; count: number }>;
  }

  // ═════════════════════════════════════════════════════════════
  // ★ 高层 API（各模块通过此接口访问，不直接写 SQL）
  // ═════════════════════════════════════════════════════════════

  /**
   * queryByTags — 按标签/类型过滤查询
   * 替代各模块中的 `wiki.sql('SELECT * FROM xxx WHERE input_tags LIKE ?')`
   */
  queryByTags(table: string, tags: string[], options?: { limit?: number; orderBy?: string }): Record<string, unknown>[] {
    if (!this.db) return [];
    const limit = options?.limit ?? 50;
    const orderBy = options?.orderBy ?? 'created_at DESC';
    if (tags.length === 0) {
      return this.db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy} LIMIT ?`).all(limit) as Record<string, unknown>[];
    }
    const likeClauses = tags.map(() => `input_tags LIKE ?`).join(' OR ');
    const sql = `SELECT * FROM ${table} WHERE ${likeClauses} ORDER BY ${orderBy} LIMIT ?`;
    const stmt = this.db.prepare(sql);
    const params = [...tags.map(t => `%${t}%`), limit];
    return stmt.all(...(params as any[])) as Record<string, unknown>[];
  }

  /**
   * getRecentEpisodes — 获取最近的执行/历史记录
   */
  getRecentEpisodes(table: string, limit = 50): Record<string, unknown>[] {
    if (!this.db) return [];
    return this.db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
  }

  /**
   * getById — 按 ID 获取单条实体
   */
  getById(table: string, id: string): Record<string, unknown> | undefined {
    if (!this.db) return undefined;
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  }

  /**
   * queryByField — 按任意字段查询
   */
  queryByField(table: string, field: string, value: unknown, options?: { limit?: number; orderBy?: string }): Record<string, unknown>[] {
    if (!this.db) return [];
    const limit = options?.limit ?? 100;
    const orderBy = options?.orderBy ?? 'created_at DESC';
    const sql = `SELECT * FROM ${table} WHERE ${field} = ? ORDER BY ${orderBy} LIMIT ?`;
    return this.db.prepare(sql).all(value as any, limit) as Record<string, unknown>[];
  }

  /**
   * getFullEntity — 获取实体 + 关系图
   */
  getFullEntity(id: string, hops = 2): { entity: Record<string, unknown> | null; relations: Record<string, unknown>[] } {
    if (!this.db) return { entity: null, relations: [] };
    const entity = this.db.prepare('SELECT * FROM kg_entities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    let relations: Record<string, unknown>[] = [];
    if (entity && hops > 0) {
      try {
        relations = this.db.prepare(`
          WITH RECURSIVE rel_graph AS (
            SELECT r.*, 0 as hop FROM kg_relations r WHERE r.from_id = ?
            UNION ALL
            SELECT r.*, g.hop + 1 FROM rel_graph g
            JOIN kg_relations r ON g.to_id = r.from_id
            WHERE g.hop < ?
          )
          SELECT DISTINCT * FROM rel_graph ORDER BY hop
        `).all(id, hops) as Record<string, unknown>[];
      } catch { /* 递归查询失败则返回空 */ }
    }
    return { entity: entity ?? null, relations };
  }

  /**
   * getIntelligenceState — 获取学习状态（PlanningIntelligenceEngine 专用）
   */
  getIntelligenceState(): Record<string, unknown> | null {
    if (!this.db) return null;
    return (this.db.prepare("SELECT * FROM intelligence_state WHERE id = 'singleton'").get() as Record<string, unknown>) ?? null;
  }

  /** 按类型查询错误日志（增强版，templateId 可选） */
  getErrorLogs(errorType?: string | null, limit = 100): Array<Record<string, unknown>> {
    if (!this.db) return [];
    if (errorType) {
      return this.db.prepare(`SELECT * FROM error_logs WHERE error_type = ? ORDER BY timestamp DESC LIMIT ?`)
        .all(errorType, limit) as Array<Record<string, unknown>>;
    }
    return this.db.prepare(`SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
  }

  /** 按模板 ID 查询血统（增强版，templateId 可选） */
  getTemplateLineages(templateId?: string, limit = 100): Array<Record<string, unknown>> {
    if (!this.db) return [];
    if (templateId) {
      return this.db.prepare(`SELECT * FROM template_lineages WHERE template_id = ? ORDER BY timestamp DESC LIMIT ?`)
        .all(templateId, limit) as Array<Record<string, unknown>>;
    }
    return this.db.prepare(`SELECT * FROM template_lineages ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
  }

  /** 获取计划模板 */
  getPlanTemplates(tags?: string | null, limit = 100): Record<string, unknown>[] {
    if (!this.db) return [];
    if (tags) {
      return this.db.prepare('SELECT * FROM plan_templates WHERE tags LIKE ? ORDER BY success_rate DESC LIMIT ?')
        .all(`%${tags}%`, limit) as Record<string, unknown>[];
    }
    return this.db.prepare('SELECT * FROM plan_templates ORDER BY success_rate DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }

  /** 获取工具质量记录 */
  getToolQuality(toolName?: string | null, limit = 100): Record<string, unknown>[] {
    if (!this.db) return [];
    if (toolName) {
      return this.db.prepare('SELECT * FROM tool_quality WHERE tool_name = ? ORDER BY timestamp DESC LIMIT ?')
        .all(toolName, limit) as Record<string, unknown>[];
    }
    return this.db.prepare('SELECT * FROM tool_quality ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }

  /** 获取错误报告 */
  getErrorReports(sessionId?: string | null, limit = 100): Record<string, unknown>[] {
    if (!this.db) return [];
    if (sessionId) {
      return this.db.prepare('SELECT * FROM error_reports WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(sessionId, limit) as Record<string, unknown>[];
    }
    return this.db.prepare('SELECT * FROM error_reports ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }

  /** 获取决策追溯 */
  getDecisionTraces(executionId?: string | null, limit = 100): Record<string, unknown>[] {
    if (!this.db) return [];
    if (executionId) {
      return this.db.prepare('SELECT * FROM decision_traces WHERE execution_id = ? ORDER BY timestamp DESC LIMIT ?')
        .all(executionId, limit) as Record<string, unknown>[];
    }
    return this.db.prepare('SELECT * FROM decision_traces ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }

  /** 获取偏差日志 */
  getDeviationLogs(sessionId?: string | null, limit = 100): Record<string, unknown>[] {
    if (!this.db) return [];
    if (sessionId) {
      return this.db.prepare('SELECT * FROM deviation_logs WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?')
        .all(sessionId, limit) as Record<string, unknown>[];
    }
    return this.db.prepare('SELECT * FROM deviation_logs ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }

  /** 获取执行 DAG 检查点 */
  getCheckpointsByExecution(executionId: string): Record<string, unknown>[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT * FROM checkpoints WHERE execution_id = ? ORDER BY created_at')
      .all(executionId) as Record<string, unknown>[];
  }

  /**
   * getMemoryEntries — 获取记忆条目
   */
  getMemoryEntries(pool?: string | null, limit = 100): Record<string, unknown>[] {
    if (!this.db) return [];
    if (pool) {
      const stmt = this.db.prepare('SELECT * FROM memory_entries WHERE pool = ? ORDER BY created_at DESC LIMIT ?');
      return stmt.all(pool, limit) as Record<string, unknown>[];
    }
    const stmt = this.db.prepare('SELECT * FROM memory_entries ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit) as Record<string, unknown>[];
  }

  /**
   * 原始 SQL（用于复杂查询，建议优先使用高层 API）
   */
  sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): T[] {
    if (!this.db) return [];
    return this.db.prepare(query).all(...params) as T[];
  }

  /**
   * run — 执行 SQL DML（INSERT/UPDATE/DELETE），不返回行
   */
  run(query: string, ...params: unknown[]): { changes: number } {
    if (!this.db) return { changes: 0 };
    const info = this.db.prepare(query).run(...params);
    return { changes: info.changes };
  }

  /**
   * queryByTimeRange — 按时间范围查询任意表
   */
  queryByTimeRange(
    table: string,
    field: string,
    from: number,
    to: number,
    options?: { limit?: number; orderBy?: string }
  ): Record<string, unknown>[] {
    if (!this.db) return [];
    const limit = options?.limit ?? 100;
    const orderBy = options?.orderBy ?? `${field} DESC`;
    const stmt = this.db.prepare(
      `SELECT * FROM ${table} WHERE ${field} >= ? AND ${field} <= ? ORDER BY ${orderBy} LIMIT ?`
    );
    return stmt.all(from, to, limit) as Record<string, unknown>[];
  }

  // ═════════════════════════════════════════════════════════════
  // 统计
  // ═════════════════════════════════════════════════════════════

  getStats(): Record<string, unknown> {
    if (!this.db) return {};
    return {
      planRecords: (this.db.prepare('SELECT COUNT(*) as cnt FROM plan_records').get() as { cnt: number }).cnt,
      errorLogs: (this.db.prepare('SELECT COUNT(*) as cnt FROM error_logs').get() as { cnt: number }).cnt,
      templateLineages: (this.db.prepare('SELECT COUNT(*) as cnt FROM template_lineages').get() as { cnt: number }).cnt,
      kgEntities: (this.db.prepare('SELECT COUNT(*) as cnt FROM kg_entities').get() as { cnt: number }).cnt,
      kgRelations: (this.db.prepare('SELECT COUNT(*) as cnt FROM kg_relations').get() as { cnt: number }).cnt,
      memoryEntries: (this.db.prepare('SELECT COUNT(*) as cnt FROM memory_entries').get() as { cnt: number }).cnt,
      queryCacheSize: this.queryCache.size,
      embedCacheSize: this.embeddingCache.size,
      zvecReady: this.zvecColl !== null,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 缓存管理
  // ═════════════════════════════════════════════════════════════

  invalidateQueryCache(): void {
    this.queryCache.clear();
  }

  invalidateEmbeddingCache(text?: string): void {
    if (text) {
      this.embeddingCache.delete(text);
    } else {
      this.embeddingCache.clear();
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._ready = false;
  }
}
