/**
 * PlanSimulator — 测试
 */
import { describe, it, expect } from 'vitest';
import { PlanSimulator } from '../plan-simulator.js';
import type { MissionPlan } from '../../../../core/src/runtime/mission/types.js';

describe('PlanSimulator', () => {
  const simulator = new PlanSimulator();

  const sequentialPlan: MissionPlan = {
    id: 'plan_seq', missionId: 'mis_seq',
    steps: [
      { id: 's1', name: 'Step 1', description: '', domain: 'a', agentType: 'w', deps: [], priority: 1 },
      { id: 's2', name: 'Step 2', description: '', domain: 'a', agentType: 'w', deps: ['s1'], priority: 2 },
      { id: 's3', name: 'Step 3', description: '', domain: 'a', agentType: 'w', deps: ['s2'], priority: 3 },
      { id: 's4', name: 'Step 4', description: '', domain: 'a', agentType: 'w', deps: ['s3'], priority: 4 },
    ],
    estimatedDuration: 40000, riskLevel: 'low', reasoning: 'Sequential',
  };

  const parallelPlan: MissionPlan = {
    id: 'plan_par', missionId: 'mis_par',
    steps: [
      { id: 's1', name: 'Root', description: '', domain: 'a', agentType: 'w', deps: [], priority: 1 },
      { id: 's2', name: 'Branch A', description: '', domain: 'a', agentType: 'w', deps: ['s1'], priority: 2 },
      { id: 's3', name: 'Branch B', description: '', domain: 'a', agentType: 'w', deps: ['s1'], priority: 2 },
      { id: 's4', name: 'Merge', description: '', domain: 'a', agentType: 'w', deps: ['s2', 's3'], priority: 3 },
    ],
    estimatedDuration: 30000, riskLevel: 'low', reasoning: 'Parallel',
  };

  it('should find critical path for sequential plan', () => {
    const result = simulator.simulate(sequentialPlan);
    expect(result.criticalPath).toHaveLength(4);
    expect(result.criticalPathLength).toBe(4);
    expect(result.criticalPath[0].stepId).toBe('s1');
    expect(result.criticalPath[3].stepId).toBe('s4');
  });

  it('should detect parallelism', () => {
    const seqResult = simulator.simulate(sequentialPlan);
    const parResult = simulator.simulate(parallelPlan);

    // Parallel plan should have higher max parallelism
    expect(parResult.maxParallelism).toBeGreaterThan(seqResult.maxParallelism);
  });

  it('should detect bottlenecks for highly-depended steps', () => {
    const bottleneckPlan: MissionPlan = {
      id: 'plan_bn', missionId: 'mis_bn',
      steps: [
        { id: 'hub', name: 'Hub', description: '', domain: 'a', agentType: 'w', deps: [], priority: 1 },
        { id: 'a1', name: 'A1', description: '', domain: 'a', agentType: 'w', deps: ['hub'], priority: 2 },
        { id: 'a2', name: 'A2', description: '', domain: 'a', agentType: 'w', deps: ['hub'], priority: 2 },
        { id: 'a3', name: 'A3', description: '', domain: 'a', agentType: 'w', deps: ['hub'], priority: 2 },
        { id: 'a4', name: 'A4', description: '', domain: 'a', agentType: 'w', deps: ['hub'], priority: 2 },
      ],
      estimatedDuration: 50000, riskLevel: 'medium', reasoning: 'Hub',
    };

    const result = simulator.simulate(bottleneckPlan);
    expect(result.bottlenecks.length).toBeGreaterThan(0);
    const hubBottleneck = result.bottlenecks.find(b => b.stepId === 'hub');
    expect(hubBottleneck).toBeDefined();
  });

  it('should handle empty plan', () => {
    const emptyPlan: MissionPlan = {
      id: 'plan_empty', missionId: 'mis_empty',
      steps: [], estimatedDuration: 0, riskLevel: 'low', reasoning: '',
    };

    const result = simulator.simulate(emptyPlan);
    expect(result.criticalPath).toHaveLength(0);
    expect(result.maxParallelism).toBe(0);
  });

  it('should expose health check', () => {
    const health = simulator.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('PlanSimulator');
  });
});
