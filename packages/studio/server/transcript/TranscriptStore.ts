/**
 * TranscriptStore — 单一 Transcript 架构的 SQLite 读模型（T1）
 *
 * ★ 存储总原则（docs/SINGLE_TRANSCRIPT_DESIGN.md §3.2 存储总原则）：
 *   正文唯一存在 jsonl 账本里；本库只存"坐标"（byte_offset/byte_length）+ 元数据（kind/role/preview）。
 *   读一条记录 = 按 offset seek jsonl 一次，空间开销约 0.05×。
 *
 * 表：
 *   transcript_windows  会话窗口目录（session_key 唯一路由锚点；file_path 定位账本文件）
 *   transcript_events   追加式事件索引（指针式，主键 (session_id, seq) 保序幂等）
 *   chat_index          UI 会话列表速查（O(1) 替代目录扫描）
 *   index_watermark     抄写员水位（indexed_bytes + last_seq；偏离说明见 FILE_REGISTRY）
 *
 * 铁律对齐：本文件不 import @earendil-works/*（PiBridge 隔离）；better-sqlite3 同步 API（单进程）。
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TranscriptWindowRow {
  session_id: string;
  session_key: string;
  file_path: string;
  previous_session_id: string | null;
  reason: string | null;
  status: string;
  display_name: string | null;
  component: string | null;
  parent_session_id: string | null;
  model_provider: string | null;
  created_at: number;
  updated_at: number;
}

export interface TranscriptEventRow {
  session_id: string;
  seq: number;
  byte_offset: number;
  byte_length: number;
  kind: string;
  role: string | null;
  preview: string | null;
  created_at: number;
}

export interface WatermarkRow {
  session_id: string;
  indexed_bytes: number;
  last_seq: number;
  updated_at: number;
}

const REASONS = ['initial', 'reset', 'fork', 'rewind', 'compaction'] as const;
const STATUSES = ['active', 'archived'] as const;

export class TranscriptStore {
  private db: Database.Database;
  /** prepared statement 缓存（better-sqlite3 不自动缓存；热路径免重复解析） */
  private stmts = new Map<string, Database.Statement>();

  private stmt(sql: string): Database.Statement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcript_windows (
        session_id          TEXT PRIMARY KEY,
        session_key         TEXT NOT NULL UNIQUE,
        file_path           TEXT NOT NULL,
        previous_session_id TEXT,
        reason              TEXT CHECK (reason IS NULL OR reason IN ('initial','reset','fork','rewind','compaction')),
        status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        display_name        TEXT,
        component           TEXT,
        parent_session_id   TEXT,
        model_provider      TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS transcript_events (
        session_id   TEXT NOT NULL REFERENCES transcript_windows(session_id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        byte_offset  INTEGER NOT NULL,
        byte_length  INTEGER NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'internal',
        role         TEXT,
        preview      TEXT,
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_events_kind ON transcript_events(session_id, kind, seq);

      CREATE TABLE IF NOT EXISTS chat_index (
        chat_session_id TEXT PRIMARY KEY,
        last_seq        INTEGER NOT NULL,
        last_role       TEXT,
        preview         TEXT,
        message_count   INTEGER NOT NULL DEFAULT 0,
        mission_ids     TEXT,
        updated_at      INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS index_watermark (
        session_id    TEXT PRIMARY KEY,
        indexed_bytes INTEGER NOT NULL DEFAULT 0,
        last_seq      INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      ) STRICT;
    `);
  }

  // ── windows ──

  findWindowByKey(sessionKey: string): TranscriptWindowRow | undefined {
    return this.stmt('SELECT * FROM transcript_windows WHERE session_key = ?')
      .get(sessionKey) as TranscriptWindowRow | undefined;
  }

  findWindowById(sessionId: string): TranscriptWindowRow | undefined {
    return this.stmt('SELECT * FROM transcript_windows WHERE session_id = ?')
      .get(sessionId) as TranscriptWindowRow | undefined;
  }

  /** T1 parent 链：按 jsonl 路径反查窗口（父会话未携带 id 时的兑底） */
  findWindowByFilePath(filePath: string): TranscriptWindowRow | undefined {
    return this.stmt('SELECT * FROM transcript_windows WHERE file_path = ?')
      .get(filePath) as TranscriptWindowRow | undefined;
  }

  upsertWindow(w: {
    session_id: string;
    session_key: string;
    file_path: string;
    component?: string;
    parent_session_id?: string | null;
    reason?: (typeof REASONS)[number] | null;
    display_name?: string | null;
  }): void {
    const now = Date.now();
    this.stmt(
        `INSERT INTO transcript_windows
           (session_id, session_key, file_path, previous_session_id, reason, status, display_name, component, parent_session_id, model_provider, created_at, updated_at)
         VALUES (@session_id, @session_key, @file_path, @previous_session_id, @reason, 'active', @display_name, @component, @parent_session_id, NULL, @now, @now)
         ON CONFLICT(session_id) DO UPDATE SET
           file_path = excluded.file_path,
           component = COALESCE(excluded.component, transcript_windows.component),
           parent_session_id = COALESCE(excluded.parent_session_id, transcript_windows.parent_session_id),
           updated_at = excluded.updated_at`,
      )
      .run({
        session_id: w.session_id,
        session_key: w.session_key,
        file_path: w.file_path,
        previous_session_id: null,
        reason: w.reason ?? 'initial',
        display_name: w.display_name ?? null,
        component: w.component ?? null,
        parent_session_id: w.parent_session_id ?? null,
        now,
      });
  }

  listWindows(opts?: { status?: (typeof STATUSES)[number]; limit?: number }): TranscriptWindowRow[] {
    const sql =
      opts?.status
        ? 'SELECT * FROM transcript_windows WHERE status = ? ORDER BY updated_at DESC LIMIT ?'
        : 'SELECT * FROM transcript_windows ORDER BY updated_at DESC LIMIT ?';
    return (
      opts?.status
        ? this.stmt(sql).all(opts.status, opts.limit ?? 200)
        : this.stmt(sql).all(opts?.limit ?? 200)
    ) as TranscriptWindowRow[];
  }

  // ── events ──

  insertEventIgnore(e: Omit<TranscriptEventRow, 'created_at'>): boolean {
    const r = this.stmt(
        `INSERT OR IGNORE INTO transcript_events (session_id, seq, byte_offset, byte_length, kind, role, preview, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.session_id, e.seq, e.byte_offset, e.byte_length, e.kind, e.role, e.preview, Date.now());
    return Number(r.changes) > 0;
  }

  deleteEvents(sessionId: string): void {
    this.stmt('DELETE FROM transcript_events WHERE session_id = ?').run(sessionId);
  }

  countEvents(sessionId: string): number {
    const r = this.stmt('SELECT COUNT(*) AS c FROM transcript_events WHERE session_id = ?').get(sessionId) as { c: number };
    return Number(r.c);
  }

  eventsBySession(sessionId: string, afterSeq = 0, limit = 500): TranscriptEventRow[] {
    return this.stmt('SELECT * FROM transcript_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(sessionId, afterSeq, limit) as TranscriptEventRow[];
  }

  // ── watermark ──

  getWatermark(sessionId: string): WatermarkRow | undefined {
    return this.stmt('SELECT * FROM index_watermark WHERE session_id = ?').get(sessionId) as WatermarkRow | undefined;
  }

  setWatermark(sessionId: string, indexedBytes: number, lastSeq: number): void {
    this.stmt(
        `INSERT INTO index_watermark (session_id, indexed_bytes, last_seq, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET indexed_bytes = excluded.indexed_bytes, last_seq = excluded.last_seq, updated_at = excluded.updated_at`,
      )
      .run(sessionId, indexedBytes, lastSeq, Date.now());
  }

  clearWatermark(sessionId: string): void {
    this.stmt('DELETE FROM index_watermark WHERE session_id = ?').run(sessionId);
  }

  // ── chat_index（T2：会话列表速查，O(1) 替代目录扫描）──

  upsertChatIndex(row: { chat_session_id: string; last_seq: number; last_role: string | null; preview: string | null; updated_at: number }): void {
    this.stmt(
        `INSERT INTO chat_index (chat_session_id, last_seq, last_role, preview, message_count, updated_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(chat_session_id) DO UPDATE SET
           last_seq = excluded.last_seq, last_role = excluded.last_role,
           preview = excluded.preview, message_count = chat_index.message_count + 1,
           updated_at = excluded.updated_at`,
      )
      .run(row.chat_session_id, row.last_seq, row.last_role, row.preview, row.updated_at);
  }

  listChatIndex(limit = 200): Array<{ chat_session_id: string; preview: string | null; message_count: number; updated_at: number }> {
    return this.stmt('SELECT chat_session_id, preview, message_count, updated_at FROM chat_index ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<{ chat_session_id: string; preview: string | null; message_count: number; updated_at: number }>;
  }

  /** 批量写事务包裹（WAL 下逐条隐式事务代价高；批量原子提交，失败整体回滚——水位不前进、下次重抄，幂等） */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
