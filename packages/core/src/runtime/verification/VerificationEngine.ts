/**
 * VerificationEngine — 验证引擎
 *
 * Phase 4 / MorPex v8: 验证 Mission 执行结果的完整性、正确性。
 *
 * 使用场景：
 *   MissionRuntime 在 MissionState.VERIFYING 阶段调用 verify()
 *   验证完成后根据结果决定进入 COMPLETED 或 FAILED
 *
 * 标准验证点：
 *   1. step_completion   — 计划中所有步骤是否都完成（weight: 0.4）
 *   2. output_presence   — 是否产生了输出（weight: 0.3）
 *   3. error_absence     — 是否有未处理的错误（weight: 0.2）
 *   4. artifact_integrity — 预期产物是否创建（weight: 0.1）
 *
 * 设计原则：
 *   - 纯函数式验证：同一个 Mission+Result 总是产生相同的 VerificationResult
 *   - 可扩展：通过继承或组合添加自定义验证点
 *   - 无副作用：不发射事件、不修改状态
 */

import type { Mission, MissionPlan, MissionResult, PlanStep } from '../mission/types.js';
import type { VerificationResult, VerificationCheck, VerificationIssue, VerificationEngineConfig } from './types.js';

// ── 默认配置常量 ──

const DEFAULT_CONFIG: Required<VerificationEngineConfig> = {
  stepCompletionWeight: 0.4,
  outputPresenceWeight: 0.3,
  errorCheckWeight: 0.2,
  artifactCheckWeight: 0.1,
  enableGoalAlignment: false,
};

// ── VerificationEngine ──

export class VerificationEngine {
  private config: Required<VerificationEngineConfig>;

  constructor(config?: VerificationEngineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * verify — 验证 Mission 执行结果
   *
   * 运行所有启用的验证点，汇总评分。
   * 不发射事件，不修改状态。调用方（MissionRuntime）根据结果决定下一步。
   *
   * @param mission - 已执行的 Mission
   * @param result  - Mission 执行结果
   * @returns VerificationResult
   */
  async verify(mission: Mission, result: MissionResult): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const issues: VerificationIssue[] = [];

    // 1. 步骤完成度检查
    const stepResult = this.checkStepCompletion(mission.plan, result);
    checks.push(stepResult.check);
    issues.push(...stepResult.issues);

    // 2. 输出存在性检查
    const outputResult = this.checkOutputPresence(result);
    checks.push(outputResult.check);
    issues.push(...outputResult.issues);

    // 3. 错误检查
    const errorResult = this.checkErrorAbsence(result);
    checks.push(errorResult.check);
    issues.push(...errorResult.issues);

    // 4. 产物完整性检查
    const artifactResult = this.checkArtifactIntegrity(result);
    checks.push(artifactResult.check);
    issues.push(...artifactResult.issues);

    // 5. 计算加权总分
    const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
    const weightedScore = totalWeight > 0
      ? Math.round(
          (checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0) / totalWeight) * 100
        )
      : 0;

    // passed = 没有 error 级 issue
    const passed = issues.filter(i => i.severity === 'error').length === 0;
    const errorCount = issues.filter(i => i.severity === 'error').length;

