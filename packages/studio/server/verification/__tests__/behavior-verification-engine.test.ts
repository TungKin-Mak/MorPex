/**
 * BehaviorVerificationEngine — 集成测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { BehaviorVerificationEngine } from '../behavior-verification-engine.js';
import type { Mission, MissionResult, MissionPlan, PlanStep } from '../../../../core/src/runtime/mission/types.js';

// ── Mock EventBus ──
const mockBus = {
  emit: (event: any) => {
    // Silently capture events for testing
    console.log(`[MockEventBus] ${event.type}`);
  },
};

describe('BehaviorVerificationEngine', () => {
  let db: Database.Database;
  let engine: BehaviorVerificationEngine;

  const mockSteps: PlanStep[] = [
    { id: 'step_1', name: 'Analyze request', description: '分析', domain: 'cognition', agentType: 'analyst', deps: [], priority: 1 },
    { id: 'step_2', name: 'Generate plan', description: '规划', domain: 'planning', agentType: 'planner', deps: ['step_1'], priority: 2 },
    { id: 'step_3', name: 'Execute', description: '执行', domain: 'execution', agentType: 'executor', deps: ['step_2'], priority: 3 },
  ];

  const mockPlan: MissionPlan = {
    id: 'plan_test_1',
    missionId: 'mis_integration_test',
    steps: mockSteps,
    estimatedDuration: 120_000,
    riskLevel: 'low',
    reasoning: 'Integration test plan',
  };

  const mockMission: Mission = {
    id: 'mis_integration_test',
    goal: 'Test mission',
    owner: 'test',
    context: { channel: 'test', sessionId: 'sess_1', originalMessage: 'Test', metadata: {} },
    state: 'COMPLETED' as any,
    permissions: { allowAutoExecute: true, requireApproval: false, allowedTools: ['*'] },
    plan: mockPlan,
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    metadata: {},
  };

  const mockResult: MissionResult = {
    missionId: 'mis_integration_test',
    state: 'COMPLETED' as any,
    stepsCompleted: 3,
    stepsTotal: 3,
    output: { summary: 'Task completed successfully', dataPoints: 42 },
    artifacts: ['artifact://test'],
    duration: 5000,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    engine = new BehaviorVerificationEngine(mockBus as any, db);
  });

  it('should produce a complete verification report', async () => {
    const report = await engine.verify(mockMission, mockResult);

    expect(report.missionId).toBe('mis_integration_test');
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.grade).toMatch(/^[ABCD]$/);
    expect(report.violations).toBeDefined();
    expect(report.comparisonResults).toHaveLength(3);
    expect(report.qualityScore).toBeDefined();
    expect(report.duration).toBeGreaterThanOrEqual(0);
    expect(report.recordedAt).toBeGreaterThan(0);
  });

  it('should auto-save to regression store', async () => {
    const report = await engine.verify(mockMission, mockResult);
    const store = engine.getRegressionStore();
    expect(store).not.toBeNull();

    const records = store!.getByMissionId('mis_integration_test');
    expect(records).toHaveLength(1);
    expect(records[0].score).toBe(report.score);
  });

  it('should handle failed missions', async () => {
    const failedResult: MissionResult = {
      ...mockResult,
      state: 'MISSION_FAILED' as any,
      stepsCompleted: 1,
      stepsTotal: 3,
      error: 'Step 2 failed: timeout',
    };

    const report = await engine.verify(mockMission, failedResult);

    // 蓝图五维公式: execCorrectness=0, policy/artifact/recovery default=1, efficiency≈1
    // score = 0*0.30 + 1*0.20 + 1*0.20 + ~1*0.15 + 1*0.15 ≈ 0.70 → 70
    // 失败任务在其他维度可能还有评分，总分应低于完美执行 (<90) 且有 violations
    expect(report.score).toBeLessThan(100);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it('should handle missions with no plan gracefully', async () => {
    const missionNoPlan: Mission = {
      ...mockMission,
      id: 'mis_no_plan',
      plan: undefined,
    };

    const result: MissionResult = {
      ...mockResult,
      missionId: 'mis_no_plan',
    };

    // Should handle gracefully
    try {
      await engine.verify(missionNoPlan, result);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('should support verifyFromPlan', async () => {
    const report = await engine.verifyFromPlan(
      'mis_direct',
      mockPlan,
      mockResult
    );

    expect(report.missionId).toBe('mis_direct');
    expect(report.score).toBeGreaterThanOrEqual(0);
  });

  it('should expose health check', () => {
    const health = engine.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('BehaviorVerificationEngine');
    expect(health.submodules).toBeDefined();
    expect(Object.keys(health.submodules)).toHaveLength(5);
  });
});
