/**
 * RiskPredictor — 测试
 */
import { describe, it, expect } from 'vitest';
import { RiskPredictor } from '../risk-predictor.js';
import type { MissionPlan } from '../../../../core/src/runtime/mission/types.js';

describe('RiskPredictor', () => {
  const predictor = new RiskPredictor();

  const lowRiskPlan: MissionPlan = {
    id: 'plan_low',
    missionId: 'mis_low',
    steps: [
      { id: 's1', name: 'Read data', description: '', domain: 'read', agentType: 'reader', deps: [], priority: 1 },
    ],
    estimatedDuration: 10000,
    riskLevel: 'low',
    reasoning: 'Simple read',
  };

  const highRiskPlan: MissionPlan = {
    id: 'plan_high',
    missionId: 'mis_high',
    steps: [
      { id: 's1', name: 'Deploy', description: '', domain: 'deployment', agentType: 'executor', deps: [], priority: 1 },
      { id: 's2', name: 'Configure', description: '', domain: 'deployment', agentType: 'executor', deps: ['s1'], priority: 2 },
      { id: 's3', name: 'Verify', description: '', domain: 'deployment', agentType: 'verifier', deps: ['s2'], priority: 3 },
      { id: 's4', name: 'Rollout', description: '', domain: 'deployment', agentType: 'executor', deps: ['s3'], priority: 4 },
      { id: 's5', name: 'Monitor', description: '', domain: 'deployment', agentType: 'monitor', deps: ['s4'], priority: 5 },
      { id: 's6', name: 'Cleanup', description: '', domain: 'deployment', agentType: 'executor', deps: ['s5'], priority: 6 },
    ],
    estimatedDuration: 600000,
    riskLevel: 'high',
    reasoning: 'Complex deployment',
  };

  it('should return low risk for simple plan', () => {
    const result = predictor.predict(lowRiskPlan);
    expect(result.overallRisk).toBe('low');
    expect(result.score).toBeLessThan(30);
  });

  it('should return high risk for complex plan', () => {
    const result = predictor.predict(highRiskPlan);
    expect(['high', 'critical']).toContain(result.overallRisk);
    expect(result.score).toBeGreaterThan(50);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it('should include mitigations for high risk', () => {
    const result = predictor.predict(highRiskPlan);
    expect(result.mitigations.length).toBeGreaterThan(0);
  });

  it('should use twin profile to adjust risk', () => {
    const twinProfile = {
      twinId: 'twin_1', missionId: 'mis_1', goal: 'test',
      similarMissions: [],
      historicalSuccessRate: 0.9,
      historicalAvgDuration: 50000,
      historicalAvgCost: 50,
      suggestedRiskLevel: 'low' as const,
    };

    const result = predictor.predict(lowRiskPlan, twinProfile);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it('should expose health check', () => {
    const health = predictor.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('RiskPredictor');
  });
});