    return {
      missionId: mission.id,
      passed,
      score: weightedScore,
      checks,
      issues,
      summary: this.buildSummary(passed, errorCount, weightedScore),
      verifiedAt: Date.now(),
    };
  }

  /**
   * verifyArtifact — v8.8: 验证产物是否符合合约
   *
   * 在 ExecutionStage 后执行，确保 Agent 产生的产物满足:
   *   1. outputSchema — 所有必填字段都存在
   *   2. successCriteria — 质量指标达到阈值
   *
   * 此方法在 MissionRuntime.verify() 之后额外调用，
   * 专注产物级别的验证（而非 Mission 级别）。
   *
   * @param artifact - 待验证的产物
   * @param contract - 产物对应的合约
   * @returns 验证结果
   */
  async verifyArtifact(
    artifact: { id: string; type: string; output: unknown },
    contract: { outputSchema: Record<string, string>; successCriteria: { metric: string; threshold: number }[] },
  ): Promise<{ success: boolean; score: number; errors: string[] }> {
    const errors: string[] = []

    // 1. 检查 outputSchema
    const output = artifact.output as Record<string, unknown> | null
    if (contract.outputSchema && output) {
      for (const [field, requirement] of Object.entries(contract.outputSchema)) {
        if (requirement === 'required' && (output[field] === undefined || output[field] === null)) {
          errors.push(`Missing required output field: ${field}`)
        }
      }
    } else if (contract.outputSchema && !output) {
      errors.push('No output produced, but output schema defined')
    }

    // 2. 检查 successCriteria
    let criteriaScore = 1.0
    if (contract.successCriteria && contract.successCriteria.length > 0) {
      let metCount = 0
      for (const criterion of contract.successCriteria) {
        // 从输出中提取指标值
        const actualValue = output?.[criterion.metric]
        if (actualValue !== undefined && typeof actualValue === 'number') {
          if (actualValue >= criterion.threshold) {
            metCount++
          } else {
            errors.push(`Quality criterion "${criterion.metric}": expected >= ${criterion.threshold}, got ${actualValue}`)
          }
        } else {
          // 指标不可评估时，跳过（不报错，降分）
          criteriaScore *= 0.9
        }
      }
      criteriaScore = contract.successCriteria.length > 0
        ? (metCount / contract.successCriteria.length) * criteriaScore
        : 1.0
    }

    // 3. 综合评分: schema 权重 0.6, quality 权重 0.4
    const schemaScore = errors.filter(e => e.startsWith('Missing required')).length === 0 ? 1.0 : 0.0
    const score = Math.round((schemaScore * 0.6 + criteriaScore * 0.4) * 100) / 100

    return {
      success: errors.length === 0,
      score,
      errors,
    }
  }



  // ── 私有验证方法 ──

  /**
   * checkStepCompletion — 检查计划步骤完成度
   */
  private checkStepCompletion(
    plan: MissionPlan | undefined,
    result: MissionResult
  ): { check: VerificationCheck; issues: VerificationIssue[] } {
    const issues: VerificationIssue[] = [];

    if (!plan || !plan.steps || plan.steps.length === 0) {
      return {
        check: {
          name: 'step_completion',
          passed: result.stepsCompleted > 0 || result.stepsTotal === 0,
          detail: result.stepsTotal > 0
            ? `${result.stepsCompleted}/${result.stepsTotal} steps completed`
            : 'No steps defined in plan',
          weight: this.config.stepCompletionWeight,
        },
        issues: result.stepsCompleted === 0 && result.stepsTotal > 0
          ? [{ checkName: 'step_completion', severity: 'error', message: 'No steps completed', suggestion: 'Check executor output for failures' }]
          : [],
      };
    }

    const allCompleted = result.stepsTotal === result.stepsCompleted;

    if (!allCompleted) {
      issues.push({
        checkName: 'step_completion',
        severity: 'error',
        message: `Only ${result.stepsCompleted}/${result.stepsTotal} steps completed`,
        suggestion: `Missing ${result.stepsTotal - result.stepsCompleted} step(s). Check individual step results.`,
      });
    }

    return {
      check: {
        name: 'step_completion',
        passed: allCompleted,
        detail: `${result.stepsCompleted}/${result.stepsTotal} steps completed. Plan has ${plan.steps.length} steps defined.`,
        weight: this.config.stepCompletionWeight,
      },
      issues,
    };
  }

  /**
   * checkOutputPresence — 检查是否产生了输出
   */
  private checkOutputPresence(
    result: MissionResult
  ): { check: VerificationCheck; issues: VerificationIssue[] } {
    const issues: VerificationIssue[] = [];
    const hasOutput = result.output !== undefined && result.output !== null;

    if (!hasOutput) {
      issues.push({
        checkName: 'output_presence',
        severity: 'warning',
        message: 'No output produced',
        suggestion: 'Verify that the executor returned output. Some missions may legitimately have no output.',
      });
    }

    return {
      check: {
        name: 'output_presence',
        passed: hasOutput,
        detail: hasOutput
          ? `Output present (${typeof result.output === 'string' ? `${result.output.length} chars` : typeof result.output})`
          : 'No output produced',
        weight: this.config.outputPresenceWeight,
      },
      issues,
    };
  }

  /**
   * checkErrorAbsence — 检查是否有未处理的错误
   */
  private checkErrorAbsence(
    result: MissionResult
  ): { check: VerificationCheck; issues: VerificationIssue[] } {
    const issues: VerificationIssue[] = [];
    const hasError = !!result.error;
    const incomplete = result.stepsCompleted < result.stepsTotal;

    if (hasError) {
      issues.push({
        checkName: 'error_absence',
        severity: 'error',
        message: result.error!,
        suggestion: 'Review error details and consider replanning or retrying.',
      });
    }

    if (incomplete) {
      issues.push({
        checkName: 'error_absence',
        severity: 'info',
        message: `Execution incomplete: ${result.stepsCompleted}/${result.stepsTotal} steps`,
      });
    }

    return {
      check: {
        name: 'error_absence',
        passed: !hasError && !incomplete,
        detail: hasError
          ? `Error recorded: ${result.error!.substring(0, 100)}`
          : incomplete
            ? `${result.stepsCompleted}/${result.stepsTotal} steps completed (incomplete)`
            : 'No errors detected',
        weight: this.config.errorCheckWeight,
      },
      issues,
    };
  }

  /**
   * checkArtifactIntegrity — 检查产物完整性
   */
  private checkArtifactIntegrity(
    result: MissionResult
  ): { check: VerificationCheck; issues: VerificationIssue[] } {
    const issues: VerificationIssue[] = [];
    const artifactCount = result.artifacts?.length ?? 0;

    if (artifactCount === 0) {
      issues.push({
        checkName: 'artifact_integrity',
        severity: 'info',
        message: 'No artifacts produced',
        suggestion: 'Some missions may not produce artifacts. This is informational only.',
      });
    }

    return {
      check: {
        name: 'artifact_integrity',
        passed: artifactCount > 0,
        detail: `${artifactCount} artifact(s) produced`,
        weight: this.config.artifactCheckWeight,
      },
      issues,
    };
  }

  /**
   * buildSummary — 生成人类可读的验证摘要
   */
  private buildSummary(passed: boolean, errorCount: number, score: number): string {
    if (passed) {
      return `All checks passed (score: ${score}/100)`;
    }
    return `${errorCount} error(s) found (score: ${score}/100) — requires attention before completing`;
  }
}
