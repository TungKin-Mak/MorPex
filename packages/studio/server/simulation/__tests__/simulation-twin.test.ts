/**
 * SimulationTwin — 测试
 */
import { describe, it, expect } from 'vitest';
import { SimulationTwin } from '../simulation-twin.js';

describe('SimulationTwin', () => {
  const twin = new SimulationTwin({ similarityThreshold: 0.1 });

  const history = [
    { missionId: 'mis_1', goal: 'Analyze quarterly financial report', success: true, duration: 120000, score: 95 },
    { missionId: 'mis_2', goal: 'Generate investor presentation', success: true, duration: 180000, score: 88 },
    { missionId: 'mis_3', goal: 'Prepare meeting notes', success: true, duration: 30000, score: 92 },
    { missionId: 'mis_4', goal: 'Deploy production hotfix', success: false, duration: 600000, score: 30 },
    { missionId: 'mis_5', goal: 'Analyze server logs for issues', success: true, duration: 90000, score: 78 },
  ];

  it('should build profile with historical data', () => {
    const profile = twin.buildProfile('twin_1', 'mis_new', 'Analyze monthly financial data', history);

    expect(profile.twinId).toBe('twin_1');
    expect(profile.missionId).toBe('mis_new');
    expect(profile.goal).toBe('Analyze monthly financial data');
    expect(profile.similarMissions.length).toBeGreaterThan(0);
    expect(profile.historicalSuccessRate).toBeGreaterThan(0);
  });

  it('should find similar missions based on keyword overlap', () => {
    const profile = twin.buildProfile('twin_2', 'mis_new', 'Analyze financial report', history);

    // Should find mis_1 (financial + analyze/report)
    const hasFinancial = profile.similarMissions.some(m => m.missionId === 'mis_1');
    expect(hasFinancial).toBe(true);
  });

  it('should handle empty history gracefully', () => {
    const profile = twin.buildProfile('twin_3', 'mis_new', 'Unknown task', []);

    expect(profile.similarMissions).toHaveLength(0);
    expect(profile.historicalSuccessRate).toBe(0.5); // default
    expect(profile.suggestedRiskLevel).toBe('medium');
  });

  it('should determine risk level based on success rate', () => {
    // Low risk: high success + low duration
    const goodProfile = twin.buildProfile('twin_4', 'mis_good', 'Quick task', [
      { missionId: 'm1', goal: 'Quick task A', success: true, duration: 10000, score: 95 },
      { missionId: 'm2', goal: 'Quick task B', success: true, duration: 20000, score: 90 },
    ]);
    expect(goodProfile.suggestedRiskLevel).toBe('low');

    // High risk: low success rate
    const badProfile = twin.buildProfile('twin_5', 'mis_bad', 'Risky task', [
      { missionId: 'm1', goal: 'Risky task A', success: false, duration: 500000, score: 10 },
      { missionId: 'm2', goal: 'Risky task B', success: false, duration: 600000, score: 20 },
    ]);
    expect(['high', 'critical']).toContain(badProfile.suggestedRiskLevel);
  });

  it('should expose health check', () => {
    const health = twin.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('SimulationTwin');
  });
});
