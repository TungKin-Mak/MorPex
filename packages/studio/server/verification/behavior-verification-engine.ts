/**
 * BehaviorVerificationEngine — 行为验证引擎（主入口）
 *
 * MorPex v10: 编排 ExpectedTraceBuilder, TraceComparator, QualityScoreEngine,
 * ViolationDetector, RegressionStore 五个子模块，提供完整的验证流程。
 *
 * 流程:
 *   MissionPlan → ExpectedTraceBuilder → ExpectedTrace
 *   MissionResult → RuntimeTrace (constructed internally)
 *   ExpectedTrace + RuntimeTrace → TraceComparator → ComparisonResult[]
 *   ComparisonResult[] → QualityScoreEngine → QualityScore
 *   All inputs → ViolationDetector → Violation[]
 *   All outputs → Aggregated VerificationReport
 *   Report → RegressionStore (optional, auto-save)
 *
 * 事件:
 *   - 验证开始时发射: verification.behavior.started
 *   - 验证完成时发射: verification.behavior.completed
 */

import { EventBus } from '../../../core/src/common/EventBus.js';
import type { Mission, MissionPlan, MissionResult, PlanStep } from '../../../core/src/runtime/mission/types.js';
import { ExpectedTraceBuilder } from './expected-trace-builder.js';
import { TraceComparator } from './trace-comparator.js';
import { QualityScoreEngine } from './quality-score.js';
import { ViolationDetector } from './violation-detector.js';
import { RegressionStore } from './regression-store.js';
import type {
  ExpectedTrace,
  RuntimeTrace,
  RuntimeStep,
  ComparisonResult,
  QualityScore,
  Violation,
  VerificationReport,
  Grade,
  BehaviorVerificationConfig,
} from './types.js';
import type Database from 'better-sqlite3';

// ── 事件类型常量 ──

const EVT_BEHAVIOR_STARTED = 'verification.behavior.started';
const EVT_BEHAVIOR_COMPLETED = 'verification.behavior.completed';
const EVT_BEHAVIOR_FAILED = 'verification.behavior.failed';
const EVT_QUALITY_GENERATED = 'quality.generated';

// ── BehaviorVerificationEngine ──

export class BehaviorVerificationEngine {
  private bus: EventBus | null;
  private traceBuilder: ExpectedTraceBuilder;
  private comparator: TraceComparator;
  private qualityEngine: QualityScoreEngine;
  private violationDetector: ViolationDetector;
  private regressionStore: RegressionStore | null;
  private config: Required<BehaviorVerificationConfig>;
  private startTime: number;

  constructor(
    bus?: EventBus,
    db?: Database.Database,
    config?: BehaviorVerificationConfig
  ) {
    this.bus = bus ?? null;
    this.config = {
      executionCorrectnessWeight: config?.executionCorrectnessWeight ?? 0.30,
      policyComplianceWeight: config?.policyComplianceWeight ?? 0.20,
      artifactQualityWeight: config?.artifactQualityWeight ?? 0.20,
      efficiencyWeight: config?.efficiencyWeight ?? 0.15,
      recoveryCapabilityWeight: config?.recoveryCapabilityWeight ?? 0.15,
      dbPath: config?.dbPath ?? ':memory:',
      enableAutoRecord: config?.enableAutoRecord ?? true,
    };

    this.traceBuilder = new ExpectedTraceBuilder();
    this.comparator = new TraceComparator();
    this.qualityEngine = new QualityScoreEngine({
      executionCorrectnessWeight: this.config.executionCorrectnessWeight,
      policyComplianceWeight: this.config.policyComplianceWeight,
      artifactQualityWeight: this.config.artifactQualityWeight,
      efficiencyWeight: this.config.efficiencyWeight,
      recoveryCapabilityWeight: this.config.recoveryCapabilityWeight,
    });
    this.violationDetector = new ViolationDetector();
    this.regressionStore = db ? new RegressionStore(db) : null;
    this.startTime = Date.now();

    console.log('[BehaviorVerificationEngine] Initialized');
  }

