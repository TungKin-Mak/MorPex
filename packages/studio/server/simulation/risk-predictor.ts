/**
 * RiskPredictor — 风险预测器
 *
 * MorPex v10: 基于 Mission Plan 和孪生画像预测风险。
 * 综合分析：复杂度、历史成功率、目标领域、执行时长。
 */

import type { RiskPrediction, RiskFactor, SimulationTwinProfile } from './types.js';
import type { MissionPlan } from '../../../core/src/runtime/mission/types.js';

// ── 风险权重 ──

const DEFAULT_WEIGHTS = {
  complexity: 0.25,
  duration: 0.2,
  history: 0.3,
  goal: 0.25,
};

// ── RiskPredictor ──

export class RiskPredictor {
  private weights: typeof DEFAULT_WEIGHTS;

  constructor(config?: { riskWeights?: typeof DEFAULT_WEIGHTS }) {
    this.weights = config?.riskWeights ?? DEFAULT_WEIGHTS;
  }

  /**
   * predict — 预测风险
   *
   * @param plan - MissionPlan
   * @param twinProfile - 仿真孪生画像
   * @returns RiskPrediction
   */
  predict(plan: MissionPlan, twinProfile?: SimulationTwinProfile): RiskPrediction {
    const factors: RiskFactor[] = [];
    const mitigations: string[] = [];

    // 1. 复杂度风险评估
    const complexityScore = this.assessComplexity(plan);
    factors.push({
      name: '复杂度',
      score: complexityScore,
      weight: this.weights.complexity,
      detail: `${plan.steps.length} 个步骤, ${plan.steps.reduce((s, st) => s + st.deps.length, 0)} 个依赖关系`,
    });

    // 2. 时长风险评估
    const durationScore = this.assessDuration(plan, twinProfile);
    factors.push({
      name: '执行时长',
      score: durationScore,
      weight: this.weights.duration,
      detail: `预估 ${Math.round(plan.estimatedDuration / 1000)}s`,
    });

    // 3. 历史风险评估
    const historyScore = this.assessHistory(twinProfile);
    factors.push({
      name: '历史表现',
      score: historyScore,
      weight: this.weights.history,
      detail: twinProfile
        ? `历史成功率 ${Math.round(twinProfile.historicalSuccessRate * 100)}%, ${twinProfile.similarMissions.length} 条参考`
        : '无历史参考数据',
    });

    // 4. 目标风险评估
    const goalScore = this.assessGoal(plan);
    factors.push({
      name: '目标风险',
      score: goalScore,
      weight: this.weights.goal,
      detail: `风险等级: ${plan.riskLevel}`,
    });

    // 计算加权总分
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    const weightedScore = totalWeight > 0
      ? factors.reduce((s, f) => s + f.score * f.weight / totalWeight, 0)
      : 0;

    const overallRisk = this.scoreToLevel(weightedScore);
    const overallScore = Math.round(weightedScore);

    // 缓解措施
    if (complexityScore > 60) mitigations.push('考虑简化步骤或拆分为子任务');
    if (durationScore > 60) mitigations.push('设置更短的超时阈值并启用检查点');
    if (historyScore > 60 && twinProfile) mitigations.push('参考历史失败模式并调整计划');
    if (overallScore > 70) mitigations.push('建议人工审批后再执行');

    return {
      overallRisk,
      score: overallScore,
      factors,
      mitigations,
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'RiskPredictor',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  private assessComplexity(plan: MissionPlan): number {
    const steps = plan.steps.length;
    const deps = plan.steps.reduce((s, st) => s + st.deps.length, 0);

    // 步骤数评分：5+步骤为高风险
    const stepScore = Math.min(100, (steps / 10) * 100);
    // 依赖复杂度评分
    const depScore = steps > 0 ? Math.min(100, (deps / steps) * 100) : 0;

    return Math.round(stepScore * 0.5 + depScore * 0.5);
  }

  private assessDuration(plan: MissionPlan, twinProfile?: SimulationTwinProfile): number {
    const estDuration = plan.estimatedDuration;

    // 5分钟以下低风险，30分钟以上高风险
    const durationScore = Math.min(100, (estDuration / 1_800_000) * 100);

    // 如果孪生数据表明平均耗时更长，调整
    if (twinProfile && twinProfile.historicalAvgDuration > 0) {
      const ratio = estDuration / twinProfile.historicalAvgDuration;
      if (ratio < 0.5) return Math.round(durationScore * 0.8); // 低估了
      if (ratio > 2) return Math.round(Math.min(100, durationScore * 1.2)); // 高估了
    }

    return Math.round(durationScore);
  }

  private assessHistory(twinProfile?: SimulationTwinProfile): number {
    if (!twinProfile || twinProfile.similarMissions.length === 0) {
      return 50; // 无历史数据，默认中等风险
    }

    const successRate = twinProfile.historicalSuccessRate;
    // 成功率越低，风险越高
    return Math.round((1 - successRate) * 100);
  }

  private assessGoal(plan: MissionPlan): number {
    const riskMap: Record<string, number> = {
      low: 10,
      medium: 40,
      high: 70,
      critical: 95,
    };
    return riskMap[plan.riskLevel] ?? 40;
  }

  private scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score < 20) return 'low';
    if (score < 50) return 'medium';
    if (score < 75) return 'high';
    return 'critical';
  }
}
