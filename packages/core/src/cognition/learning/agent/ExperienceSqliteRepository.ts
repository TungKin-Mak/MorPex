/**
 * ExperienceSqliteRepository — 跨 Agent 学习经验 SQLite 持久化
 *
 * v9.2 Stage 2: 共享经验存储的 SQLite 实现。
 */
import type Database from 'better-sqlite3';
import type { GeneralizedExperience, ExperienceQuery } from './types.js';

export class ExperienceSqliteRepository {
  constructor(private db: Database.Database) {}

  save(exp: GeneralizedExperience): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO shared_experiences
        (id, category, problem_pattern, solution, success_rate, avg_latency, cost_savings,
         source_agent_type, source_mission_ids, positive_feedback, negative_feedback,
         weight, tags, visible_to, created_at, last_validated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      exp.id, exp.category, exp.problemPattern, exp.solution,
      exp.effectiveness.successRate, exp.effectiveness.avgLatency, exp.effectiveness.costSavings,
      exp.sourceAgentType, JSON.stringify(exp.sourceMissionIds),
      exp.feedback.positive, exp.feedback.negative, exp.feedback.weight,
      JSON.stringify(exp.tags), JSON.stringify(exp.visibleTo),
      exp.createdAt, exp.lastValidatedAt,
    );
  }

  query(q: ExperienceQuery): GeneralizedExperience[] {
    let sql = 'SELECT * FROM shared_experiences WHERE 1=1';
    const params: any[] = [];
    if (q.category) { sql += ' AND category = ?'; params.push(q.category); }
    if (q.minWeight !== undefined) { sql += ' AND weight >= ?'; params.push(q.minWeight); }
    sql += ' ORDER BY weight DESC';
    if (q.limit) { sql += ' LIMIT ?'; params.push(q.limit); }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.hydrate(r));
  }

  get(id: string): GeneralizedExperience | undefined {
    const row = this.db.prepare('SELECT * FROM shared_experiences WHERE id = ?').get(id) as any;
    return row ? this.hydrate(row) : undefined;
  }

  recordFeedback(id: string, positive: boolean): void {
    const field = positive ? 'positive_feedback' : 'negative_feedback';
    this.db.prepare(`UPDATE shared_experiences SET ${field} = ${field} + 1, weight = ((positive_feedback + 1.0) - (negative_feedback) * 0.5) / (positive_feedback + negative_feedback + 1.0) WHERE id = ?`).run(id);
    // Recalculate weight
    this.db.prepare(`UPDATE shared_experiences SET weight = CASE WHEN (positive_feedback + negative_feedback) > 0 THEN (positive_feedback - negative_feedback * 0.5) / (positive_feedback + negative_feedback + 1.0) ELSE 0 END WHERE id = ?`).run(id);
  }

  getStats(): { total: number; byCategory: Record<string, number>; avgWeight: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM shared_experiences').get() as any).c;
    const rows = this.db.prepare('SELECT category, COUNT(*) as c FROM shared_experiences GROUP BY category').all() as any[];
    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = r.c;
    const avgRow = this.db.prepare('SELECT AVG(weight) as a FROM shared_experiences').get() as any;
    return { total, byCategory, avgWeight: avgRow.a ?? 0 };
  }

  cleanupExpired(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    return this.db.prepare('DELETE FROM shared_experiences WHERE last_validated_at < ?').run(cutoff).changes;
  }

  private hydrate(row: any): GeneralizedExperience {
    return {
      id: row.id,
      category: row.category,
      problemPattern: row.problem_pattern,
      solution: row.solution,
      effectiveness: {
        successRate: row.success_rate,
        avgLatency: row.avg_latency,
        costSavings: row.cost_savings,
      },
      sourceAgentType: row.source_agent_type,
      sourceMissionIds: JSON.parse(row.source_mission_ids || '[]'),
      feedback: {
        positive: row.positive_feedback,
        negative: row.negative_feedback,
        weight: row.weight,
      },
      tags: JSON.parse(row.tags || '[]'),
      visibleTo: JSON.parse(row.visible_to || '[]'),
      createdAt: row.created_at,
      lastValidatedAt: row.last_validated_at,
    };
  }
}
