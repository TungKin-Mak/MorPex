/**
 * AgentMessageStore — 跨 agent 留言表（T3 组织通信原语②，docs/SINGLE_TRANSCRIPT_DESIGN.md §3.2/§4.5）
 *
 * "公司层"存储：不属于任何一本账；留言本体只在此表一份，双方账本各写存根 custom_message
 * （由调用方 sendMessage 实现负责）。独立 Database 连接打开同一个 transcript.db（WAL 多连接安全）。
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AgentMessageRow {
  id: string;
  from_session: string;
  to_session: string;
  body: string;
  created_at: number;
  read_at: number | null;
}

export class AgentMessageStore {
  private db: Database.Database;
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id           TEXT PRIMARY KEY,
        from_session TEXT NOT NULL REFERENCES transcript_windows(session_id),
        to_session   TEXT NOT NULL REFERENCES transcript_windows(session_id),
        body         TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        read_at      INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_messages_to ON agent_messages(to_session, read_at);
    `);
  }

  insert(m: { id: string; from_session: string; to_session: string; body: string }): void {
    this.stmt('INSERT INTO agent_messages (id, from_session, to_session, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(m.id, m.from_session, m.to_session, m.body, Date.now());
  }

  listUnread(toSessionId: string): AgentMessageRow[] {
    return this.stmt('SELECT * FROM agent_messages WHERE to_session = ? AND read_at IS NULL ORDER BY created_at ASC')
      .all(toSessionId) as unknown as AgentMessageRow[];
  }

  markRead(ids: string[]): number {
    let n = 0;
    const upd = this.stmt('UPDATE agent_messages SET read_at = ? WHERE id = ? AND read_at IS NULL');
    for (const id of ids) n += Number(upd.run(Date.now(), id).changes);
    return n;
  }

  close(): void {
    this.db.close();
  }
}
