/**
 * ExecutionPredictor — 执行预测器
 *
 * MorPex v10 — 蓝图 §2 Intelligence Plane:
 * 在执行前预测执行质量，为 Policy Approval 提供决策依据。
 *
 * 与 SuccessPredictor 的关系:
 *   SuccessPredictor 预测成功率 (0-100) 和置信度
 *   ExecutionPredictor 聚合多个维度的预测为综合性执行质量评分
 *
 * 与 SimulationEngine 的关系:
 *   SimulationEngine 调用 SuccessPredictor 获得成功率预测
 *   ExecutionPredictor 是 Intelligence Plane 的对外接口，汇总预测结果
 *
 * 使用方式:
 *   const predictor = new ExecutionPredictor(simulationEngine);
 *   const prediction = await predictor.predict(mission, plan, history);
 */

import type { Mission, MissionPlan } from '../../../core/src/runtime/mission/types.js';
import { SimulationEngine } from './simulation-engine.js';
import type { SimulationResult } from './types.js';

// ── ExecutionPrediction ──

export interface ExecutionPrediction {
  missionId: string;
  /** 执行质量评分 (0-100) */
  qualityScore: number;
  /** 预测成功率 (0-100) */
  successProbability: number;
  /** 预测成本 */
  expectedCost: number;
  /** 预测耗时 (ms) */
  estimatedDuration: number;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 置信度 (0-1) */
  confidence: number;
  /** 各维度评分明细 */
  dimensions: {
    complexity: number;       // 复杂度评分 (0-100)
    duration: number;         // 耗时评分 (0-100)
    history: number;          // 历史表现评分 (0-100)
    goal: number;             // 目标匹配评分 (0-100)
  };
  /** 建议 */
  suggestion: 'approve' | 'reject' | 'review';
  /** 预测时间 */
  predictedAt: number;
}

// ── ExecutionPredictor ──

export class ExecutionPredictor {
  private simulationEngine: SimulationEngine;

  constructor(simulationEngine: SimulationEngine) {
    this.simulationEngine = simulationEngine;
  }

  /**
   * predict — 执行质量预测
   *
   * 通过 SimulationEngine 运行仿真，将结果聚合为综合性执行质量评分。
   *
   * @param mission - Mission 对象
   * @param plan - MissionPlan
   * @param history - 历史 Mission 数据（可选）
   * @returns ExecutionPrediction
   */
  async predict(
    mission: Mission,
    plan: MissionPlan,
    history?: Array<{ missionId: string; goal: string; success: boolean; duration: number; score: number }>
  ): Promise<ExecutionPrediction> {
    // 运行仿真
    const simResult: SimulationResult = await this.simulationEngine.simulate(mission, plan, history);

    // 从仿真结果计算各维度评分
    const dimensions = this.calculateDimensions(simResult, plan);

    // 综合质量评分: 基于仿真结果和维度评分的加权组合
    const qualityScore = Math.round(
      dimensions.complexity * 0.25 +
      dimensions.duration * 0.20 +
      dimensions.history * 0.30 +
      dimensions.goal * 0.25
    );

    return {
      missionId: mission.id,
      qualityScore: Math.min(100, Math.max(0, qualityScore)),
      successProbability: simResult.successProbability,
      expectedCost: simResult.expectedCost,
      estimatedDuration: simResult.estimatedDuration,
      riskLevel: simResult.riskLevel,
      confidence: simResult.confidence,
      dimensions,
      suggestion: simResult.suggestion,
      predictedAt: Date.now(),
    };
  }

  /**
   * predictSimple — 快速预测（无需 history）
   */
  async predictSimple(mission: Mission, plan: MissionPlan): Promise<ExecutionPrediction> {
    return this.predict(mission, plan);
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'ExecutionPredictor',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  private calculateDimensions(
    simResult: SimulationResult,
    plan: MissionPlan
  ): { complexity: number; duration: number; history: number; goal: number } {
    // 复杂度评分: 基于步骤数、依赖深度、风险因子
    const stepCount = plan.steps?.length ?? 1;
    const complexityScore = Math.max(0, 100 - (stepCount - 1) * 15);

    // 耗时评分: 基于预估值与默认最大值的比例
    const maxDuration = 300_000; // 5分钟
    const durationRatio = simResult.estimatedDuration / maxDuration;
    const durationScore = Math.max(0, Math.round(100 - durationRatio * 100));

    // 历史评分: 基于历史成功率
    const historyScore = Math.round(simResult.successProbability);

    // 目标评分: 基于风险等级
    const goalScoreMap: Record<string, number> = {
      low: 90, medium: 70, high: 40, critical: 10,
    };
    const goalScore = goalScoreMap[simResult.riskLevel] ?? 50;

    return {
      complexity: Math.min(100, complexityScore),
      duration: Math.min(100, durationScore),
      history: Math.min(100, historyScore),
      goal: goalScore,
    };
  }
}
