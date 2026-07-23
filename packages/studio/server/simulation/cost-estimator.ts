/**
 * CostEstimator — 成本预估器
 *
 * MorPex v10: 基于 Mission Plan 预估执行成本。
 * 成本 = 基础成本 + 步骤成本 * 复杂度系数 + 风险溢价
 */

import type { CostEstimate, CostBreakdownItem, SimulationTwinProfile } from './types.js';
import type { MissionPlan } from '../../../core/src/runtime/mission/types.js';

// ── 默认成本系数 ──

const BASE_COST = 10;
const COST_PER_STEP = 5;
const RISK_PREMIUM: Record<string, number> = {
  low: 1.0,
  medium: 1.5,
  high: 2.5,
  critical: 4.0,
};

// ── CostEstimator ──

export class CostEstimator {
  private costMultiplier: number;

  constructor(config?: { costMultiplier?: number }) {
    this.costMultiplier = config?.costMultiplier ?? 1.0;
  }

  /**
   * estimate — 预估执行成本
   *
   * @param plan - MissionPlan
   * @param twinProfile - 仿真孪生画像（可选，提供后更准确）
   * @returns CostEstimate
   */
  estimate(plan: MissionPlan, twinProfile?: SimulationTwinProfile): CostEstimate {
    const steps = plan.steps.length;
    const riskLevel = plan.riskLevel;
    const riskPremium = RISK_PREMIUM[riskLevel] ?? 1.0;

    // 基础成本
    const baseCost = BASE_COST * this.costMultiplier;
    const stepCost = steps * COST_PER_STEP * this.costMultiplier;

    // 复杂度系数（基于依赖关系复杂度）
    const depCount = plan.steps.reduce((sum, s) => sum + s.deps.length, 0);
    const complexityFactor = 1 + (depCount / Math.max(steps, 1)) * 0.5;

    // 历史调整
    let historyAdjustment = 1.0;
    if (twinProfile && twinProfile.historicalAvgCost > 0) {
      const historyRatio = twinProfile.historicalAvgCost / (baseCost + stepCost);
      historyAdjustment = Math.max(0.5, Math.min(2.0, historyRatio));
    }

    // 总成本
    const totalCost = Math.round((baseCost + stepCost) * complexityFactor * riskPremium * historyAdjustment);

    // 成本明细
    const breakdown: CostBreakdownItem[] = [
      { category: 'base', amount: Math.round(baseCost * complexityFactor), description: '基础执行成本' },
      { category: 'steps', amount: Math.round(stepCost * complexityFactor), description: `${steps} 个步骤的执行成本` },
      { category: 'risk_premium', amount: Math.round((baseCost + stepCost) * complexityFactor * (riskPremium - 1)), description: `风险溢价 (${riskLevel})` },
    ];

    if (twinProfile) {
      breakdown.push({
        category: 'history_adjustment',
        amount: Math.round(totalCost - breakdown.reduce((s, b) => s + b.amount, 0)),
        description: `历史数据调整 (x${historyAdjustment.toFixed(2)})`,
      });
    }

    // 置信度：有 twin 数据时更高
    const confidence = twinProfile && twinProfile.similarMissions.length > 3 ? 0.85 : 0.6;

    return {
      estimatedCost: totalCost,
      currency: 'credits',
      breakdown,
      confidence,
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'CostEstimator',
      uptime: Date.now(),
    };
  }
}
