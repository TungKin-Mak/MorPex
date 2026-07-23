/**
 * SuccessPredictor — 测试
 */
import { describe, it, expect } from 'vitest';
import { SuccessPredictor } from '../success-predictor.js';
import type { MissionPlan } from '../../../../core/src/runtime/mission/types.js';

describe('SuccessPredictor', () => {
  const predictor = new SuccessPredictor();

  const simplePlan: MissionPlan = {
    id: 'plan_1', missionId: 'mis_1',
    steps: [{ id: 's1', name: 'Read', description: '', domain: 'read', agentType: 'reader', deps: [], priority: 1 }],
    estimatedDuration: 10000, riskLevel: 'low', reasoning: 'Simple',
  };

  const complexPlan: MissionPlan = {
    id: 'plan_2', missionId: 'mis_2',
    steps: [
      { id: 's1', name: 'A', description: '', domain: 'x', agentType: 'w', deps: [], priority: 1 },
      { id: 's2', name: 'B', description: '', domain: 'x', agentType: 'w', deps: ['s1'], priority: 2 },
      { id: 's3', name: 'C', description: '', domain: 'x', agentType: 'w', deps: ['s1'], priority: 2 },
      { id: 's4', name: 'D', description: '', domain: 'x', agentType: 'w', deps: ['s2', 's3'], priority: 3 },
      { id: 's5', name: 'E', description: '', domain: 'x', agentType: 'w', deps: ['s4'], priority: 4 },
      { id: 's6', name: 'F', description: '', domain: 'x', agentType: 'w', deps: ['s5'], priority: 5 },
      { id: 's7', name: 'G', description: '', domain: 'x', agentType: 'w', deps: ['s6'], priority: 6 },
      { id: 's8', name: 'H', description: '', domain: 'x', agentType: 'w', deps: ['s7'], priority: 7 },
    ],
    estimatedDuration: 600000, riskLevel: 'high', reasoning: 'Complex',
  };

  it('should predict high success for simple low-risk plan', () => {
    const result = predictor.predict(simplePlan);
    expect(result.probability).toBeGreaterThan(60);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it('should predict low success for complex critical-risk plan', () => {
    const result = predictor.predict(complexPlan);
    expect(result.probability).toBeLessThan(60);
  });

  it('should improve confidence with twin profile', () => {
    const twinProfile: import('../types.js').SimulationTwinProfile = {
      twinId: 'twin_1', missionId: 'mis_1', goal: 'test',
      similarMissions: [
        { missionId: 'm1', goal: 'test', similarity: 0.9, success: true, duration: 10000, score: 95 },
      ],
      historicalSuccessRate: 1,
      historicalAvgDuration: 10000,
      historicalAvgCost: 50,
      suggestedRiskLevel: 'low',
      lastExecutedAt: Date.now(),
    };

    const result = predictor.predict(simplePlan, twinProfile);
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it('should return probability within valid range', () => {
    const result = predictor.predict(simplePlan);
    expect(result.probability).toBeGreaterThanOrEqual(5);
    expect(result.probability).toBeLessThanOrEqual(99);
  });

  it('should expose health check', () => {
    const health = predictor.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('SuccessPredictor');
  });
});
