/**
 * SimulationEngine — 仿真引擎（主入口）
 *
 * MorPex v10: 编排 SimulationTwin, PlanSimulator, CostEstimator,
 * RiskPredictor, SuccessPredictor 五个子模块，提供完整的执行前仿真预测。
 *
 * 流程:
 *   Mission + Plan → Twin Retrieval → Plan Simulation → Risk Prediction
 *   → Cost Estimation → Success Prediction → Aggregated Simulation Result
 *
 * 输出用于 Policy Approval 的执行前决策。
 */

import type { EventBus } from '../../../core/src/common/EventBus.js';
import type { Mission, MissionPlan } from '../../../core/src/runtime/mission/types.js';
import { SimulationTwin } from './simulation-twin.js';
import { PlanSimulator } from './plan-simulator.js';
import type { PlanSimulationOutput } from './plan-simulator.js';
import { CostEstimator } from './cost-estimator.js';
import { RiskPredictor } from './risk-predictor.js';
import { SuccessPredictor } from './success-predictor.js';
import type {
  SimulationResult,
  SimulationTwinProfile,
  SimulationConfig,
} from './types.js';

// ── 事件常量 ──

const EVT_SIMULATION_STARTED = 'simulation.started';
const EVT_SIMULATION_COMPLETED = 'simulation.completed';
const EVT_SIMULATION_FAILED = 'simulation.failed';

// ── SimulationEngine ──

export class SimulationEngine {
  private bus: EventBus | null;
  private twin: SimulationTwin;
  private planSimulator: PlanSimulator;
  private costEstimator: CostEstimator;
  private riskPredictor: RiskPredictor;
  private successPredictor: SuccessPredictor;
  private config: Required<SimulationConfig>;
  private startTime: number;

  constructor(bus?: EventBus, config?: SimulationConfig) {
    this.bus = bus ?? null;
    this.config = {
      similarityThreshold: config?.similarityThreshold ?? 0.3,
      maxReferenceMissions: config?.maxReferenceMissions ?? 10,
      defaultMaxDuration: config?.defaultMaxDuration ?? 300_000,
      costMultiplier: config?.costMultiplier ?? 1.0,
      riskWeights: config?.riskWeights ?? { complexity: 0.25, duration: 0.2, history: 0.3, goal: 0.25 },
    };

    this.twin = new SimulationTwin({
      similarityThreshold: this.config.similarityThreshold,
      maxReferenceMissions: this.config.maxReferenceMissions,
    });
    this.planSimulator = new PlanSimulator();
    this.costEstimator = new CostEstimator({ costMultiplier: this.config.costMultiplier });
    this.riskPredictor = new RiskPredictor({ riskWeights: this.config.riskWeights });
    this.successPredictor = new SuccessPredictor();
    this.startTime = Date.now();

    console.log('[SimulationEngine] Initialized');
  }

