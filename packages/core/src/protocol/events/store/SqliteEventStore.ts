/**
 * SqliteEventStore — SQLite 后端事件存储
 *
 * v9.2 Stage 0: 替代 JSONL 事件存储，提供：
 *   - WAL 模式（并发读安全）
 *   - 事务批量写入
 *   - 时序索引（sequence + timestamp）
 *   - aggregateId 索引（领域/聚合溯源）
 *
 * 表结构:
 *   events           — 主事件表 (BaseEvent)
 *   events_decision  — 决策事件表 (DecisionEvent)
 *   schema_migrations — 迁移版本跟踪
 *
 * 使用方式:
 *   // 依赖注入方式（推荐）
 *   import Database from 'better-sqlite3';
 *   const db = new Database(':memory:');
 *   const store = new SqliteEventStore(db);
 *
 *   // 工厂方式
 *   const store = createSqliteEventStore(':memory:');
 *
 *   await store.append(baseEvent);
 *   const results = await store.query({ executionId: 'mis_123' });
 */

import type Database from 'better-sqlite3';
import type { BaseEvent } from '../BaseEvent.js';
import type { DecisionEvent } from '../DecisionEvent.js';
import type { EventQueryFilter, EventStoreStats, IEventStore } from './IEventStore.js';
import { CompactionService } from '../../../observability/CompactionService.js';
import type { CompactionConfig } from '../../../observability/CompactionService.js';

