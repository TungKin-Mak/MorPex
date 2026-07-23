/**
 * TraceComparator — 轨迹比较器
 *
 * MorPex v10: 比较 ExpectedTrace 与 RuntimeTrace 的差异。
 * 每个步骤从三个维度评分:
 *   - completeness (0-1): 步骤是否按预期完成
 *   - accuracy (0-1): 实际输出与预期输出的一致程度
 *   - efficiency (0-1): 执行效率是否满足时序约束
 *
 * 输出 ComparisonResult[] 供 QualityScore 聚合。
 */

import type { ExpectedTrace, RuntimeTrace, ComparisonResult, RuntimeStep, ExpectedStep } from './types.js';

// ── TraceComparator ──

export class TraceComparator {
  /**
   * compare — 比较预期轨迹与运行时轨迹
   *
   * @param expected - 预期轨迹
   * @param actual - 运行时轨迹
   * @returns ComparisonResult[] — 每个步骤的比对结果
   */
  compare(expected: ExpectedTrace, actual: RuntimeTrace): ComparisonResult[] {
    const results: ComparisonResult[] = [];
    const expectedStepMap = new Map(expected.steps.map(s => [s.stepId, s]));

    // 1. 遍历实际步骤，与预期步骤比对
    for (const actualStep of actual.steps) {
      const expectedStep = expectedStepMap.get(actualStep.stepId);
      if (expectedStep) {
        results.push(this.compareStep(expectedStep, actualStep));
        expectedStepMap.delete(actualStep.stepId); // 已匹配，移除
      } else {
        // 实际执行了预期中没有的步骤
        results.push({
          stepId: actualStep.stepId,
          name: actualStep.stepId,
          completeness: 0,
          accuracy: 0,
          efficiency: actualStep.duration > 0 ? 0.5 : 0,
          issues: [`Unexpected step: ${actualStep.stepId} — not in expected trace`],
          matched: false,
        });
      }
    }

    // 2. 预期中有但实际未执行的步骤（MISSING）
    for (const [_, expectedStep] of expectedStepMap) {
      results.push({
        stepId: expectedStep.stepId,
        name: expectedStep.name,
        completeness: 0,
        accuracy: 0,
        efficiency: 0,
        issues: [`Missing step: ${expectedStep.name} (${expectedStep.stepId}) was not executed`],
        matched: false,
      });
    }

    return results;
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'TraceComparator',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  private compareStep(expected: ExpectedStep, actual: RuntimeStep): ComparisonResult {
    const issues: string[] = [];

    // completeness: 检查步骤是否成功完成
    let completeness = 0;
    if (actual.status === 'success') {
      completeness = 1;
    } else if (actual.status === 'failed') {
      completeness = 0;
      issues.push(`Step failed: ${actual.error || 'Unknown error'}`);
    } else {
      // skipped
      completeness = 0;
      issues.push('Step was skipped');
    }

    // accuracy: 检查输出一致性
    let accuracy = 0.5; // 默认中等
    if (actual.status === 'success') {
      if (expected.expectedOutput && actual.actualOutput) {
        accuracy = this.compareOutputs(expected.expectedOutput, actual.actualOutput);
        if (accuracy < 0.7) {
          issues.push(`Output mismatch (accuracy=${accuracy.toFixed(2)})`);
        }
      } else if (!expected.expectedOutput) {
        // 无预期输出约束，认为准确
        accuracy = 1;
      } else {
        // 有预期但无实际输出
        accuracy = 0;
        issues.push('Expected output not produced');
      }
    }

    // efficiency: 检查执行时长
    let efficiency = 1;
    const maxDuration = expected.maxDuration;
    if (maxDuration && maxDuration > 0) {
      if (actual.duration > maxDuration) {
        efficiency = Math.max(0, 1 - (actual.duration - maxDuration) / maxDuration);
        issues.push(`Timeout: took ${actual.duration}ms (max ${maxDuration}ms)`);
      }
    } else {
      // 无约束，效率基于相对时间
      efficiency = actual.duration > 0 ? Math.min(1, 5000 / actual.duration) : 0.5;
      if (efficiency < 0.3) {
        issues.push(`Inefficient execution: ${actual.duration}ms`);
      }
    }

    // 总体匹配度
    const matched = completeness >= 0.8 && accuracy >= 0.7;

    return {
      stepId: expected.stepId,
      name: expected.name,
      completeness: Math.round(completeness * 100) / 100,
      accuracy: Math.round(accuracy * 100) / 100,
      efficiency: Math.round(efficiency * 100) / 100,
      issues,
      matched,
    };
  }

  /**
   * compareOutputs — 比较两个输出对象的一致性
   * 简单比较：递归检查字段存在性和原始值相等性
   */
  private compareOutputs(expected: Record<string, unknown>, actual: Record<string, unknown>): number {
    const expectedKeys = Object.keys(expected);
    if (expectedKeys.length === 0) return 1;

    let matchCount = 0;
    for (const key of expectedKeys) {
      const expVal = expected[key];
      const actVal = actual[key];

      if (actVal === undefined || actVal === null) {
        continue; // 期望的字段不存在
      }

      if (typeof expVal === 'object' && expVal !== null && typeof actVal === 'object' && actVal !== null) {
        // 递归比较嵌套对象
        const nestedScore = this.compareOutputs(
          expVal as Record<string, unknown>,
          actVal as Record<string, unknown>
        );
        if (nestedScore >= 0.8) matchCount++;
      } else if (expVal === actVal) {
        matchCount++;
      } else if (typeof expVal === 'string' && typeof actVal === 'string') {
        // 字符串部分匹配（关键词匹配）
        const expWords = (expVal as string).toLowerCase().split(/\s+/);
        const actWords = (actVal as string).toLowerCase().split(/\s+/);
        const common = expWords.filter(w => actWords.includes(w));
        if (common.length / expWords.length >= 0.5) matchCount++;
      }
    }

    return matchCount / expectedKeys.length;
  }
}
