/**
 * MigrationRunner — SQLite 迁移运行器
 *
 * v9.2 Stage 2: 基于 schema_migrations 表的版本化迁移。
 *
 * 使用方式:
 *   const runner = new MigrationRunner(db);
 *   const applied = runner.run(MIGRATIONS);
 *   console.log(`Applied ${applied} migrations`);
 */

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  description: string;
  /** SQL statements (may contain multiple statements separated by semicolons) */
  sql: string;
}

export class MigrationRunner {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * run — 执行所有待迁移
   * @returns 实际执行的迁移数量
   */
  run(migrations: Migration[]): number {
    return this.db.transaction(() => {
      // 确保迁移表存在
      this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
        description TEXT
      )`);

      // 获取当前版本
      const current = this.db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
      const currentVersion = current?.v ?? 0;

      // 排序并过滤待执行的迁移
      const pending = migrations
        .filter(m => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);

      for (const m of pending) {
        try {
          this.db.exec(m.sql);
          this.db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)').run(m.version, m.description);
        } catch (err) {
          console.error(`[MigrationRunner] Migration v${m.version} "${m.description}" failed:`, err);
          throw err;
        }
      }

      return pending.length;
    })();
  }

  /** 获取当前 schema 版本 */
  getCurrentVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
    return row?.v ?? 0;
  }

  /** 获取已执行的迁移历史 */
  getHistory(): { version: number; description: string; applied_at: number }[] {
    return this.db
      .prepare('SELECT version, description, applied_at FROM schema_migrations ORDER BY version')
      .all() as { version: number; description: string; applied_at: number }[];
  }
}
