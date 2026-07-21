/**
 * ContextPersistence — 上下文快照持久化
 *
 * v9.1 Stage 1: 将 ExecutionContext 快照持久化到 SQLite。
 * 与 ContextVersioner 配合使用，提供版本化持久化能力。
 */

import type Database from 'better-sqlite3';
import type { ExecutionContext, ContextLayer } from './ContextBuilder.js';

// ── PersistedContext — 数据库行对应的接口 ──

interface PersistedContextRow {
  context_id: string;
  version: number;
  mission_id: string;
  schema_version: string;
  base_data: string;
  session_data: string;
  ephemeral_data: string;
  fragments_json: string;
  change_description: string | null;
  assembled_at: number;
}

// ── ContextPersistence ──

export class ContextPersistence {
  private db: Database.Database;

  /**
   * @param db - better-sqlite3 Database 实例（应与 SqliteEventStore 共享）
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * save — 持久化上下文快照
   *
   * @param context - ExecutionContext 对象
   * @param changeDesc - 变更说明（可选）
   */
  save(context: ExecutionContext, changeDesc?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO context_snapshots
        (context_id, version, mission_id, schema_version,
         base_data, session_data, ephemeral_data, fragments_json,
         change_description, assembled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      context.contextId,
      context.version,
      context.missionId,
      context.schemaVersion,
      JSON.stringify(context.layers.base ?? {}),
      JSON.stringify(context.layers.session ?? {}),
      JSON.stringify(context.layers.ephemeral ?? {}),
      JSON.stringify(context.fragments),
      changeDesc ?? null,
      context.assembledAt,
    );
  }

  /**
   * loadLatest — 加载指定上下文的最近版本
   *
   * @param contextId - 上下文 ID
   * @returns ExecutionContext 或 undefined
   */
  loadLatest(contextId: string): ExecutionContext | undefined {
    const row = this.db.prepare(
      'SELECT * FROM context_snapshots WHERE context_id = ? ORDER BY version DESC LIMIT 1'
    ).get(contextId) as PersistedContextRow | undefined;

    return row ? this.hydrate(row) : undefined;
  }

  /**
   * loadVersion — 加载指定版本的上下文
   *
   * @param contextId - 上下文 ID
   * @param version - 版本号
   * @returns ExecutionContext 或 undefined
   */
  loadVersion(contextId: string, version: number): ExecutionContext | undefined {
    const row = this.db.prepare(
      'SELECT * FROM context_snapshots WHERE context_id = ? AND version = ?'
    ).get(contextId, version) as PersistedContextRow | undefined;

    return row ? this.hydrate(row) : undefined;
  }

  /**
   * getHistory — 获取上下文的版本历史
   *
   * @param contextId - 上下文 ID
   * @returns 版本元数据列表
   */
  getHistory(contextId: string): { version: number; changeDescription: string | null; assembledAt: number }[] {
    return this.db.prepare(
      'SELECT version, change_description, assembled_at FROM context_snapshots WHERE context_id = ? ORDER BY version'
    ).all(contextId) as { version: number; changeDescription: string | null; assembledAt: number }[];
  }

  /**
   * loadByMission — 按 Mission ID 加载所有上下文
   *
   * @param missionId - Mission ID
   * @returns ExecutionContext 列表（按时间倒序）
   */
  loadByMission(missionId: string): ExecutionContext[] {
    const rows = this.db.prepare(
      'SELECT * FROM context_snapshots WHERE mission_id = ? ORDER BY assembled_at DESC'
    ).all(missionId) as PersistedContextRow[];

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * prune — 删除超出最大版本数的历史快照
   *
   * @param maxVersions - 每个上下文保留的最大版本数（默认 20）
   * @returns 删除的记录数
   */
  prune(maxVersions: number = 20): number {
    // SQLite 不支持 ROW_NUMBER，使用子查询删除超出限制的版本
    const deleteStmt = this.db.prepare(`
      DELETE FROM context_snapshots WHERE rowid IN (
        SELECT cs.rowid FROM context_snapshots cs
        WHERE (
          SELECT COUNT(*) FROM context_snapshots cs2
          WHERE cs2.context_id = cs.context_id AND cs2.version >= cs.version
        ) > ?
      )
    `);

    return deleteStmt.run(maxVersions).changes;
  }

  /**
   * delete — 删除指定上下文的所有快照
   *
   * @param contextId - 上下文 ID
   */
  delete(contextId: string): void {
    this.db.prepare('DELETE FROM context_snapshots WHERE context_id = ?').run(contextId);
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * hydrate — 将数据库行还原为 ExecutionContext
   */
  private hydrate(row: PersistedContextRow): ExecutionContext {
    const layers: Record<ContextLayer, Record<string, unknown>> = {
      base: JSON.parse(row.base_data as string),
      session: JSON.parse(row.session_data as string),
      ephemeral: JSON.parse(row.ephemeral_data as string),
    };

    const fragments = JSON.parse(row.fragments_json as string);

    return {
      contextId: row.context_id,
      version: row.version,
      missionId: row.mission_id,
      schemaVersion: row.schema_version,
      layers,
      fragments: Array.isArray(fragments) ? fragments : [],
      assembledAt: row.assembled_at,
    };
  }
}
