/**
 * ViolationDetector — 测试
 */
import { describe, it, expect } from 'vitest';
import { ViolationDetector } from '../violation-detector.js';
import type { ExpectedTrace, RuntimeTrace, ComparisonResult } from '../types.js';

describe('ViolationDetector', () => {
  const detector = new ViolationDetector();

  const expectedTrace: ExpectedTrace = {
    missionId: 'mis_test_1',
    steps: [
      { stepId: 'step_1', name: 'Analyze' },
      { stepId: 'step_2', name: 'Plan' },
      { stepId: 'step_3', name: 'Execute', maxDuration: 5000 },
    ],
    timingConstraints: { maxDurationMs: 30000, maxStepDurationMs: 10000 },
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

  it('should detect no violations for clean execution', () => {
    const results: ComparisonResult[] = [
      { stepId: 'step_1', name: 'Analyze', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true },
      { stepId: 'step_2', name: 'Plan', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true },
      { stepId: 'step_3', name: 'Execute', completeness: 1, accuracy: 1, efficiency: 0.8, issues: [], matched: true },
    ];

    const violations = detector.detect(expectedTrace, runtimeTrace, results, 'A');
    expect(violations.filter(v => v.severity !== 'minor')).toHaveLength(0);
  });

  it('should detect MISSING_STEP violations', () => {
    // step_2 is missing (completeness=0, accuracy=0, and not in actual)
    const results: ComparisonResult[] = [
      { stepId: 'step_1', name: 'Analyze', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true },
      { stepId: 'step_2', name: 'Plan', completeness: 0, accuracy: 0, efficiency: 0, issues: ['Missing step: Plan (step_2) was not executed'], matched: false },
      { stepId: 'step_3', name: 'Execute', completeness: 1, accuracy: 1, efficiency: 0.8, issues: [], matched: true },
    ];

    const partialRuntime: RuntimeTrace = {
      missionId: 'mis_test_1',
      steps: [
        { stepId: 'step_1', status: 'success', duration: 1000 },
        { stepId: 'step_3', status: 'success', duration: 3000 },
      ],
      totalDuration: 4000,
    };

    const violations = detector.detect(expectedTrace, partialRuntime, results, 'B');
    const missingStepViolations = violations.filter(v => v.type === 'MISSING_STEP');
    expect(missingStepViolations.length).toBeGreaterThan(0);
    expect(missingStepViolations[0].severity).toBe('critical');
  });

  it('should detect OUTPUT_MISMATCH violations', () => {
    const results: ComparisonResult[] = [
      { stepId: 'step_1', name: 'Analyze', completeness: 1, accuracy: 0.3, efficiency: 1, issues: ['Output mismatch'], matched: false },
      { stepId: 'step_2', name: 'Plan', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true },
    ];

    const violations = detector.detect(expectedTrace, runtimeTrace, results, 'B');
    const outputViolations = violations.filter(v => v.type === 'OUTPUT_MISMATCH');
    expect(outputViolations.length).toBeGreaterThan(0);
  });

  it('should detect QUALITY_VIOLATION for grade D', () => {
    const results: ComparisonResult[] = [
      { stepId: 'step_1', name: 'Analyze', completeness: 0, accuracy: 0, efficiency: 0, issues: ['Failed'], matched: false },
    ];
    const violations = detector.detect(expectedTrace, runtimeTrace, results, 'D');
    const qualityViolations = violations.filter(v => v.type === 'QUALITY_VIOLATION');
    expect(qualityViolations.length).toBeGreaterThan(0);
    expect(qualityViolations.some(v => v.severity === 'critical')).toBe(true);
  });

  it('should detect overall timeout violation', () => {
    const slowTrace: RuntimeTrace = {
      missionId: 'mis_test_1',
      steps: [
        { stepId: 'step_1', status: 'success', duration: 1000 },
        { stepId: 'step_2', status: 'success', duration: 20000 },
        { stepId: 'step_3', status: 'success', duration: 15000 },
      ],
      totalDuration: 36000, // exceeds 30000 max
    };

    const results: ComparisonResult[] = [
      { stepId: 'step_1', name: 'Analyze', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true },
      { stepId: 'step_2', name: 'Plan', completeness: 1, accuracy: 1, efficiency: 0.2, issues: ['Slow'], matched: true },
      { stepId: 'step_3', name: 'Execute', completeness: 1, accuracy: 1, efficiency: 0.5, issues: [], matched: true },
    ];

    const violations = detector.detect(expectedTrace, slowTrace, results, 'B');
    const timeoutViolations = violations.filter(v => v.type === 'TIMEOUT');
    expect(timeoutViolations.length).toBeGreaterThan(0);
  });

  it('should expose health check', () => {
    const health = detector.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('ViolationDetector');
  });
});
