/**
 * CostEstimator — 测试
 */
import { describe, it, expect } from 'vitest';
import { CostEstimator } from '../cost-estimator.js';
import type { MissionPlan } from '../../../../core/src/runtime/mission/types.js';

describe('CostEstimator', () => {
  const estimator = new CostEstimator();

  const simplePlan: MissionPlan = {
    id: 'plan_1',
    missionId: 'mis_1',
    steps: [
      { id: 's1', name: 'Step 1', description: '', domain: 'test', agentType: 'worker', deps: [], priority: 1 },
      { id: 's2', name: 'Step 2', description: '', domain: 'test', agentType: 'worker', deps: ['s1'], priority: 2 },
    ],
    estimatedDuration: 60000,
    riskLevel: 'low',
    reasoning: 'Simple test',
  };

  const complexPlan: MissionPlan = {
    id: 'plan_2',
    missionId: 'mis_2',
    steps: [
      { id: 's1', name: 'Step 1', description: '', domain: 'test', agentType: 'worker', deps: [], priority: 1 },
      { id: 's2', name: 'Step 2', description: '', domain: 'test', agentType: 'worker', deps: ['s1'], priority: 2 },
      { id: 's3', name: 'Step 3', description: '', domain: 'test', agentType: 'worker', deps: ['s1'], priority: 2 },
      { id: 's4', name: 'Step 4', description: '', domain: 'test', agentType: 'worker', deps: ['s2', 's3'], priority: 3 },
      { id: 's5', name: 'Step 5', description: '', domain: 'test', agentType: 'worker', deps: ['s4'], priority: 4 },
    ],
    estimatedDuration: 300000,
    riskLevel: 'high',
    reasoning: 'Complex test',
  };

  it('should estimate cost for simple plan', () => {
    const estimate = estimator.estimate(simplePlan);
    expect(estimate.estimatedCost).toBeGreaterThan(0);
    expect(estimate.currency).toBe('credits');
    expect(estimate.breakdown.length).toBeGreaterThanOrEqual(3);
  });

  it('should estimate higher cost for complex plan', () => {
    const simpleEst = estimator.estimate(simplePlan);
    const complexEst = estimator.estimate(complexPlan);
    expect(complexEst.estimatedCost).toBeGreaterThan(simpleEst.estimatedCost);
  });

  it('should include risk premium for high risk', () => {
    const estimate = estimator.estimate(complexPlan);
    const riskItem = estimate.breakdown.find(b => b.category === 'risk_premium');
    expect(riskItem).toBeDefined();
    expect(riskItem!.amount).toBeGreaterThan(0);
  });

  it('should adjust with twin profile', () => {
    const twinProfile: import('../types.js').SimulationTwinProfile = {
      twinId: 'twin_1',
      missionId: 'mis_1',
      goal: 'test',
      similarMissions: [
        { missionId: 'm1', goal: 'test', similarity: 0.8, success: true, duration: 50000, score: 80 },
        { missionId: 'm2', goal: 'test', similarity: 0.7, success: true, duration: 60000, score: 85 },
        { missionId: 'm3', goal: 'test', similarity: 0.6, success: true, duration: 70000, score: 75 },
        { missionId: 'm4', goal: 'test', similarity: 0.5, success: true, duration: 55000, score: 90 },
      ],
      historicalSuccessRate: 1,
      historicalAvgDuration: 58750,
      historicalAvgCost: 100,
      suggestedRiskLevel: 'low',
    };

    const estimate = estimator.estimate(simplePlan, twinProfile);
    expect(estimate.confidence).toBeGreaterThan(0.6);
  });

  it('should expose health check', () => {
    const health = estimator.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('CostEstimator');
  });
});
