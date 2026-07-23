/**
 * ExpectedTraceBuilder — 预期执行轨迹构建器
 *
 * MorPex v10: 从 MissionPlan 构建预期执行轨迹。
 * 预期轨迹用于后续与运行时轨迹的比对，以评估执行质量。
 *
 * 输入: MissionPlan（来自 MissionRuntime）
 * 输出: ExpectedTrace（含步骤列表、时序约束、质量阈值）
 */

import type { MissionPlan, PlanStep } from '../../../core/src/runtime/mission/types.js';
import type { ExpectedTrace, ExpectedStep, TimingConstraints, QualityThresholds } from './types.js';

// ── 默认常量 ──

const DEFAULT_MAX_MISSION_DURATION_MS = 300_000;  // 5 分钟
const DEFAULT_MAX_STEP_DURATION_MS = 60_000;      // 1 分钟
const DEFAULT_MIN_SCORE = 60;

// ── ExpectedTraceBuilder ──

export class ExpectedTraceBuilder {
  private maxMissionDuration: number;
  private maxStepDuration: number;
  private minQualityScore: number;

  constructor(config?: {
    maxMissionDuration?: number;
    maxStepDuration?: number;
    minQualityScore?: number;
  }) {
    this.maxMissionDuration = config?.maxMissionDuration ?? DEFAULT_MAX_MISSION_DURATION_MS;
    this.maxStepDuration = config?.maxStepDuration ?? DEFAULT_MAX_STEP_DURATION_MS;
    this.minQualityScore = config?.minQualityScore ?? DEFAULT_MIN_SCORE;
  }

  /**
   * build — 从 MissionPlan 构建预期轨迹
   *
   * @param plan - MissionPlan（由 Planner 生成）
   * @returns ExpectedTrace
   */
  build(plan: MissionPlan): ExpectedTrace {
    const steps: ExpectedStep[] = plan.steps.map((step: PlanStep) => this.buildExpectedStep(step));

    const timingConstraints: TimingConstraints = {
      maxDurationMs: plan.estimatedDuration || this.maxMissionDuration,
      maxStepDurationMs: this.maxStepDuration,
    };

    const qualityThresholds: QualityThresholds = {
      minScore: this.minQualityScore,
      requiredChecks: ['completeness', 'accuracy', 'efficiency'],
    };

    return {
      missionId: plan.missionId,
      steps,
      timingConstraints,
      qualityThresholds,
    };
  }

  /**
   * buildFromSteps — 直接从 PlanStep[] 构建（适用于无完整 MissionPlan 场景）
   */
  buildFromSteps(missionId: string, steps: PlanStep[]): ExpectedTrace {
    return {
      missionId,
      steps: steps.map(s => this.buildExpectedStep(s)),
      timingConstraints: {
        maxDurationMs: this.maxMissionDuration,
        maxStepDurationMs: this.maxStepDuration,
      },
      qualityThresholds: {
        minScore: this.minQualityScore,
        requiredChecks: ['completeness', 'accuracy', 'efficiency'],
      },
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'ExpectedTraceBuilder',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  private buildExpectedStep(step: PlanStep): ExpectedStep {
    const expected: ExpectedStep = {
      stepId: step.id,
      name: step.name,
    };

    // 从 step 描述中推断预期输入/输出约束
    expected.constraints = [
      `domain:${step.domain}`,
      `agentType:${step.agentType}`,
      `priority:${step.priority}`,
    ];

    // 如果有依赖，加入依赖约束
    if (step.deps && step.deps.length > 0) {
      expected.constraints.push(`dependsOn:${step.deps.join(',')}`);
    }

    return expected;
  }
}
