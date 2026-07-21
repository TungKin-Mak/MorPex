/**
 * ArtifactSqliteRepository — SQLite 后端产物存储
 *
 * v9.1 Stage 1: 替代 ArtifactRepository（纯内存）的 SQLite 实现。
 * 与 ArtifactManager 配合使用，作为可选的持久化层。
 *
 * 表结构定义在 SqliteEventStore 的 SCHEMA_SQL 中：
 *   artifacts_v2           — 主表
 *   artifact_versions_v2   — 版本历史
 *   artifact_dependencies_v2 — 依赖关系
 *   artifact_staging_v2    — 两阶段提交暂存
 */

import type Database from 'better-sqlite3';
import type { ArtifactRecord, ArtifactQuery, ArtifactStatus, ArtifactType } from './types.js';

// ── 数据库行对应 ──

interface ArtifactRow {
  id: string;
  name: string;
  type: string;
  status: string;
  version: number;
  content: string | null;
  content_hash: string | null;
  created_by: string | null;
  source: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

interface VersionRow {
  id: string;
  artifact_id: string;
  version: number;
  content: string | null;
  content_hash: string | null;
  change_log: string | null;
  staged_by: string | null;
  verified_at: number | null;
  committed_at: number | null;
  created_at: number;
}

interface DependencyRow {
  from_id: string;
  to_id: string;
  relation_type: string;
  weight: number;
  created_at: number;
}

interface StagingRow {
  stage_id: string;
  artifact_id: string;
  new_content: string | null;
  new_content_hash: string | null;
  staged_by: string;
  status: string;
  staged_at: number;
  expires_at: number | null;
}

// ── ArtifactSqliteRepository ──

export class ArtifactSqliteRepository {
  private db: Database.Database;

  /**
   * @param db - better-sqlite3 Database 实例
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════

  /**
   * save — 保存或更新产物记录
   */
  save(record: ArtifactRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO artifacts_v2
        (id, name, type, status, version, content, content_hash,
         created_by, source, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.meta.name,
      record.meta.type,
      record.status,
      record.version,
      typeof record.content === 'string' ? record.content : JSON.stringify(record.content),
      record.checksum ?? null,
      record.createdBy ?? null,
      record.source ?? null,
      JSON.stringify({
        description: record.meta.description,
        tags: record.meta.tags,
        custom: record.meta.custom,
      }),
      record.createdAt,
      record.updatedAt,
    );
  }

  /**
   * get — 获取产物
   */
  get(id: string): ArtifactRecord | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts_v2 WHERE id = ?').get(id) as ArtifactRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  /**
   * query — 按条件查询产物
   */
  query(q: ArtifactQuery): ArtifactRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (q.type) { clauses.push('type = ?'); params.push(q.type); }
    if (q.status) { clauses.push('status = ?'); params.push(q.status); }
    if (q.name) { clauses.push('name LIKE ?'); params.push(`%${q.name}%`); }
    if (q.createdBy) { clauses.push('created_by = ?'); params.push(q.createdBy); }