// ── Schema DDL ──

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    execution_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    aggregate_id TEXT,
    version INTEGER DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
  CREATE INDEX IF NOT EXISTS idx_events_execution ON events(execution_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_id);

  CREATE TABLE IF NOT EXISTS events_decision (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    execution_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    input TEXT NOT NULL DEFAULT '{}',
    reasoning TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '[]',
    decision TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    twin_version INTEGER NOT NULL DEFAULT 0,
    metadata TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_decisions_sequence ON events_decision(sequence);
  CREATE INDEX IF NOT EXISTS idx_decisions_execution ON events_decision(execution_id);
  CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON events_decision(timestamp);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
    description TEXT
  );

  -- ═══ v9.1: Context Assembly ═══
  CREATE TABLE IF NOT EXISTS context_snapshots (
    context_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    mission_id TEXT NOT NULL,
    schema_version TEXT NOT NULL DEFAULT '1.0',
    base_data TEXT NOT NULL DEFAULT '{}',
    session_data TEXT NOT NULL DEFAULT '{}',
    ephemeral_data TEXT NOT NULL DEFAULT '{}',
    fragments_json TEXT NOT NULL DEFAULT '[]',
    change_description TEXT,
    assembled_at INTEGER NOT NULL,
    PRIMARY KEY (context_id, version)
  );
  CREATE INDEX IF NOT EXISTS idx_cs_mission ON context_snapshots(mission_id);

  -- ═══ v9.1: Artifact Plane ═══
  CREATE TABLE IF NOT EXISTS artifacts_v2 (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    content TEXT,
    content_hash TEXT,
    created_by TEXT,
    source TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_artifacts_v2_type ON artifacts_v2(type);
  CREATE INDEX IF NOT EXISTS idx_artifacts_v2_status ON artifacts_v2(status);

  CREATE TABLE IF NOT EXISTS artifact_versions_v2 (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT,
    content_hash TEXT,
    change_log TEXT,
    staged_by TEXT,
    verified_at INTEGER,
    committed_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_av_v2_artifact ON artifact_versions_v2(artifact_id, version);

  CREATE TABLE IF NOT EXISTS artifact_dependencies_v2 (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'depends_on',
    weight REAL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id, relation_type)
  );

  CREATE TABLE IF NOT EXISTS artifact_staging_v2 (
    stage_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    new_content TEXT,
    new_content_hash TEXT,
    staged_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'staged',
    staged_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  -- ═══ v9.1: Agent Governance ═══
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INTEGER NOT NULL DEFAULT 1,
    memory_scope TEXT,
    permission_scope TEXT,
    trust_level REAL DEFAULT 0.5,
    max_risk_level TEXT DEFAULT 'medium',
    require_approval_for_collab INTEGER DEFAULT 0,
    organization_tag TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    last_active_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role);
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

  CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id TEXT NOT NULL,
    capability_name TEXT NOT NULL,
    level INTEGER DEFAULT 3,
    success_rate REAL DEFAULT 1.0,
    cost REAL DEFAULT 0.5,
    last_used_at INTEGER,
    PRIMARY KEY (agent_id, capability_name)
  );

  CREATE TABLE IF NOT EXISTS agent_governance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    decision TEXT,
    reason TEXT,
    details_json TEXT DEFAULT '{}',
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agl_agent ON agent_governance_log(agent_id);

  CREATE TABLE IF NOT EXISTS agent_collaborations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    collaborator_id TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'unknown',
    mission_id TEXT,
    duration_ms INTEGER,
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ac_agent ON agent_collaborations(agent_id);

  -- ═══ v9.2: Cross-Agent Learning ═══
  CREATE TABLE IF NOT EXISTS shared_experiences (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, problem_pattern TEXT NOT NULL,
    solution TEXT NOT NULL, success_rate REAL DEFAULT 0, avg_latency REAL DEFAULT 0,
    cost_savings REAL DEFAULT 0, source_agent_type TEXT, source_mission_ids TEXT,
    positive_feedback INTEGER DEFAULT 0, negative_feedback INTEGER DEFAULT 0,
    weight REAL DEFAULT 0, tags TEXT, visible_to TEXT, created_at INTEGER NOT NULL,
    last_validated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_se_category ON shared_experiences(category);
  CREATE INDEX IF NOT EXISTS idx_se_weight ON shared_experiences(weight);

  -- ═══ v9.2: Organization Governance ═══
  CREATE TABLE IF NOT EXISTS org_policies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, priority INTEGER DEFAULT 0,
    action TEXT NOT NULL, rule_condition TEXT, override_by TEXT,
    enabled INTEGER DEFAULT 1, created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_governance (
    team_id TEXT PRIMARY KEY, team_name TEXT NOT NULL, member_roles TEXT,
    max_concurrent_collabs INTEGER DEFAULT 5, budget_allocation REAL DEFAULT 0,
    allow_external INTEGER DEFAULT 0, require_approval INTEGER DEFAULT 0,
    escalation_path TEXT, created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_memberships (
    agent_id TEXT NOT NULL, team_id TEXT NOT NULL, team_role TEXT DEFAULT \'member\',
    permissions TEXT, joined_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, team_id)
  );

  CREATE TABLE IF NOT EXISTS org_budget (
    id TEXT PRIMARY KEY DEFAULT \'singleton\', total_budget REAL DEFAULT 1000000,
    allocated REAL DEFAULT 0, reserved REAL DEFAULT 0, updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budget_allocations (
    team_id TEXT PRIMARY KEY, allocated REAL NOT NULL, spent REAL DEFAULT 0,
    last_updated INTEGER NOT NULL
  );

  -- ═══ v9.2: Agent Marketplace ═══
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, capability TEXT NOT NULL,
    price_per_task REAL DEFAULT 0, availability INTEGER DEFAULT 1,
    reputation REAL DEFAULT 0, total_tasks INTEGER DEFAULT 0, success_rate REAL DEFAULT 1,
    metadata_json TEXT DEFAULT \'{}\', listed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS marketplace_bids (
    id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, bidder_id TEXT NOT NULL,
    price REAL NOT NULL, estimated_duration INTEGER, confidence REAL DEFAULT 0.5,
    status TEXT DEFAULT \'pending\', created_at INTEGER NOT NULL,
    awarded_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS marketplace_contracts (
    id TEXT PRIMARY KEY, bid_id TEXT, provider_id TEXT NOT NULL,
    consumer_id TEXT NOT NULL, capability TEXT NOT NULL, price REAL NOT NULL,
    status TEXT DEFAULT \'active\', terms_json TEXT DEFAULT \'{}\',
    created_at INTEGER NOT NULL, completed_at INTEGER
  );

  -- ═══ v9.2: Distributed Runtime ═══
  CREATE TABLE IF NOT EXISTS agent_instances (
    node_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT DEFAULT \'online\',
    last_heartbeat INTEGER NOT NULL, address TEXT, capabilities_json TEXT DEFAULT \'[]\',
    load REAL DEFAULT 0, PRIMARY KEY (node_id, agent_id)
  );

  CREATE TABLE IF NOT EXISTS remote_messages (
    id TEXT PRIMARY KEY, from_node TEXT NOT NULL, to_node TEXT NOT NULL,
    correlation_id TEXT, type TEXT NOT NULL, payload TEXT DEFAULT \'{}\',
    status TEXT DEFAULT \'sent\', sent_at INTEGER NOT NULL, received_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_rm_correlation ON remote_messages(correlation_id);

  -- ═══ v9.2: Team Formation ═══
  CREATE TABLE IF NOT EXISTS agent_teams (
    team_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, status TEXT DEFAULT \'forming\',
    leader_id TEXT, composition_json TEXT DEFAULT \'{}\', context_json TEXT DEFAULT \'{}\',
    formed_at INTEGER NOT NULL, dissolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_at_mission ON agent_teams(mission_id);

  -- ═══ v9.2: Shared Memory Consensus ═══
  CREATE TABLE IF NOT EXISTS shared_memory_entries (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER DEFAULT 1,
    lock_owner TEXT, lock_expires_at INTEGER, consensus_version INTEGER DEFAULT 1,
    created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sme_lock ON shared_memory_entries(lock_owner);

  -- ═══ v9.2+ Performance: Composite Indexes ═══
  CREATE INDEX IF NOT EXISTS idx_events_mission_seq ON events(execution_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, timestamp);
  CREATE INDEX IF NOT EXISTS idx_context_snapshots_mission_ver ON context_snapshots(mission_id, version);
  CREATE INDEX IF NOT EXISTS idx_artifacts_v2_type_status ON artifacts_v2(type, status);
  CREATE INDEX IF NOT EXISTS idx_shared_memory_key_version ON shared_memory_entries(key, version);
`;

const PRAGMA_SQL = `
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  PRAGMA cache_size=-64000;
  PRAGMA busy_timeout=5000;
  PRAGMA foreign_keys=ON;
`;

// ── SqliteEventStore ──

export class SqliteEventStore implements IEventStore {
  private db: Database.Database;
  private dbPath: string;
  private sequenceCounter: number = 0;
  private compactionTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param db - better-sqlite3 Database 实例
   *             使用 new SqliteEventStore(db) 传入已打开的数据库
   */
  constructor(db: Database.Database) {
    this.db = db;
    this.dbPath = (db as any).name ?? ':memory:';
    this.initialize();
  }

  /**
   * enableAutoCompaction — 启动自动 Compaction
   * 定时触发 CompactionService，清理旧数据和 VACUUM。
   * @param intervalMs - 运行间隔（默认 12 小时）
   */
  enableAutoCompaction(intervalMs: number = 12 * 60 * 60 * 1000): void {
    if (this.compactionTimer) clearInterval(this.compactionTimer)
    this.compactionTimer = setInterval(async () => {
      try {
        const { CompactionService } = await import('../../../observability/CompactionService.js')
        const svc = new CompactionService(this.db as any)
        const result = await svc.compact()
        if (result.eventsPruned > 0 || result.vacuumed) {
          console.log(`[SqliteEventStore] Auto-compaction: pruned ${result.eventsPruned} events, ${result.snapshotsPruned} snapshots, vacuum=${result.vacuumed}, duration=${result.durationMs}ms`)
        }
      } catch (err: any) {
        console.warn('[SqliteEventStore] Auto-compaction failed:', err.message)
      }
    }, intervalMs)
    console.log(`[SqliteEventStore] Auto-compaction 已启用，间隔 ${Math.round(intervalMs / 60000)} 分钟`)
  }

  /**
   * disableAutoCompaction — 停止自动 Compaction
   */
  disableAutoCompaction(): void {
    if (this.compactionTimer) {
      clearInterval(this.compactionTimer)
      this.compactionTimer = null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // IEventStore 实现
  // ═══════════════════════════════════════════════════════════════

  async append(event: BaseEvent): Promise<void> {
    const sequence = this.nextSequence();
    const payload = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload);

    this.db.prepare(`
      INSERT INTO events (id, sequence, type, timestamp, execution_id, source, payload, aggregate_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      sequence,
      event.type,
      event.timestamp,
      event.executionId,
      event.source ?? '',
      payload,
      (event as any).aggregateId ?? null,
      (event as any).version ?? 1
    );
  }

  async appendBatch(events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return;

    const insert = this.db.transaction(() => {
      for (const event of events) {
        const sequence = this.nextSequence();
        const payload = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload);

        this.db.prepare(`
          INSERT INTO events (id, sequence, type, timestamp, execution_id, source, payload, aggregate_id, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id,
          sequence,
          event.type,
          event.timestamp,
          event.executionId,
          event.source ?? '',
          payload,
          (event as any).aggregateId ?? null,
          (event as any).version ?? 1
        );
      }
    });

    insert();
  }

  async appendDecision(decision: DecisionEvent): Promise<void> {
    const sequence = this.nextSequence();

    this.db.prepare(`
      INSERT INTO events_decision (id, sequence, timestamp, execution_id, source, input, reasoning, evidence, decision, confidence, twin_version, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.id,
      sequence,
      decision.timestamp,
      decision.executionId,
      decision.source ?? '',
      JSON.stringify(decision.input ?? {}),
      decision.reasoning ?? '',
      JSON.stringify(decision.evidence ?? []),
      decision.decision ?? '',
      decision.confidence ?? 0,
      decision.twinVersion ?? 0,
      JSON.stringify(decision.metadata ?? {})
    );
  }

  async query(filter: EventQueryFilter): Promise<BaseEvent[]> {
    const { conditions, params } = this.buildWhereClause(filter);
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM events ${conditions} ORDER BY sequence DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToEvent);
  }

  async queryDecisions(filter: EventQueryFilter): Promise<DecisionEvent[]> {
    const { conditions, params } = this.buildDecisionWhereClause(filter);
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM events_decision ${conditions} ORDER BY sequence DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToDecision);
  }

  async *replay(fromSequence?: number): AsyncIterable<BaseEvent> {
    const seq = fromSequence ?? 0;
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE sequence > ? ORDER BY sequence'
    ).all(seq) as any[];

    for (const row of rows) {
      yield this.rowToEvent(row);
    }
  }

  async getLatestSequence(): Promise<number> {
    const row = this.db.prepare('SELECT MAX(sequence) as max_seq FROM events').get() as any;
    return row?.max_seq ?? 0;
  }

  async getStats(): Promise<EventStoreStats> {
    const eventCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM events').get() as any).cnt;
    const decisionCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM events_decision').get() as any).cnt;

    const typeRows = this.db.prepare('SELECT type, COUNT(*) as cnt FROM events GROUP BY type').all() as any[];
    const byType: Record<string, number> = {};
    for (const r of typeRows) {
      byType[r.type] = r.cnt;
    }

    const latestSequence = await this.getLatestSequence();

    let dbSizeBytes = 0;
    if (this.dbPath !== ':memory:' && this.dbPath) {
      try {
        const fs = await import('node:fs');
        dbSizeBytes = fs.statSync(this.dbPath).size;
      } catch {
        // ignore
      }
    }

    return { totalEvents: eventCount, totalDecisions: decisionCount, byType, latestSequence, dbSizeBytes };
  }

  async clear(): Promise<void> {
    this.db.exec('DELETE FROM events');
    this.db.exec('DELETE FROM events_decision');
    this.sequenceCounter = 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * getDatabase — 获取内部 better-sqlite3 实例
   *
   * 供 ContextPersistence / ArtifactSqliteRepository / AgentGovernanceRepository
   * 等模块复用同一数据库连接。
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private initialize(): void {
    // Set PRAGMA
    for (const stmt of PRAGMA_SQL.split(';').filter(Boolean)) {
      try { this.db.exec(stmt + ';'); } catch { /* PRAGMA may fail in constrained envs */ }
    }
    // Run schema DDL — strip SQL comments (-- to end of line) before checking
    for (const stmt of SCHEMA_SQL.split(';').filter(Boolean)) {
      // Strip SQL inline comments so 'CREATE' detection works
      const cleaned = stmt.replace(/\s*--.*$/gm, '').trim();
      if (cleaned.toUpperCase().startsWith('CREATE') || cleaned.toUpperCase().startsWith('PRAGMA')) {
        try { this.db.exec(stmt + ';'); } catch { /* table may already exist — skip */ }
      }
    }

    // Initialize sequence counter from existing data
    const row = this.db.prepare('SELECT MAX(sequence) as max_seq FROM events').get() as any;
    this.sequenceCounter = row?.max_seq ?? 0;
  }

  private nextSequence(): number {
    return ++this.sequenceCounter;
  }

  private buildWhereClause(filter: EventQueryFilter): { conditions: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    if (filter.executionId) { clauses.push('execution_id = ?'); params.push(filter.executionId); }
    if (filter.type) { clauses.push('type = ?'); params.push(filter.type); }
    if (filter.source) { clauses.push('source = ?'); params.push(filter.source); }
    if (filter.since !== undefined) { clauses.push('timestamp >= ?'); params.push(filter.since); }
    if (filter.until !== undefined) { clauses.push('timestamp <= ?'); params.push(filter.until); }
    if (filter.aggregateId) { clauses.push('aggregate_id = ?'); params.push(filter.aggregateId); }

    return {
      conditions: clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '',
      params,
    };
  }

  private buildDecisionWhereClause(filter: EventQueryFilter): { conditions: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    if (filter.executionId) { clauses.push('execution_id = ?'); params.push(filter.executionId); }
    if (filter.source) { clauses.push('source = ?'); params.push(filter.source); }
    if (filter.since !== undefined) { clauses.push('timestamp >= ?'); params.push(filter.since); }
    if (filter.until !== undefined) { clauses.push('timestamp <= ?'); params.push(filter.until); }

    return {
      conditions: clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '',
      params,
    };
  }

  private rowToEvent(row: any): BaseEvent {
    return {
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      executionId: row.execution_id,
      source: row.source,
      payload: JSON.parse(row.payload ?? '{}'),
      ...(row.aggregate_id ? { aggregateId: row.aggregate_id } : {}),
      ...(row.version ? { version: row.version } : {}),
    };
  }

  private rowToDecision(row: any): DecisionEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      executionId: row.execution_id,
      source: row.source,
      input: JSON.parse(row.input ?? '{}'),
      reasoning: row.reasoning ?? '',
      evidence: JSON.parse(row.evidence ?? '[]'),
      decision: row.decision ?? '',
      confidence: row.confidence ?? 0,
      twinVersion: row.twin_version ?? 0,
      metadata: JSON.parse(row.metadata ?? '{}'),
    };
  }

  /**
   * getCompactionService — 获取数据库压缩维护服务
   */
  getCompactionService(config?: Partial<CompactionConfig>): CompactionService {
    return new CompactionService(this.db, config);
  }
}

// ═══════════════════════════════════════════════════════════════
// 工厂函数（处理 better-sqlite3 加载，用于非 DI 场景）
// ═══════════════════════════════════════════════════════════════

/**
 * createSqliteEventStore — 创建 SqliteEventStore 实例
 *
 * 处理 better-sqlite3 的 CJS 模块加载
 * （better-sqlite3 是 CJS native 模块，不能使用 ESM import）
 *
 * @param dbPath - 数据库路径，默认 './data/morpex-events.db'
 * @returns SqliteEventStore 实例
 */
// Lazy-load better-sqlite3 — it's a CJS native module that can't be ESM-imported
let _dbModule: any = null;
async function _getBetterSqlite3(): Promise<any> {
  if (!_dbModule) {
    const { createRequire } = await import('node:module');
    const req = createRequire(process.cwd() + '/package.json');
    const Database = req('better-sqlite3');
    _dbModule = (Database as any).default ?? Database;
  }
  return _dbModule;
}

/**
 * createSqliteEventStore — 创建 SqliteEventStore 实例（异步）
 *
 * 处理 better-sqlite3 的 CJS 模块加载。
 * better-sqlite3 是 CJS native 模块，不能使用 ESM import。
 *
 * @param dbPath - 数据库路径，默认 './data/morpex-events.db'
 * @returns SqliteEventStore 实例
 */
export async function createSqliteEventStore(dbPath?: string): Promise<SqliteEventStore> {
  const DB = await _getBetterSqlite3();
  const resolvedPath = dbPath ?? './data/morpex-events.db';
  const db = new DB(resolvedPath);
  return new SqliteEventStore(db);
}