  /**
   * simulate — 完整仿真流程
   *
   * @param mission - Mission 对象
   * @param plan - MissionPlan
   * @param history - 历史 Mission 数据（可选，用于构建孪生画像）
   * @returns SimulationResult
   */
  async simulate(
    mission: Mission,
    plan: MissionPlan,
    history?: Array<{ missionId: string; goal: string; success: boolean; duration: number; score: number }>
  ): Promise<SimulationResult> {
    const missionId = mission.id;
    console.log(`[SimulationEngine] 🔮 Starting simulation for mission ${missionId}`);

    this.emitEvent(EVT_SIMULATION_STARTED, { missionId, planId: plan.id });

    try {
      // 1. 构建孪生画像
      const twinId = `twin_${missionId}`;
      const twinProfile = history && history.length > 0
        ? this.twin.buildProfile(twinId, missionId, mission.goal, history)
        : undefined;

      // 2. 计划仿真
      const planOutput = this.planSimulator.simulate(plan, twinProfile);

      // 3. 风险预测
      const riskPrediction = this.riskPredictor.predict(plan, twinProfile);

      // 4. 成本预估
      const costEstimate = this.costEstimator.estimate(plan, twinProfile);

      // 5. 成功率预测
      const successPrediction = this.successPredictor.predict(plan, twinProfile);

      // 6. 聚合结果
      const result: SimulationResult = {
        missionId,
        twinId,
        status: 'simulated',
        successProbability: successPrediction.probability,
        expectedCost: costEstimate.estimatedCost,
        riskLevel: riskPrediction.overallRisk,
        estimatedDuration: planOutput.estimatedCompletionMs,
        confidence: Math.round(
          (successPrediction.confidence + costEstimate.confidence) / 2 * 100
        ) / 100,
        riskFactors: riskPrediction.factors.map(f => ({
          name: f.name,
          score: f.score,
          weight: f.weight,
          detail: f.detail,
        })),
        suggestion: this.determineSuggestion(successPrediction.probability, riskPrediction.overallRisk),
        simulatedAt: Date.now(),
      };

      console.log(`[SimulationEngine] ✅ Simulation complete: success=${result.successProbability}%, risk=${result.riskLevel}, cost=${result.expectedCost}`);

      this.emitEvent(EVT_SIMULATION_COMPLETED, {
        missionId,
        successProbability: result.successProbability,
        riskLevel: result.riskLevel,
        expectedCost: result.expectedCost,
        suggestion: result.suggestion,
      });

      return result;

    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error(`[SimulationEngine] ❌ Simulation failed: ${errorMsg}`);

      this.emitEvent(EVT_SIMULATION_FAILED, { missionId, error: errorMsg });

      return {
        missionId,
        twinId: `twin_${missionId}`,
        status: 'failed',
        successProbability: 0,
        expectedCost: 0,
        riskLevel: 'critical',
        estimatedDuration: 0,
        confidence: 0,
        riskFactors: [{ name: 'engine_error', score: 100, weight: 1, detail: errorMsg }],
        suggestion: 'review',
        simulatedAt: Date.now(),
      };
    }
  }

  /**
   * simulateSimple — 简化仿真（仅需 plan，适用于无 history 场景）
   */
  async simulateSimple(plan: MissionPlan): Promise<SimulationResult> {
    const planOutput = this.planSimulator.simulate(plan);
    const riskPrediction = this.riskPredictor.predict(plan);
    const costEstimate = this.costEstimator.estimate(plan);
    const successPrediction = this.successPredictor.predict(plan);

    return {
      missionId: plan.missionId,
      twinId: `twin_${plan.missionId}`,
      status: 'simulated',
      successProbability: successPrediction.probability,
      expectedCost: costEstimate.estimatedCost,
      riskLevel: riskPrediction.overallRisk,
      estimatedDuration: planOutput.estimatedCompletionMs,
      confidence: 0.4,
      riskFactors: riskPrediction.factors.map(f => ({
        name: f.name, score: f.score, weight: f.weight, detail: f.detail,
      })),
      suggestion: this.determineSuggestion(successPrediction.probability, riskPrediction.overallRisk),
      simulatedAt: Date.now(),
    };
  }

  /**
   * getTwin — 获取 SimulationTwin 子模块引用
   */
  getTwin(): SimulationTwin {
    return this.twin;
  }

  /**
   * getPlanSimulator — 获取 PlanSimulator 子模块引用
   */
  getPlanSimulator(): PlanSimulator {
    return this.planSimulator;
  }

  /**
   * health — 健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    uptime: number;
    elapsed: number;
    submodules: Record<string, { ok: boolean; name: string }>;
  } {
    return {
      ok: true,
      name: 'SimulationEngine',
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
      submodules: {
        'SimulationTwin': { ok: true, name: 'SimulationTwin' },
        'PlanSimulator': { ok: true, name: 'PlanSimulator' },
        'CostEstimator': { ok: true, name: 'CostEstimator' },
        'RiskPredictor': { ok: true, name: 'RiskPredictor' },
        'SuccessPredictor': { ok: true, name: 'SuccessPredictor' },
      },
    };
  }

  // ── 私有方法 ──

  private determineSuggestion(
    successProbability: number,
    riskLevel: string
  ): 'approve' | 'reject' | 'review' {
    if (successProbability >= 80 && riskLevel === 'low') return 'approve';
    if (successProbability < 30 || riskLevel === 'critical') return 'reject';
    return 'review';
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_sim_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: String(payload.missionId || 'unknown'),
        source: 'simulation-engine',
        payload,
      });
    } catch (err: any) {
      console.warn('[SimulationEngine] Failed to emit event:', err.message);
    }
  }
}
