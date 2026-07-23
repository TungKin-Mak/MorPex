/**
 * SuccessPredictor — 成功率预测器
 *
 * MorPex v10: 基于历史数据和计划特征预测 Mission 执行成功率。
 * 因子：历史成功率、复杂度、风险等级、步骤完整性
 */

import type { SuccessPrediction, SimulationTwinProfile } from './types.js';
import type { MissionPlan } from '../../../core/src/runtime/mission/types.js';

// ── SuccessPredictor ──

export class SuccessPredictor {
  /**
   * predict — 预测成功率
   *
   * @param plan - MissionPlan
   * @param twinProfile - 仿真孪生画像
   * @returns SuccessPrediction
   */
  predict(plan: MissionPlan, twinProfile?: SimulationTwinProfile): SuccessPrediction {
    const factors: { name: string; impact: number; detail: string }[] = [];
    let baseProbability = 50; // 基准 50%

    // 1. 历史成功率因子
    if (twinProfile && twinProfile.similarMissions.length > 0) {
      const historyImpact = Math.round((twinProfile.historicalSuccessRate - 0.5) * 100);
      baseProbability += historyImpact * 0.4;
      factors.push({
        name: '历史成功率',
        impact: Math.round(historyImpact * 0.4),
        detail: `${Math.round(twinProfile.historicalSuccessRate * 100)}% (${twinProfile.similarMissions.length} 条参考)`,
      });
    } else {
      factors.push({
        name: '历史成功率',
        impact: 0,
        detail: '无历史参考数据，使用默认值',
      });
    }

    // 2. 步骤复杂度因子
    const steps = plan.steps.length;
    if (steps > 0) {
      const complexityImpact = Math.max(-30, 10 - steps * 5);
      baseProbability += complexityImpact;
      factors.push({
        name: '步骤复杂度',
        impact: complexityImpact,
        detail: `${steps} 个步骤`,
      });
    }

    // 3. 依赖复杂度因子
    const depCount = plan.steps.reduce((s, st) => s + st.deps.length, 0);
    if (steps > 0) {
      const avgDeps = depCount / steps;
      const depImpact = Math.max(-20, -avgDeps * 8);
      baseProbability += depImpact;
      factors.push({
        name: '依赖复杂度',
        impact: Math.round(depImpact),
        detail: `平均 ${avgDeps.toFixed(1)} 个依赖/步骤`,
      });
    }

    // 4. 风险等级因子
    const riskImpactMap: Record<string, number> = {
      low: 10,
      medium: 0,
      high: -15,
      critical: -30,
    };
    const riskImpact = riskImpactMap[plan.riskLevel] ?? 0;
    baseProbability += riskImpact;
    factors.push({
      name: '风险等级',
      impact: riskImpact,
      detail: `风险: ${plan.riskLevel}`,
    });

    // 限制范围
    const probability = Math.max(5, Math.min(99, Math.round(baseProbability)));

    // 置信度
    const hasTwin = twinProfile && twinProfile.similarMissions.length > 0;
    const confidence = hasTwin
      ? Math.min(0.95, 0.5 + twinProfile!.similarMissions.length * 0.05)
      : 0.4;

    return {
      probability,
      confidence: Math.round(confidence * 100) / 100,
      factors,
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'SuccessPredictor',
      uptime: Date.now(),
    };
  }
}
