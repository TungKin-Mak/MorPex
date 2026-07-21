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

  /**
   * @param db - better-sqlite3 Database 实例
   *             使用 new SqliteEventStore(db) 传入已打开的数据库
   */
  constructor(db: Database.Database) {
    this.db = db;
    this.dbPath = (db as any).name ?? ':memory:';
    this.initialize();
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

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private initialize(): void {
    // Set PRAGMA
    for (const stmt of PRAGMA_SQL.split(';').filter(Boolean)) {
      try { this.db.exec(stmt + ';'); } catch { /* PRAGMA may fail in constrained envs */ }
    }
    // Run schema DDL
    for (const stmt of SCHEMA_SQL.split(';').filter(Boolean)) {
      if (stmt.trim().toUpperCase().startsWith('CREATE')) {
        try { this.db.exec(stmt + ';'); } catch { /* table may already exist */ }
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