    const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM artifacts_v2 ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as ArtifactRow[];

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * delete — 删除产物
   */
  delete(id: string): boolean {
    // 在事务中删除产物及其关联数据
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM artifact_dependencies_v2 WHERE from_id = ? OR to_id = ?').run(id, id);
      this.db.prepare('DELETE FROM artifact_versions_v2 WHERE artifact_id = ?').run(id);
      this.db.prepare('DELETE FROM artifact_staging_v2 WHERE artifact_id = ?').run(id);
      return this.db.prepare('DELETE FROM artifacts_v2 WHERE id = ?').run(id).changes;
    });
    return tx() > 0;
  }

  /**
   * all — 获取所有产物
   */
  all(): ArtifactRecord[] {
    const rows = this.db.prepare('SELECT * FROM artifacts_v2 ORDER BY updated_at DESC').all() as ArtifactRow[];
    return rows.map((r) => this.hydrate(r));
  }

  /**
   * count — 获取产物总数
   */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM artifacts_v2').get() as any;
    return row.cnt;
  }

  // ═══════════════════════════════════════════════════════════════
  // 版本管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * saveVersion — 保存版本记录
   */
  saveVersion(
    versionId: string,
    artifactId: string,
    version: number,
    content: unknown,
    changeLog?: string,
    stagedBy?: string,
    verifiedAt?: number,
    committedAt?: number,
  ): void {
    this.db.prepare(`
      INSERT INTO artifact_versions_v2
        (id, artifact_id, version, content, content_hash, change_log,
         staged_by, verified_at, committed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      artifactId,
      version,
      typeof content === 'string' ? content : JSON.stringify(content),
      null, // content_hash not stored separately
      changeLog ?? null,
      stagedBy ?? null,
      verifiedAt ?? null,
      committedAt ?? null,
      Date.now(),
    );
  }

  /**
   * getVersion — 获取指定版本
   */
  getVersion(artifactId: string, version: number): { version: number; content: unknown; changeLog: string | null; committedAt: number | null } | undefined {
    const row = this.db.prepare(
      'SELECT * FROM artifact_versions_v2 WHERE artifact_id = ? AND version = ?'
    ).get(artifactId, version) as VersionRow | undefined;

    if (!row) return undefined;

    let content = row.content;
    try { content = JSON.parse(row.content!); } catch { /* keep as string */ }

    return {
      version: row.version,
      content,
      changeLog: row.change_log,
      committedAt: row.committed_at,
    };
  }

  /**
   * getVersions — 获取所有版本
   */
  getVersions(artifactId: string): { version: number; changeLog: string | null; committedAt: number | null }[] {
    return this.db.prepare(
      'SELECT version, change_log, committed_at, created_at FROM artifact_versions_v2 WHERE artifact_id = ? ORDER BY version DESC'
    ).all(artifactId) as { version: number; changeLog: string | null; committedAt: number | null }[];
  }

  // ═══════════════════════════════════════════════════════════════
  // 依赖管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * addDependency — 添加依赖关系
   */
  addDependency(fromId: string, toId: string, relationType: string = 'depends_on', weight: number = 1.0): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO artifact_dependencies_v2 (from_id, to_id, relation_type, weight, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(fromId, toId, relationType, weight, Date.now());
  }

  /**
   * removeDependency — 移除依赖关系
   */
  removeDependency(fromId: string, toId: string, relationType: string = 'depends_on'): void {
    this.db.prepare(
      'DELETE FROM artifact_dependencies_v2 WHERE from_id = ? AND to_id = ? AND relation_type = ?'
    ).run(fromId, toId, relationType);
  }

  /**
   * getDependencies — 获取从指定产物出发的依赖
   */
  getDependencies(fromId: string): { toId: string; relationType: string; weight: number }[] {
    const rows = this.db.prepare(
      'SELECT to_id AS toId, relation_type AS relationType, weight FROM artifact_dependencies_v2 WHERE from_id = ?'
    ).all(fromId) as { toId: string; relationType: string; weight: number }[];
    return rows;
  }

  /**
   * getDependents — 获取依赖指定产物的其他产物
   */
  getDependents(toId: string): { fromId: string; relationType: string; weight: number }[] {
    return this.db.prepare(
      'SELECT from_id AS fromId, relation_type AS relationType, weight FROM artifact_dependencies_v2 WHERE to_id = ?'
    ).all(toId) as { fromId: string; relationType: string; weight: number }[];
  }

  // ═══════════════════════════════════════════════════════════════
  // 两阶段提交 — 暂存管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * createStage — 创建暂存条目
   */
  createStage(stageId: string, artifactId: string, newContent: unknown, stagedBy: string): void {
    this.db.prepare(`
      INSERT INTO artifact_staging_v2 (stage_id, artifact_id, new_content, new_content_hash, staged_by, status, staged_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'staged', ?, ?)
    `).run(
      stageId,
      artifactId,
      typeof newContent === 'string' ? newContent : JSON.stringify(newContent),
      null,
      stagedBy,
      Date.now(),
      Date.now() + 3600000, // 1 hour TTL
    );
  }

  /**
   * getStage — 获取暂存条目
   */
  getStage(stageId: string): { stageId: string; artifactId: string; newContent: unknown; stagedBy: string; status: string } | undefined {
    const row = this.db.prepare('SELECT * FROM artifact_staging_v2 WHERE stage_id = ?').get(stageId) as StagingRow | undefined;
    if (!row) return undefined;

    let content = row.new_content;
    try { content = JSON.parse(row.new_content!); } catch { /* keep as string */ }

    return {
      stageId: row.stage_id,
      artifactId: row.artifact_id,
      newContent: content,
      stagedBy: row.staged_by,
      status: row.status,
    };
  }

  /**
   * updateStageStatus — 更新暂存状态
   */
  updateStageStatus(stageId: string, status: string): void {
    this.db.prepare('UPDATE artifact_staging_v2 SET status = ? WHERE stage_id = ?').run(status, stageId);
  }

  /**
   * removeStage — 删除暂存条目
   */
  removeStage(stageId: string): void {
    this.db.prepare('DELETE FROM artifact_staging_v2 WHERE stage_id = ?').run(stageId);
  }

  /**
   * cleanupExpiredStages — 清理过期的暂存条目
   */
  cleanupExpiredStages(): number {
    const now = Date.now();
    const deleted = this.db.prepare(
      "DELETE FROM artifact_staging_v2 WHERE expires_at IS NOT NULL AND expires_at < ? AND status = 'staged'"
    ).run(now);
    return deleted.changes;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * hydrate — 将数据库行还原为 ArtifactRecord
   */
  private hydrate(row: ArtifactRow): ArtifactRecord {
    let content: unknown = row.content;
    try { content = JSON.parse(row.content!); } catch { /* keep as string */ }

    const metadata = JSON.parse(row.metadata_json || '{}');

    return {
      id: row.id,
      meta: {
        name: row.name,
        type: row.type as ArtifactType,
        description: metadata.description as string | undefined,
        tags: metadata.tags as string[] | undefined,
        custom: metadata.custom as Record<string, unknown> | undefined,
      },
      status: row.status as ArtifactStatus,
      version: row.version,
      content,
      checksum: row.content_hash ?? '',
      size: typeof content === 'string' ? new TextEncoder().encode(content).length : 0,
      createdBy: row.created_by ?? 'system',
      source: row.source ?? 'manual',
      dependencies: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
