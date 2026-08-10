/**
 * DeblackboxDetailStore — L2 详情持久化（短期、可清理）
 *
 * 去黑盒化方案的 L2 详情存储：
 *   - 正常记录：采样（默认 10%）+ TTL 30 天
 *   - 异常记录：强制全记 + TTL 365 天
 *
 * 存储策略：
 *   - 优先复用 EventStore 的 SQLite（eventStore.getDatabase()），独立表 `deblackbox_detail`，
 *     不混入主事件流（主事件流是真相源，L2 详情量大、短期，隔离避免污染 replay）。
 *   - 无 DB 时回退内存有界环形缓冲（不丢、不抛，供 bootstrap 前/测试环境使用）。
 */

import type Database from 'better-sqlite3';

/** L2 详情记录 */
export interface DeblackboxDetailRecord {
  id: string;
  category: string;
  executionId?: string;
  source: string;
  timestamp: number;
  payload: unknown;
  isError: boolean;
}

/** 内存回退最大条数 */
const MAX_MEMORY_RECORDS = 2000;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS deblackbox_detail (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    execution_id TEXT,
    source TEXT NOT NULL DEFAULT '',
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL,
    is_error INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_deblackbox_detail_category ON deblackbox_detail(category);
  CREATE INDEX IF NOT EXISTS idx_deblackbox_detail_timestamp ON deblackbox_detail(timestamp);
`;

/**
 * DeblackboxDetailStore — L2 详情存储
 */
export class DeblackboxDetailStore {
  private db: Database.Database | null = null;
  private memory: DeblackboxDetailRecord[] = [];
  private initialized = false;

  /** 挂载共享 SQLite 实例（EventStore.getDatabase() 返回的 better-sqlite3） */
  attachDatabase(db: unknown): void {
    if (db && typeof (db as Database.Database).prepare === 'function') {
      this.db = db as Database.Database;
      this.db.exec(CREATE_TABLE_SQL);
      this.initialized = true;
    }
  }

  get isPersistent(): boolean {
    return this.db !== null;
  }

  /** 追加一条详情记录（内存 + SQLite 双写；SQLite 失败仅告警不抛） */
  append(record: DeblackboxDetailRecord): void {
    // 内存回退/镜像（有界）
    this.memory.push(record);
    if (this.memory.length > MAX_MEMORY_RECORDS) {
      this.memory.shift();
    }

    if (!this.db || !this.initialized) return;
    try {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO deblackbox_detail (id, category, execution_id, source, timestamp, payload, is_error) VALUES (?,?,?,?,?,?,?)'
        )
        .run(
          record.id,
          record.category,
          record.executionId ?? null,
          record.source,
          record.timestamp,
          JSON.stringify(record.payload ?? null),
          record.isError ? 1 : 0
        );
    } catch (err) {
      console.warn('[DeblackboxDetailStore] ⚠️ L2 详情写入失败（内存镜像保留）:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 按 category 查询（SQLite 优先，回退内存） */
  queryByCategory(category: string, limit = 100): DeblackboxDetailRecord[] {
    if (this.db && this.initialized) {
      try {
        const rows = this.db
          .prepare('SELECT * FROM deblackbox_detail WHERE category = ? ORDER BY timestamp DESC LIMIT ?')
          .all(category, limit) as Array<Record<string, unknown>>;
        return rows.map(this.rowToRecord);
      } catch (err) {
        console.warn('[DeblackboxDetailStore] ⚠️ L2 详情查询失败（回退内存）:', err instanceof Error ? err.message : String(err));
      }
    }
    return this.memory.filter((r) => r.category === category).slice(0, limit);
  }

  /** 删除 timestamp 之前的记录（TTL 清理）；返回删除条数 */
  deleteBefore(timestamp: number): number {
    // 内存同步清理
    const before = this.memory.length;
    this.memory = this.memory.filter((r) => r.timestamp >= timestamp);
    const memDeleted = before - this.memory.length;

    if (!this.db || !this.initialized) return memDeleted;
    try {
      const result = this.db.prepare('DELETE FROM deblackbox_detail WHERE timestamp < ?').run(timestamp);
      return (result.changes ?? 0) + memDeleted;
    } catch (err) {
      console.warn('[DeblackboxDetailStore] ⚠️ L2 详情 TTL 清理失败:', err instanceof Error ? err.message : String(err));
      return memDeleted;
    }
  }

  /** 统计条数 */
  count(): number {
    if (this.db && this.initialized) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM deblackbox_detail').get() as { cnt: number };
        return row.cnt ?? 0;
      } catch (err) {
        console.warn('[DeblackboxDetailStore] ⚠️ L2 详情统计失败（回退内存）:', err instanceof Error ? err.message : String(err));
      }
    }
    return this.memory.length;
  }

  private rowToRecord(row: Record<string, unknown>): DeblackboxDetailRecord {
    let payload: unknown = null;
    try {
      payload = JSON.parse(String(row.payload ?? 'null'));
    } catch {
      payload = row.payload ?? null;
    }
    return {
      id: String(row.id),
      category: String(row.category),
      executionId: row.execution_id ? String(row.execution_id) : undefined,
      source: String(row.source ?? ''),
      timestamp: Number(row.timestamp),
      payload,
      isError: Number(row.is_error) === 1,
    };
  }
}