  /**
   * verify — 执行验证流程
   *
   * 完整的验证编排:
   *   1. 构建预期轨迹 (ExpectedTraceBuilder)
   *   2. 构建运行时轨迹 (从 MissionResult)
   *   3. 比对轨迹 (TraceComparator)
   *   4. 质量评分 (QualityScoreEngine)
   *   5. 违规检测 (ViolationDetector)
   *   6. 聚合报告
   *   7. 自动保存到回归存储（可选）
   *
   * @param mission - Mission 对象
   * @param result - Mission 执行结果
   * @returns VerificationReport
   */
  async verify(mission: Mission, result: MissionResult): Promise<VerificationReport> {
    const startTime = Date.now();
    const missionId = mission.id;

    console.log(`[BehaviorVerificationEngine] 🔍 Starting verification for mission ${missionId}`);

    // 发射开始事件
    this.emitEvent(EVT_BEHAVIOR_STARTED, { missionId });

    try {
      // 1. 构建预期轨迹
      const expectedTrace = this.traceBuilder.build(mission.plan!);

      // 2. 构建运行时轨迹
      const runtimeTrace = this.buildRuntimeTrace(missionId, result, mission.plan!);

      // 3. 轨迹比对
      const comparisonResults = this.comparator.compare(expectedTrace, runtimeTrace);
      console.log(`[BehaviorVerificationEngine] Compared ${comparisonResults.length} steps`);

      // 4. 质量评分 (蓝图 §6 五维公式)
      const qualityScore = this.qualityEngine.score(missionId, comparisonResults);
      console.log(`[BehaviorVerificationEngine] Quality score: ${qualityScore.score} (${qualityScore.grade})`);

      // 4a. 发射 quality.generated 事件 (蓝图 §11)
      this.emitEvent(EVT_QUALITY_GENERATED, {
        missionId,
        score: qualityScore.score,
        grade: qualityScore.grade,
        details: qualityScore.details,
      });

      // 5. 违规检测
      const violations = this.violationDetector.detect(
        expectedTrace,
        runtimeTrace,
        comparisonResults,
        qualityScore.grade
      );
      console.log(`[BehaviorVerificationEngine] Found ${violations.length} violations`);

      // 6. 聚合报告
      const duration = Date.now() - startTime;
      const report: VerificationReport = {
        missionId,
        score: qualityScore.score,
        grade: qualityScore.grade,
        violations,
        comparisonResults,
        qualityScore,
        duration,
        recordedAt: Date.now(),
      };

      // 7. 自动保存到回归存储
      if (this.regressionStore && this.config.enableAutoRecord) {
        await this.regressionStore.saveFull({
          missionId,
          score: qualityScore.score,
          grade: qualityScore.grade,
          violations: JSON.stringify(violations),
          comparisonResults: JSON.stringify(comparisonResults),
          qualityScore: JSON.stringify(qualityScore),
          duration,
        });
        console.log('[BehaviorVerificationEngine] Report saved to regression store');
      }

      // 发射完成事件
      this.emitEvent(EVT_BEHAVIOR_COMPLETED, {
        missionId,
        score: qualityScore.score,
        grade: qualityScore.grade,
        violationCount: violations.length,
        duration,
      });

      console.log(`[BehaviorVerificationEngine] ✅ Verification completed: score=${qualityScore.score}, grade=${qualityScore.grade}`);
      return report;

    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error(`[BehaviorVerificationEngine] ❌ Verification failed: ${errorMsg}`);

      this.emitEvent(EVT_BEHAVIOR_FAILED, { missionId, error: errorMsg });

      // 返回失败报告
      return {
        missionId,
        score: 0,
        grade: 'D',
        violations: [{
          type: 'QUALITY_VIOLATION',
          stepId: '__engine__',
          severity: 'critical',
          message: `Verification engine error: ${errorMsg}`,
        }],
        comparisonResults: [],
        qualityScore: {
          missionId,
          score: 0,
          grade: 'D',
          details: { executionCorrectnessScore: 0, policyComplianceScore: 0, artifactQualityScore: 0, efficiencyScore: 0, recoveryCapabilityScore: 0, stepScores: [] },
        },
        duration: Date.now() - startTime,
        recordedAt: Date.now(),
      };
    }
  }

