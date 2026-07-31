/**
 * confirmation/queue — 确认队列（SQLite）
 *
 * 人工在环的唯一入口：低置信 / 冲突 / 新实体候选先进这里，
 * Agent 主动询问用户 → accept 写权威层 / reject 丢弃。
 * 低耦合：只依赖 better-sqlite3 与 memory-types 契约。
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConfirmTicket, ConfirmDecision } from '../memory-types.js';

interface ConfirmRow {
  ticket_id: string;
  content: string;
  confidence: number;
  reason: string;
  scope: string;
  metadata: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  decided_at: string | null;
}

export class ConfirmationQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS confirmation_queue (
        ticket_id  TEXT PRIMARY KEY,
        content    TEXT NOT NULL,
        confidence REAL NOT NULL,
        reason     TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'company',
        metadata   TEXT,
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cq_status ON confirmation_queue(status, created_at);

      CREATE TABLE IF NOT EXISTS invalidate_log (
        id           TEXT PRIMARY KEY,
        entity_name  TEXT NOT NULL,
        valid_until  TEXT,
        reason       TEXT,
        created_at   TEXT NOT NULL
      );
    `);
  }

  enqueue(input: {
    content: string;
    confidence: number;
    reason: ConfirmTicket['reason'];
    scope?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        `INSERT INTO confirmation_queue (ticket_id, content, confidence, reason, scope, metadata, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, input.content, input.confidence, input.reason, input.scope ?? 'company',
        JSON.stringify(input.metadata ?? {}), new Date().toISOString());
    return id;
  }

  listPending(limit = 20): ConfirmTicket[] {
    const rows = this.db
      .prepare('SELECT * FROM confirmation_queue WHERE status = ? ORDER BY created_at ASC LIMIT ?')
      .all('pending', limit) as unknown as ConfirmRow[];
    return rows.map((r) => ({
      ticketId: r.ticket_id,
      content: r.content,
      confidence: r.confidence,
      reason: r.reason as ConfirmTicket['reason'],
      scope: r.scope,
      metadata: JSON.parse(r.metadata ?? '{}'),
      createdAt: r.created_at,
    }));
  }

  resolve(ticketId: string, decision: ConfirmDecision): boolean {
    const status = decision === 'accept' ? 'accepted' : 'rejected';
    const info = this.db
      .prepare('UPDATE confirmation_queue SET status = ?, decided_at = ? WHERE ticket_id = ? AND status = ?')
      .run(status, new Date().toISOString(), ticketId, 'pending');
    return info.changes > 0;
  }

  get(ticketId: string): ConfirmTicket | undefined {
    const r = this.db.prepare('SELECT * FROM confirmation_queue WHERE ticket_id = ?').get(ticketId) as
      | ConfirmRow
      | undefined;
    if (!r) return undefined;
    return {
      ticketId: r.ticket_id,
      content: r.content,
      confidence: r.confidence,
      reason: r.reason as ConfirmTicket['reason'],
      scope: r.scope,
      metadata: JSON.parse(r.metadata ?? '{}'),
      createdAt: r.created_at,
    };
  }

  // ── 双时间失效登记（过时事实保留图历史，本地登记失效供审计）──

  logInvalidate(entityName: string, validUntil?: string, reason?: string): string {
    const id = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.db
      .prepare(
        `INSERT INTO invalidate_log (id, entity_name, valid_until, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, entityName, validUntil ?? null, reason ?? 'user', new Date().toISOString());
    return id;
  }

  listInvalidations(limit = 50): Array<{ id: string; entityName: string; validUntil: string | null; reason: string; createdAt: string }> {
    const rows = this.db
      .prepare('SELECT * FROM invalidate_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      entityName: String(r.entity_name),
      validUntil: r.valid_until as string | null,
      reason: String(r.reason),
      createdAt: String(r.created_at),
    }));
  }

  /** 清理超期 pending（decayTick 用）：超过 maxAgeDays 的 pending 归档为 rejected */
  expirePending(maxAgeDays: number): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString();
    const info = this.db
      .prepare("UPDATE confirmation_queue SET status = 'rejected', decided_at = ? WHERE status = 'pending' AND created_at < ?")
      .run(new Date().toISOString(), cutoff);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}
