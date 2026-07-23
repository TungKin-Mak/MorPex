/**
 * QualityScoreEngine — 测试 (蓝图 §6 五维公式)
 */
import { describe, it, expect } from 'vitest';
import { QualityScoreEngine } from '../quality-score.js';
import type { ComparisonResult } from '../types.js';

describe('QualityScoreEngine', () => {
  const engine = new QualityScoreEngine();

  const perfectResults: ComparisonResult[] = [
    { stepId: 'step_1', name: 'Analyze', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true, policy: 1, artifactQuality: 1, recovery: 1 },
    { stepId: 'step_2', name: 'Plan', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true, policy: 1, artifactQuality: 1, recovery: 1 },
    { stepId: 'step_3', name: 'Execute', completeness: 1, accuracy: 1, efficiency: 1, issues: [], matched: true, policy: 1, artifactQuality: 1, recovery: 1 },
  ];

  const poorResults: ComparisonResult[] = [
    { stepId: 'step_1', name: 'Analyze', completeness: 0, accuracy: 0, efficiency: 0, issues: ['Failed'], matched: false, policy: 0.2, artifactQuality: 0, recovery: 0.1 },
    { stepId: 'step_2', name: 'Plan', completeness: 1, accuracy: 0.5, efficiency: 0.3, issues: ['Slow'], matched: false, policy: 0.6, artifactQuality: 0.4, recovery: 0.2 },
  ];

  const mixedResults: ComparisonResult[] = [
    { stepId: 'step_1', name: 'Analyze', completeness: 1, accuracy: 0.9, efficiency: 1, issues: [], matched: true, policy: 1, artifactQuality: 0.9, recovery: 1 },
    { stepId: 'step_2', name: 'Plan', completeness: 1, accuracy: 0.8, efficiency: 0.7, issues: ['Minor delay'], matched: true, policy: 0.9, artifactQuality: 0.8, recovery: 0.8 },
    { stepId: 'step_3', name: 'Execute', completeness: 0, accuracy: 0, efficiency: 0, issues: ['Failed'], matched: false, policy: 0.5, artifactQuality: 0, recovery: 0.2 },
  ];

  it('should give A grade for perfect execution (蓝图五维)', () => {
    const result = engine.score('mis_test_1', perfectResults);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe('A');
  });

  it('should give D grade for poor execution', () => {
    const result = engine.score('mis_test_1', poorResults);
    expect(result.score).toBeLessThan(50);
    expect(result.grade).toBe('D');
  });

  it('should give C or B for mixed results', () => {
    const result = engine.score('mis_test_1', mixedResults);
    // executionCorrectness=(1+1+0)/3=0.667
    // policy=(1+0.9+0.5)/3=0.8
    // artifactQuality=(0.9+0.8+0)/3=0.567
    // efficiency=(1+0.7+0)/3=0.567
    // recovery=(1+0.8+0.2)/3=0.667
    // weighted: 0.667*0.3 + 0.8*0.2 + 0.567*0.2 + 0.567*0.15 + 0.667*0.15
    // = 0.200 + 0.160 + 0.113 + 0.085 + 0.100 = 0.658
    // score: 66 → C
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.grade).toBe('C');
  });

  it('should handle empty results', () => {
    const result = engine.score('mis_empty', []);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('D');
  });

  it('should include detailed step scores with 5 dimensions', () => {
    const result = engine.score('mis_test_1', perfectResults);
    expect(result.details.stepScores).toHaveLength(3);
    expect(result.details.executionCorrectnessScore).toBe(1);
    expect(result.details.policyComplianceScore).toBe(1);
    expect(result.details.artifactQualityScore).toBe(1);
    expect(result.details.efficiencyScore).toBe(1);
    expect(result.details.recoveryCapabilityScore).toBe(1);
  });

  it('should accept extras for external policy/artifact/recovery scores', () => {
    const result = engine.score('mis_test_1', perfectResults, {
      policyScore: 0.5,
      artifactQualityScore: 0.6,
      recoveryScore: 0.4,
    });
    // exec=1*0.3 + policy=0.5*0.2 + artifact=0.6*0.2 + efficiency=1*0.15 + recovery=0.4*0.15
    // = 0.3 + 0.1 + 0.12 + 0.15 + 0.06 = 0.73 → 73 → C (B requires >=75)
    expect(result.score).toBe(73);
    expect(result.grade).toBe('C');
  });

  it('should normalize weights that do not sum to 1', () => {
    const customEngine = new QualityScoreEngine({
      executionCorrectnessWeight: 2,
      policyComplianceWeight: 2,
      artifactQualityWeight: 2,
      efficiencyWeight: 2,
      recoveryCapabilityWeight: 2,
    });
    // After normalization: each = 2/10 = 0.2
    const result = customEngine.score('mis_test_1', perfectResults);
    expect(result.score).toBe(100);
  });

  it('should expose health check', () => {
    const health = engine.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('QualityScoreEngine');
  });
});
