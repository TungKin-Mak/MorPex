/**
 * ViolationDetector — 违规/偏差检测器
 *
 * MorPex v10: 检测预期轨迹与实际运行轨迹之间的偏差。
 *
 * 偏差分类:
 *   INPUT_MISMATCH    — 实际输入与预期不一致
 *   OUTPUT_MISMATCH   — 实际输出与预期不一致
 *   TIMEOUT           — 执行超时
 *   MISSING_STEP      — 预期步骤未执行
 *   UNEXPECTED_STEP   — 执行了预期外的步骤
 *   QUALITY_VIOLATION — 质量评分低于阈值
 */

import type { ExpectedTrace, RuntimeTrace, Violation, ComparisonResult, Grade } from './types.js';

// ── ViolationDetector ──

export class ViolationDetector {
  /**
   * detect — 从比对结果中检测违规
   *
   * @param expected - 预期轨迹
   * @param actual - 运行时轨迹
   * @param comparisonResults - 轨迹比对结果
   * @param qualityGrade - 质量等级（可选）
   * @returns Violation[] — 违规列表
   */
  detect(
    expected: ExpectedTrace,
    actual: RuntimeTrace,
    comparisonResults: ComparisonResult[],
    qualityGrade?: Grade
  ): Violation[] {
    const violations: Violation[] = [];

    for (const result of comparisonResults) {
      // 1. MISSING_STEP
      if (result.completeness === 0 && result.accuracy === 0 && !this.stepExistsInActual(result.stepId, actual)) {
        violations.push({
          type: 'MISSING_STEP',
          stepId: result.stepId,
          severity: 'critical',
          message: `Expected step "${result.name}" was not executed`,
          expected: { name: result.name },
          actual: undefined,
        });
        continue;
      }

      // 2. UNEXPECTED_STEP
      if (!this.stepExistsInExpected(result.stepId, expected)) {
        violations.push({
          type: 'UNEXPECTED_STEP',
          stepId: result.stepId,
          severity: 'major',
          message: `Unexpected step "${result.name}" was executed but not in plan`,
          expected: undefined,
          actual: { name: result.name },
        });
        continue;
      }

      // 3. TIMEOUT
      if (result.efficiency < 0.3 && result.issues.some(i => i.toLowerCase().includes('timeout') || i.toLowerCase().includes('inefficient'))) {
        violations.push({
          type: 'TIMEOUT',
          stepId: result.stepId,
          severity: 'major',
          message: `Step "${result.name}" exceeded time constraints (efficiency=${result.efficiency.toFixed(2)})`,
          expected: { minEfficiency: 0.3 },
          actual: { efficiency: result.efficiency },
        });
      }

      // 4. OUTPUT_MISMATCH
      if (result.accuracy < 0.7 && result.completeness > 0) {
        violations.push({
          type: 'OUTPUT_MISMATCH',
          stepId: result.stepId,
          severity: result.accuracy < 0.3 ? 'critical' : 'major',
          message: `Output mismatch for step "${result.name}" (accuracy=${result.accuracy.toFixed(2)})`,
          expected: { minAccuracy: 0.7 },
          actual: { accuracy: result.accuracy },
        });
      }
    }

    // 5. QUALITY_VIOLATION
    if (qualityGrade === 'D') {
      violations.push({
        type: 'QUALITY_VIOLATION',
        stepId: '__overall__',
        severity: 'critical',
        message: `Overall quality grade D — mission requires review`,
        expected: { minGrade: 'C' },
        actual: { grade: qualityGrade },
      });
    } else if (qualityGrade === 'C') {
      violations.push({
        type: 'QUALITY_VIOLATION',
        stepId: '__overall__',
        severity: 'minor',
        message: `Overall quality grade C — some improvements needed`,
        expected: { minGrade: 'B' },
        actual: { grade: qualityGrade },
      });
    }

    // 6. 整体耗时检查
    if (expected.timingConstraints?.maxDurationMs && actual.totalDuration > expected.timingConstraints.maxDurationMs) {
      violations.push({
        type: 'TIMEOUT',
        stepId: '__overall__',
        severity: 'major',
        message: `Total execution time ${actual.totalDuration}ms exceeds limit ${expected.timingConstraints.maxDurationMs}ms`,
        expected: { maxDurationMs: expected.timingConstraints.maxDurationMs },
        actual: { totalDuration: actual.totalDuration },
      });
    }

    return violations;
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'ViolationDetector',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  private stepExistsInActual(stepId: string, actual: RuntimeTrace): boolean {
    return actual.steps.some(s => s.stepId === stepId);
  }

  private stepExistsInExpected(stepId: string, expected: ExpectedTrace): boolean {
    return expected.steps.some(s => s.stepId === stepId);
  }
}
