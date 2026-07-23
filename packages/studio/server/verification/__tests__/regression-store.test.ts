/**
 * RegressionStore — 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { RegressionStore } from '../regression-store.js';

describe('RegressionStore', () => {
  let db: Database.Database;
  let store: RegressionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new RegressionStore(db);
  });

  it('should save and retrieve verification records', async () => {
    const record = await store.save({
      missionId: 'mis_test_1',
      score: 92,
      grade: 'A',
      violations: JSON.stringify([]),
      recordedAt: Date.now(),
    });

    expect(record.id).toBeDefined();
    expect(record.missionId).toBe('mis_test_1');
    expect(record.score).toBe(92);
    expect(record.grade).toBe('A');

    const retrieved = store.getById(record.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.score).toBe(92);
  });

  it('should query by mission ID', async () => {
    await store.save({ missionId: 'mis_a', score: 90, grade: 'A', violations: '[]', recordedAt: 1000 });
    await store.save({ missionId: 'mis_a', score: 80, grade: 'B', violations: '[]', recordedAt: 2000 });
    await store.save({ missionId: 'mis_b', score: 70, grade: 'C', violations: '[]', recordedAt: 3000 });

    const results = store.getByMissionId('mis_a');
    expect(results).toHaveLength(2);
    expect(results.every(r => r.missionId === 'mis_a')).toBe(true);
  });

  it('should query with filters', async () => {
    await store.save({ missionId: 'mis_1', score: 95, grade: 'A', violations: '[]', recordedAt: 1000 });
    await store.save({ missionId: 'mis_2', score: 85, grade: 'B', violations: '[]', recordedAt: 2000 });
    await store.save({ missionId: 'mis_3', score: 45, grade: 'D', violations: '[]', recordedAt: 3000 });

    const gradeDResults = store.query({ grade: 'D' });
    expect(gradeDResults).toHaveLength(1);
    expect(gradeDResults[0].missionId).toBe('mis_3');

    const timeRangeResults = store.query({ startTime: 1500, endTime: 2500 });
    expect(timeRangeResults).toHaveLength(1);
    expect(timeRangeResults[0].missionId).toBe('mis_2');
  });

  it('should provide stats', async () => {
    await store.save({ missionId: 'mis_1', score: 95, grade: 'A', violations: '[]', recordedAt: 1000 });
    await store.save({ missionId: 'mis_2', score: 85, grade: 'B', violations: '[]', recordedAt: 2000 });
    await store.save({ missionId: 'mis_3', score: 50, grade: 'D', violations: '[]', recordedAt: 3000 });

    const stats = store.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byGrade['A']).toBe(1);
    expect(stats.byGrade['B']).toBe(1);
    expect(stats.byGrade['D']).toBe(1);
    expect(stats.averageScore).toBeGreaterThan(0);
  });

  it('should delete older records', async () => {
    await store.save({ missionId: 'mis_1', score: 95, grade: 'A', violations: '[]', recordedAt: 1000 });
    await store.save({ missionId: 'mis_2', score: 85, grade: 'B', violations: '[]', recordedAt: 3000 });

    const deleted = store.deleteOlderThan(2000);
    expect(deleted).toBe(1);

    const remaining = store.query({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].missionId).toBe('mis_2');
  });

  it('should save full report', async () => {
    const report = await store.saveFull({
      missionId: 'mis_test_full',
      score: 88,
      grade: 'B',
      violations: JSON.stringify([{ type: 'TIMEOUT', stepId: 'step_1', severity: 'minor', message: 'Slow' }]),
      comparisonResults: JSON.stringify([{ stepId: 'step_1', completeness: 1, accuracy: 1, efficiency: 0.5, issues: [], matched: true }]),
      qualityScore: JSON.stringify({ score: 88, grade: 'B' }),
      duration: 5000,
    });

    expect(report.id).toBeDefined();
    expect(report.missionId).toBe('mis_test_full');
    expect(report.score).toBe(88);
    expect(report.grade).toBe('B');

    const retrieved = store.getById(report.id);
    expect(retrieved).not.toBeNull();
  });

  it('should expose health with record count', () => {
    const health = store.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('RegressionStore');
    expect(health.recordCount).toBe(0);
  });
});
