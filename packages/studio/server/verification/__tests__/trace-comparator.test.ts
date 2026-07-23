/**
 * TraceComparator — 测试
 */
import { describe, it, expect } from 'vitest';
import { TraceComparator } from '../trace-comparator.js';
import type { ExpectedTrace, RuntimeTrace } from '../types.js';

describe('TraceComparator', () => {
  const comparator = new TraceComparator();

  const expectedTrace: ExpectedTrace = {
    missionId: 'mis_test_1',
    steps: [
      { stepId: 'step_1', name: 'Analyze request', constraints: ['domain:cognition'] },
      { stepId: 'step_2', name: 'Generate plan', constraints: ['domain:planning', 'dependsOn:step_1'] },
      { stepId: 'step_3', name: 'Execute', constraints: ['domain:execution'], maxDuration: 5000 },
    ],
    timingConstraints: { maxDurationMs: 120_000, maxStepDurationMs: 60_000 },
    qualityThresholds: { minScore: 60, requiredChecks: ['completeness', 'accuracy', 'efficiency'] },
  };

  const runtimeTrace: RuntimeTrace = {
    missionId: 'mis_test_1',
    steps: [
      { stepId: 'step_1', status: 'success', duration: 1000 },
      { stepId: 'step_2', status: 'success', duration: 2000 },
      { stepId: 'step_3', status: 'success', duration: 3000 },
    ],
    totalDuration: 6000,
  };

  it('should return all matched results when traces align', () => {
    const results = comparator.compare(expectedTrace, runtimeTrace);

    expect(results).toHaveLength(3);
    expect(results.every(r => r.matched)).toBe(true);
    expect(results.every(r => r.completeness === 1)).toBe(true);
  });

  it('should detect missing steps', () => {
    const partialTrace: RuntimeTrace = {
      missionId: 'mis_test_1',
      steps: [
        { stepId: 'step_1', status: 'success', duration: 1000 },
        // step_2 missing
        { stepId: 'step_3', status: 'success', duration: 3000 },
      ],
      totalDuration: 4000,
    };

    const results = comparator.compare(expectedTrace, partialTrace);

    expect(results).toHaveLength(3);
    const step2Result = results.find(r => r.stepId === 'step_2');
    expect(step2Result).toBeDefined();
    expect(step2Result!.matched).toBe(false);
    expect(step2Result!.completeness).toBe(0);
    expect(step2Result!.issues.some(i => i.includes('Missing'))).toBe(true);
  });

  it('should detect unexpected steps', () => {
    const extraTrace: RuntimeTrace = {
      missionId: 'mis_test_1',
      steps: [
        { stepId: 'step_1', status: 'success', duration: 1000 },
        { stepId: 'step_2', status: 'success', duration: 2000 },
        { stepId: 'step_3', status: 'success', duration: 3000 },
        { stepId: 'step_extra', status: 'success', duration: 500 },
      ],
      totalDuration: 6500,
    };

    const results = comparator.compare(expectedTrace, extraTrace);

    expect(results).toHaveLength(4);
    const extraResult = results.find(r => r.stepId === 'step_extra');
    expect(extraResult).toBeDefined();
    expect(extraResult!.matched).toBe(false);
    expect(extraResult!.issues.some(i => i.includes('Unexpected'))).toBe(true);
  });

  it('should detect failed steps', () => {
    const failedTrace: RuntimeTrace = {
      missionId: 'mis_test_1',
      steps: [
        { stepId: 'step_1', status: 'success', duration: 1000 },
        { stepId: 'step_2', status: 'success', duration: 2000 },
        { stepId: 'step_3', status: 'failed', duration: 3000, error: 'Execution timeout' },
      ],
      totalDuration: 6000,
      error: 'Execution timeout',
    };

    const results = comparator.compare(expectedTrace, failedTrace);

    const step3Result = results.find(r => r.stepId === 'step_3');
    expect(step3Result).toBeDefined();
    expect(step3Result!.completeness).toBe(0);
    expect(step3Result!.matched).toBe(false);
    expect(step3Result!.issues.some(i => i.includes('failed'))).toBe(true);
  });

  it('should handle empty traces', () => {
    const emptyExpected: ExpectedTrace = {
      missionId: 'mis_empty',
      steps: [],
    };

    const emptyActual: RuntimeTrace = {
      missionId: 'mis_empty',
      steps: [],
      totalDuration: 0,
    };

    const results = comparator.compare(emptyExpected, emptyActual);
    expect(results).toHaveLength(0);
  });

  it('should expose health check', () => {
    const health = comparator.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('TraceComparator');
  });
});
