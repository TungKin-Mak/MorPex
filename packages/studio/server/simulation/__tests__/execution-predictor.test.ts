/**
 * ExecutionPredictor — 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionPredictor } from '../execution-predictor.js';
import { SimulationEngine } from '../simulation-engine.js';
import type { Mission, MissionPlan, PlanStep } from '../../../../core/src/runtime/mission/types.js';

describe('ExecutionPredictor', () => {
  let engine: SimulationEngine;
  let predictor: ExecutionPredictor;

  const mockSteps: PlanStep[] = [
    { id: 'step_1', name: 'Analyze', description: '分析', domain: 'cognition', agentType: 'analyst', deps: [], priority: 1 },
    { id: 'step_2', name: 'Execute', description: '执行', domain: 'execution', agentType: 'executor', deps: ['step_1'], priority: 2 },
  ];

  const mockPlan: MissionPlan = {
    id: 'plan_pred_1',
    missionId: 'mis_pred_1',
    steps: mockSteps,
    estimatedDuration: 60_000,
    riskLevel: 'low',
    reasoning: 'Prediction test',
  };

  const mockMission: Mission = {
    id: 'mis_pred_1',
    goal: 'Test prediction',
    owner: 'test',
    context: { channel: 'test', sessionId: 'sess_1', originalMessage: 'Test', metadata: {} },
    state: 'PLANNING' as any,
    permissions: { allowAutoExecute: true, requireApproval: false, allowedTools: ['*'] },
    plan: mockPlan,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };

  beforeEach(() => {
    engine = new SimulationEngine();
    predictor = new ExecutionPredictor(engine);
  });

  it('should produce execution prediction', async () => {
    const prediction = await predictor.predict(mockMission, mockPlan);
    expect(prediction.missionId).toBe('mis_pred_1');
    expect(prediction.qualityScore).toBeGreaterThanOrEqual(0);
    expect(prediction.qualityScore).toBeLessThanOrEqual(100);
    expect(prediction.successProbability).toBeGreaterThanOrEqual(0);
    expect(prediction.suggestion).toMatch(/^(approve|reject|review)$/);
  });

  it('should include dimension scores', async () => {
    const prediction = await predictor.predict(mockMission, mockPlan);
    expect(prediction.dimensions).toBeDefined();
    expect(prediction.dimensions.complexity).toBeGreaterThanOrEqual(0);
    expect(prediction.dimensions.duration).toBeGreaterThanOrEqual(0);
    expect(prediction.dimensions.history).toBeGreaterThanOrEqual(0);
    expect(prediction.dimensions.goal).toBeGreaterThanOrEqual(0);
  });

  it('should support simple prediction without history', async () => {
    const prediction = await predictor.predictSimple(mockMission, mockPlan);
    expect(prediction.missionId).toBe('mis_pred_1');
  });

  it('should expose health check', () => {
    const health = predictor.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('ExecutionPredictor');
  });
});
