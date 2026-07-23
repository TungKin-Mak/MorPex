/**
 * RegressionStore — 回归存储（SQLite 后端）
 *
 * MorPex v10: 存储 Verification 历史记录，支持按 missionId/时间段/grade 查询。
 * 使用 better-sqlite3（与现有 SqliteEventStore 一致）。
 *
 * 表结构:
 *   verification_results — 验证结果主表
 */

import type Database from 'better-sqlite3';
import type { VerificationRecord, RegressionQuery, Grade } from './types.js';
import { randomUUID } from 'node:crypto';

// ── Schema ──

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS verification_results (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    grade TEXT NOT NULL,
    violations TEXT NOT NULL DEFAULT '[]',
    comparison_results TEXT NOT NULL DEFAULT '[]',
    quality_score TEXT NOT NULL DEFAULT '{}',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vr_mission ON verification_results(mission_id);
  CREATE INDEX IF NOT EXISTS idx_vr_grade ON verification_results(grade);
  CREATE INDEX IF NOT EXISTS idx_vr_recorded ON verification_results(recorded_at);
  CREATE INDEX IF NOT EXISTS idx_vr_mission_time ON verification_results(mission_id, recorded_at);
`;

// ── RegressionStore ──

export class RegressionStore {
  private db: Database.Database;
  private initialized = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    if (this.initialized) return;
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec(SCHEMA_SQL);
    this.initialized = true;
    console.log('[RegressionStore] SQLite schema initialized');
  }

  /**
   * save — 保存验证记录
   */
  async save(record: Omit<VerificationRecord, 'id'> & { id?: string }): Promise<VerificationRecord> {
    const id = record.id || `vr_${randomUUID().slice(0, 8)}_${Date.now()}`;
    const full: VerificationRecord = {
      id,
      missionId: record.missionId,
      score: record.score,
      grade: record.grade,
      violations: record.violations,
      recordedAt: record.recordedAt,
    };

    this.db.prepare(`
      INSERT INTO verification_results (id, mission_id, score, grade, violations, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(full.id, full.missionId, full.score, full.grade, full.violations, full.recordedAt);

    return full;
  }

  /**
   * saveFull — 保存完整验证报告（含详细数据）
   */
  async saveFull(report: {
    missionId: string;
    score: number;
    grade: string;
    violations: string;
    comparisonResults: string;
    qualityScore: string;
    duration: number;
  }): Promise<VerificationRecord> {
    const id = `vr_${randomUUID().slice(0, 8)}_${Date.now()}`;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO verification_results (id, mission_id, score, grade, violations, comparison_results, quality_score, duration_ms, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, report.missionId, report.score, report.grade, report.violations, report.comparisonResults, report.qualityScore, report.duration, now);

    return {
      id,
      missionId: report.missionId,
      score: report.score,
      grade: report.grade,
      violations: report.violations,
      recordedAt: now,
    };
  }

  /**
   * getByMissionId — 按 Mission ID 查询所有记录
   */
  getByMissionId(missionId: string): VerificationRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM verification_results WHERE mission_id = ? ORDER BY recorded_at DESC
    `).all(missionId) as any[];

    return rows.map(this.mapRow);
  }

  /**
   * getById — 按 ID 查询
   */
  getById(id: string): VerificationRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM verification_results WHERE id = ?
    `).get(id) as any;

    return row ? this.mapRow(row) : null;
  }

  /**
   * query — 复合查询
   */
  query(q: RegressionQuery): VerificationRecord[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (q.missionId) {
      conditions.push('mission_id = ?');
      params.push(q.missionId);
    }
    if (q.startTime) {
      conditions.push('recorded_at >= ?');
      params.push(q.startTime);
    }
    if (q.endTime) {
      conditions.push('recorded_at <= ?');
      params.push(q.endTime);
    }
    if (q.grade) {
      conditions.push('grade = ?');
      params.push(q.grade);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM verification_results ${where} ORDER BY recorded_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return rows.map(this.mapRow);
  }

  /**
   * getStats — 获取统计
   */
  getStats(): { total: number; byGrade: Record<string, number>; averageScore: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM verification_results').get() as any).c;

    const gradeRows = this.db.prepare(`
      SELECT grade, COUNT(*) as c FROM verification_results GROUP BY grade
    `).all() as any[];

    const byGrade: Record<string, number> = {};
    for (const row of gradeRows) {
      byGrade[row.grade] = row.c;
    }

    const avgRow = this.db.prepare('SELECT AVG(score) as avg FROM verification_results').get() as any;
    const averageScore = avgRow.avg ? Math.round(avgRow.avg) : 0;

    return { total, byGrade, averageScore };
  }

  /**
   * deleteOlderThan — 清理旧记录
   */
  deleteOlderThan(timestamp: number): number {
    const result = this.db.prepare('DELETE FROM verification_results WHERE recorded_at < ?').run(timestamp);
    return result.changes;
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number; recordCount: number } {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM verification_results').get() as any).c;
    return {
      ok: true,
      name: 'RegressionStore',
      uptime: Date.now(),
      recordCount: count,
    };
  }

  // ── 私有方法 ──

  private mapRow(row: any): VerificationRecord {
    return {
      id: row.id,
      missionId: row.mission_id,
      score: row.score,
      grade: row.grade,
      violations: row.violations,
      recordedAt: row.recorded_at,
    };
  }
}
