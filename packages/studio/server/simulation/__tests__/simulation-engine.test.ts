/**
 * SimulationEngine — 集成测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationEngine } from '../simulation-engine.js';
import type { Mission, MissionPlan } from '../../../../core/src/runtime/mission/types.js';

const mockBus = {
  emit: (event: any) => { /* silent */ },
};

describe('SimulationEngine', () => {
  let engine: SimulationEngine;

  const mockMission: Mission = {
    id: 'mis_sim_test',
    goal: 'Analyze monthly sales data and generate report',
    owner: 'test',
    context: { channel: 'test', sessionId: 'sess_1', originalMessage: 'Test', metadata: {} },
    state: 'PLANNING' as any,
    permissions: { allowAutoExecute: true, requireApproval: false, allowedTools: ['*'] },
    createdAt: Date.now() - 5000,
    updatedAt: Date.now(),
    metadata: {},
  };

  const mockPlan: MissionPlan = {
    id: 'plan_sim_test',
    missionId: 'mis_sim_test',
    steps: [
      { id: 's1', name: 'Extract data', description: '提取销售数据', domain: 'data', agentType: 'extractor', deps: [], priority: 1 },
      { id: 's2', name: 'Analyze trends', description: '分析趋势', domain: 'analytics', agentType: 'analyst', deps: ['s1'], priority: 2 },
      { id: 's3', name: 'Generate report', description: '生成报告', domain: 'reporting', agentType: 'writer', deps: ['s2'], priority: 3 },
    ],
    estimatedDuration: 120000,
    riskLevel: 'low',
    reasoning: 'Standard data analysis pipeline',
  };

  const history = [
    { missionId: 'h1', goal: 'Analyze sales data Q1', success: true, duration: 100000, score: 92 },
    { missionId: 'h2', goal: 'Generate monthly report', success: true, duration: 130000, score: 88 },
    { missionId: 'h3', goal: 'Data analysis for marketing', success: true, duration: 90000, score: 95 },
    { missionId: 'h4', goal: 'Deploy production update', success: false, duration: 500000, score: 25 },
  ];

  beforeEach(() => {
    engine = new SimulationEngine(mockBus as any);
  });

  it('should produce complete simulation result with history', async () => {
    const result = await engine.simulate(mockMission, mockPlan, history);

    expect(result.missionId).toBe('mis_sim_test');
    expect(result.status).toBe('simulated');
    expect(result.successProbability).toBeGreaterThan(0);
    expect(result.expectedCost).toBeGreaterThan(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
    expect(result.estimatedDuration).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.riskFactors.length).toBeGreaterThan(0);
    expect(['approve', 'reject', 'review']).toContain(result.suggestion);
    expect(result.simulatedAt).toBeGreaterThan(0);
  });

  it('should produce result without history', async () => {
    const result = await engine.simulate(mockMission, mockPlan);

    expect(result.status).toBe('simulated');
    expect(result.successProbability).toBeGreaterThan(0);
  });

  it('should support simple simulation', async () => {
    const result = await engine.simulateSimple(mockPlan);

    expect(result.status).toBe('simulated');
    expect(result.confidence).toBe(0.4); // default for simple
  });

  it('should suggest approve for low-risk high-success with history', async () => {
    const safeMission: Mission = {
      ...mockMission,
      id: 'mis_safe',
      goal: 'Simple read task',
    };
    const safePlan: MissionPlan = {
      ...mockPlan,
      missionId: 'mis_safe',
      steps: [{ id: 's1', name: 'Read', description: '', domain: 'read', agentType: 'reader', deps: [], priority: 1 }],
      estimatedDuration: 5000,
      riskLevel: 'low',
    };

    // With history showing 100% success on similar tasks
    const goodHistory = [
      { missionId: 'h1', goal: 'Simple read task A', success: true, duration: 3000, score: 99 },
      { missionId: 'h2', goal: 'Simple read task B', success: true, duration: 4000, score: 98 },
      { missionId: 'h3', goal: 'Simple read task C', success: true, duration: 5000, score: 97 },
      { missionId: 'h4', goal: 'Simple read task D', success: true, duration: 3500, score: 100 },
    ];

    const result = await engine.simulate(safeMission, safePlan, goodHistory);
    expect(['approve', 'review']).toContain(result.suggestion);
  });

  it('should expose submodules', () => {
    const twin = engine.getTwin();
    expect(twin).toBeDefined();
    expect(twin.health().ok).toBe(true);

    const planSim = engine.getPlanSimulator();
    expect(planSim).toBeDefined();
    expect(planSim.health().ok).toBe(true);
  });

  it('should expose health check', () => {
    const health = engine.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('SimulationEngine');
    expect(Object.keys(health.submodules)).toHaveLength(5);
  });
});