  /**
   * verifyFromPlan — 直接从 Plan 和 Result 验证（无完整 Mission 对象）
   */
  async verifyFromPlan(
    missionId: string,
    plan: MissionPlan,
    result: MissionResult
  ): Promise<VerificationReport> {
    const expectedTrace = this.traceBuilder.build(plan);
    const runtimeTrace = this.buildRuntimeTrace(missionId, result, plan);
    const comparisonResults = this.comparator.compare(expectedTrace, runtimeTrace);
    const qualityScore = this.qualityEngine.score(missionId, comparisonResults);
    const violations = this.violationDetector.detect(expectedTrace, runtimeTrace, comparisonResults, qualityScore.grade);

    const report: VerificationReport = {
      missionId,
      score: qualityScore.score,
      grade: qualityScore.grade,
      violations,
      comparisonResults,
      qualityScore,
      duration: result.duration,
      recordedAt: Date.now(),
    };

    if (this.regressionStore && this.config.enableAutoRecord) {
      await this.regressionStore.saveFull({
        missionId,
        score: qualityScore.score,
        grade: qualityScore.grade,
        violations: JSON.stringify(violations),
        comparisonResults: JSON.stringify(comparisonResults),
        qualityScore: JSON.stringify(qualityScore),
        duration: result.duration,
      });
    }

    return report;
  }

  /**
   * getRegressionStore — 获取回归存储引用
   */
  getRegressionStore(): RegressionStore | null {
    return this.regressionStore;
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
    const elapsed = Date.now() - this.startTime;
    const submodules: Record<string, { ok: boolean; name: string }> = {
      'ExpectedTraceBuilder': { ok: true, name: 'ExpectedTraceBuilder' },
      'TraceComparator': { ok: true, name: 'TraceComparator' },
      'QualityScoreEngine': { ok: true, name: 'QualityScoreEngine' },
      'ViolationDetector': { ok: true, name: 'ViolationDetector' },
    };

    if (this.regressionStore) {
      const rsHealth = this.regressionStore.health();
      submodules['RegressionStore'] = { ok: rsHealth.ok, name: rsHealth.name };
    }

    return {
      ok: Object.values(submodules).every(m => m.ok),
      name: 'BehaviorVerificationEngine',
      uptime: this.startTime,
      elapsed,
      submodules,
    };
  }

  // ── 私有方法 ──

  /**
   * buildRuntimeTrace — 从 MissionResult 构建运行时轨迹
   */
  private buildRuntimeTrace(missionId: string, result: MissionResult, plan: MissionPlan): RuntimeTrace {
    // 从 plan 的 steps 构建 runtime steps
    // 如果 result 未提供详细步骤数据，使用 plan steps + result 状态推断
    const steps: RuntimeStep[] = plan.steps.map((step: PlanStep) => {
      const runtimeStep: RuntimeStep = {
        stepId: step.id,
        status: this.determineStepStatus(step, result),
        duration: result.stepsTotal > 0
          ? Math.round(result.duration / result.stepsTotal)
          : 0,
      };

      if (runtimeStep.status === 'failed' && result.error) {
        runtimeStep.error = result.error;
      }

      return runtimeStep;
    });

    return {
      missionId,
      steps,
      totalDuration: result.duration,
      error: result.error,
    };
  }

  /**
   * determineStepStatus — 确定单个步骤的执行状态
   */
  private determineStepStatus(step: PlanStep, result: MissionResult): 'success' | 'failed' | 'skipped' {
    if (result.state === 'MISSION_FAILED' || result.state === 'FAILED') {
      // 找到失败步骤
      if (result.error && step.name.toLowerCase().includes('execute')) {
        return 'failed';
      }
      // 未完成步骤
      return 'skipped';
    }
    return 'success';
  }

  /**
   * emitEvent — 发射事件到 EventBus
   */
  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_bve_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: String(payload.missionId || 'unknown'),
        source: 'behavior-verification-engine',
        payload,
      });
    } catch (err: any) {
      console.warn('[BehaviorVerificationEngine] Failed to emit event:', err.message);
    }
  }
}
