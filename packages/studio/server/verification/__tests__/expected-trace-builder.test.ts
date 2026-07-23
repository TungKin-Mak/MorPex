/**
 * ExpectedTraceBuilder — 测试
 */
import { describe, it, expect } from 'vitest';
import { ExpectedTraceBuilder } from '../expected-trace-builder.js';
import type { MissionPlan, PlanStep } from '../../../../core/src/runtime/mission/types.js';

describe('ExpectedTraceBuilder', () => {
  const builder = new ExpectedTraceBuilder();

  const mockSteps: PlanStep[] = [
    { id: 'step_1', name: 'Analyze request', description: '分析用户请求', domain: 'cognition', agentType: 'analyst', deps: [], priority: 1 },
    { id: 'step_2', name: 'Generate plan', description: '生成执行计划', domain: 'planning', agentType: 'planner', deps: ['step_1'], priority: 2 },
    { id: 'step_3', name: 'Execute', description: '执行计划', domain: 'execution', agentType: 'executor', deps: ['step_2'], priority: 3 },
  ];

  const mockPlan: MissionPlan = {
    id: 'plan_test_1',
    missionId: 'mis_test_1',
    steps: mockSteps,
    estimatedDuration: 120_000,
    riskLevel: 'low',
    reasoning: 'Standard execution flow',
  };

  it('should build expected trace from MissionPlan', () => {
    const trace = builder.build(mockPlan);

    expect(trace.missionId).toBe('mis_test_1');
    expect(trace.steps).toHaveLength(3);
    expect(trace.timingConstraints).toBeDefined();
    expect(trace.timingConstraints!.maxDurationMs).toBe(120_000);
    expect(trace.qualityThresholds).toBeDefined();
    expect(trace.qualityThresholds!.minScore).toBe(60);
  });

  it('should include constraints for each step', () => {
    const trace = builder.build(mockPlan);

    expect(trace.steps[0].constraints).toContain('domain:cognition');
    expect(trace.steps[0].constraints).toContain('agentType:analyst');
    expect(trace.steps[1].constraints).toContain('dependsOn:step_1');
  });

  it('should build from steps directly', () => {
    const trace = builder.buildFromSteps('mis_test_2', mockSteps);

    expect(trace.missionId).toBe('mis_test_2');
    expect(trace.steps).toHaveLength(3);
    // buildFromSteps uses default timing
    expect(trace.timingConstraints!.maxDurationMs).toBe(300_000);
  });

  it('should handle empty steps', () => {
    const emptyPlan: MissionPlan = {
      id: 'plan_empty',
      missionId: 'mis_empty',
      steps: [],
      estimatedDuration: 0,
      riskLevel: 'low',
      reasoning: 'Empty plan',
    };

    const trace = builder.build(emptyPlan);
    expect(trace.steps).toHaveLength(0);
  });

  it('should expose health check', () => {
    const health = builder.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('ExpectedTraceBuilder');
    expect(health.uptime).toBeGreaterThan(0);
  });
});
