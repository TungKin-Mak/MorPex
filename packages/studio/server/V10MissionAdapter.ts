/**
 * V10MissionAdapter — MissionRuntime V10 适配器
 *
 * 在不修改 MissionRuntime 核心代码的前提下，通过 EventBus 监听
 * Mission 状态转换事件，在适当的时机注入 v10 模块行为。
 *
 * 策略：事件驱动 + 包装器模式
 *   - 监听 EventBus 上的 Mission 状态转换事件
 *   - 在 PLANNING 完成后 → SIMULATING → PREDICTED → APPROVAL_PENDING
 *   - 在 EXECUTING 完成后 → VERIFYING_BEHAVIOR → QUALITY_SCORING
 *   - 在 COMPLETED 后 → LearningPlane.record()
 *
 * 设计原则：
 *   - 零破坏：不修改 MissionRuntime 一行代码
 *   - 可选集成：所有 v10 模块可选，缺失自动跳过
 *   - 事件驱动：通过 EventBus 耦合，非侵入式
 */

import { EventBus } from '../../core/src/common/EventBus.js';
import { EventType } from '../../core/src/protocol/events/EventType.js';
import { MissionState } from '../../core/src/runtime/mission/types.js';
import type { Mission, MissionPlan, MissionResult } from '../../core/src/runtime/mission/types.js';
import type { MissionRuntime } from '../../core/src/runtime/mission/MissionRuntime.js';
import type { SimulationEngine } from './simulation/simulation-engine.js';
import type { BehaviorVerificationEngine } from './verification/behavior-verification-engine.js';
import type { EventMesh } from './event-mesh/event-mesh.js';
import type { LearningPlane } from './learning/learning-plane.js';
import type { MorpexEventV10 } from './event-mesh/types.js';

// ── V10MissionAdapterConfig ──

export interface V10MissionAdapterConfig {
  /** EventBus 引用（必需） */
  bus: EventBus;

  /** MissionRuntime 引用（必需，用于获取 Mission 数据和状态转换） */
  missionRuntime: MissionRuntime;

  /** Simulation Engine（可选） */
  simulationEngine?: SimulationEngine;

  /** Behavior Verification Engine（可选） */
  verificationEngine?: BehaviorVerificationEngine;

  /** Event Mesh（可选，用于发射 v10 格式事件） */
  eventMesh?: EventMesh;

  /** Learning Plane（可选） */
  learningPlane?: LearningPlane;
}

// ── V10MissionAdapterInternalConfig（内部使用，所有字段可选转为必选带默认值）──

interface V10MissionAdapterInternalConfig {
  bus: EventBus;
  missionRuntime: MissionRuntime;
  simulationEngine: SimulationEngine | null;
  verificationEngine: BehaviorVerificationEngine | null;
  eventMesh: EventMesh | null;
  learningPlane: LearningPlane | null;
}

// ── V10MissionAdapter ──

export class V10MissionAdapter {
  private config: V10MissionAdapterInternalConfig;
  private bus: EventBus;
  private started = false;
  private _pendingSimulations: Map<string, { mission: Mission; plan: MissionPlan }> = new Map();
  private _pendingVerifications: Map<string, { mission: Mission; result: MissionResult }> = new Map();
  private startTime: number;

  constructor(config: V10MissionAdapterConfig) {
    this.bus = config.bus;
    this.startTime = Date.now();
    this.config = {
      bus: config.bus,
      missionRuntime: config.missionRuntime,
      simulationEngine: config.simulationEngine ?? null,
      verificationEngine: config.verificationEngine ?? null,
      eventMesh: config.eventMesh ?? null,
      learningPlane: config.learningPlane ?? null,
    };

    console.log('[V10MissionAdapter] Initialized');
  }

  /**
   * start — 开始监听 EventBus 事件
   *
   * 绑定到 EventBus 上的 Mission 状态转换事件。
   * 在适当的时机触发 v10 模块。
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // 监听 Mission 状态转换
    this.bus.on(EventType.MISSION_UPDATED, this.handleMissionUpdated.bind(this));
    this.bus.on(EventType.MISSION_COMPLETED, this.handleMissionCompleted.bind(this));
    this.bus.on(EventType.MISSION_FAILED, this.handleMissionFailed.bind(this));
    this.bus.on(EventType.PLAN_CREATED, this.handlePlanCreated.bind(this));
    this.bus.on(EventType.EXECUTION_COMPLETED, this.handleExecutionCompleted.bind(this));

    // 发射适配器启动事件
    this.emitV10Event('v10.adapter.started', {
      simulationEnabled: !!this.config.simulationEngine,
      verificationEnabled: !!this.config.verificationEngine,
      learningEnabled: !!this.config.learningPlane,
      eventMeshEnabled: !!this.config.eventMesh,
    });

    console.log('[V10MissionAdapter] ✅ Started — listening to mission lifecycle events');
  }

  /**
   * stop — 停止监听
   */
  stop(): void {
    if (!this.started) return;

    this.bus.off(EventType.MISSION_UPDATED, this.handleMissionUpdated.bind(this));
    this.bus.off(EventType.MISSION_COMPLETED, this.handleMissionCompleted.bind(this));
    this.bus.off(EventType.MISSION_FAILED, this.handleMissionFailed.bind(this));
    this.bus.off(EventType.PLAN_CREATED, this.handlePlanCreated.bind(this));
    this.bus.off(EventType.EXECUTION_COMPLETED, this.handleExecutionCompleted.bind(this));

    this.started = false;
    this._pendingSimulations.clear();
    this._pendingVerifications.clear();

    console.log('[V10MissionAdapter] Stopped');
  }

  /**
   * isStarted — 是否已启动
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * health — 健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    started: boolean;
    uptime: number;
    elapsed: number;
    pendingSimulations: number;
    pendingVerifications: number;
    submodules: Record<string, boolean>;
  } {
    return {
      ok: this.started,
      name: 'V10MissionAdapter',
      started: this.started,
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
      pendingSimulations: this._pendingSimulations.size,
      pendingVerifications: this._pendingVerifications.size,
      submodules: {
        simulationEnabled: !!this.config.simulationEngine,
        verificationEnabled: !!this.config.verificationEngine,
        learningEnabled: !!this.config.learningPlane,
        eventMeshEnabled: !!this.config.eventMesh,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EventBus Handlers
  // ═══════════════════════════════════════════════════════════════

  /**
   * handlePlanCreated — PLAN_CREATED 事件触发后：
   *   如果有 SimulationEngine，启动仿真 → SIMULATING → PREDICTED → APPROVAL_PENDING
   */
  private async handlePlanCreated(payload: any): Promise<void> {
    if (!this.config.simulationEngine) return;

    const missionId = payload?.missionId || payload?.executionId;
    if (!missionId) return;

    try {
      const mission = this.config.missionRuntime.getMission(missionId);
      if (!mission) return;

      const plan = mission.plan || payload?.plan;
      if (!plan) return;

      // 获取历史 Mission 数据（如果有）
      const allMissions = this.config.missionRuntime.listProjectedMissions?.() || [];
      const history = allMissions
        .filter((m: Mission) => m.state === MissionState.COMPLETED || m.state === MissionState.MISSION_FAILED)
        .slice(-20)
        .map((m: Mission) => ({
          missionId: m.id,
          goal: m.goal,
          success: m.state === MissionState.COMPLETED,
          duration: m.completedAt ? m.completedAt - m.createdAt : 0,
          score: (m.metadata?.projection as any)?.verificationScore ?? 0,
        }));

      console.log(`[V10MissionAdapter] 🚀 Starting simulation for mission ${missionId}`);

      // 发射 v10 事件
      this.emitV10Event('simulation.started', { missionId, steps: plan.steps?.length });

      // 执行仿真
      const simulationResult = await this.config.simulationEngine.simulate(
        mission,
        plan,
        history.length > 0 ? history : undefined,
      );

      console.log(`[V10MissionAdapter] ✅ Simulation complete: ${simulationResult.suggestion} (success=${simulationResult.successProbability}%, risk=${simulationResult.riskLevel})`);

      // 发射仿真完成事件
      this.emitV10Event('simulation.completed', {
        missionId,
        successProbability: simulationResult.successProbability,
        riskLevel: simulationResult.riskLevel,
        estimatedCost: simulationResult.expectedCost,
        suggestion: simulationResult.suggestion,
      });

      // 根据仿真建议决定是否继续
      if (simulationResult.suggestion === 'reject') {
        console.log(`[V10MissionAdapter] 🛑 Simulation rejected mission ${missionId}`);
        this.emitV10Event('mission.rejected.by.simulation', {
          missionId,
          reason: `Simulation rejected: success=${simulationResult.successProbability}%, risk=${simulationResult.riskLevel}`,
        });
      }

    } catch (err: any) {
      console.error(`[V10MissionAdapter] ❌ Simulation failed for ${missionId}:`, err.message);
      this.emitV10Event('simulation.failed', { missionId, error: err.message });
    }
  }

  /**
   * handleExecutionCompleted — EXECUTION_COMPLETED 事件触发后：
   *   如果有 VerificationEngine，启动行为验证 → VERIFYING_BEHAVIOR → QUALITY_SCORING
   */
  private async handleExecutionCompleted(payload: any): Promise<void> {
    if (!this.config.verificationEngine) return;

    const missionId = payload?.missionId || payload?.executionId;
    if (!missionId) return;

    try {
      const mission = this.config.missionRuntime.getMission(missionId);
      if (!mission) return;

      // 构造 MissionResult 从 payload
      const result: MissionResult = {
        missionId,
        state: (payload?.state as MissionState) || MissionState.COMPLETED,
        stepsCompleted: payload?.stepsCompleted ?? mission.plan?.steps?.length ?? 0,
        stepsTotal: payload?.stepsTotal ?? mission.plan?.steps?.length ?? 0,
        output: payload?.output,
        artifacts: payload?.artifacts || [],
        duration: payload?.duration || 0,
        error: payload?.error,
      };

      console.log(`[V10MissionAdapter] 🔍 Starting verification for mission ${missionId}`);

      // 发射 v10 事件
      this.emitV10Event('verification.behavior.started', { missionId });

      // 执行验证
      const report = await this.config.verificationEngine.verify(mission, result);

      console.log(`[V10MissionAdapter] ✅ Verification complete: score=${report.score}, grade=${report.grade}, violations=${report.violations.length}`);

      // 发射验证完成事件
      this.emitV10Event('verification.behavior.completed', {
        missionId,
        score: report.score,
        grade: report.grade,
        violationCount: report.violations.length,
      });

      // 发射质量评分事件
      this.emitV10Event('quality.generated', {
        missionId,
        score: report.score,
        grade: report.grade,
        details: report.qualityScore?.details,
      });

      // 如果有 LearningPlane，记录验证结果
      if (this.config.learningPlane) {
        await this.config.learningPlane.record({
          type: 'verification_result',
          missionId,
          score: report.score,
          grade: report.grade,
          violations: report.violations,
        }, 'experience');
      }

    } catch (err: any) {
      console.error(`[V10MissionAdapter] ❌ Verification failed for ${missionId}:`, err.message);
      this.emitV10Event('verification.behavior.failed', { missionId, error: err.message });
    }
  }

  /**
   * handleMissionCompleted — MISSION_COMPLETED 事件触发后：
   *   如果有 LearningPlane，记录学习经验
   */
  private async handleMissionCompleted(payload: any): Promise<void> {
    if (!this.config.learningPlane) return;

    const missionId = payload?.missionId || payload?.executionId;
    if (!missionId) return;

    try {
      const mission = this.config.missionRuntime.getMission(missionId);
      if (!mission) return;

      console.log(`[V10MissionAdapter] 📝 Recording learning from mission ${missionId}`);

      // 记录工作流学习
      await this.config.learningPlane.record({
        type: 'workflow',
        missionId,
        goal: mission.goal,
        steps: mission.plan?.steps?.length || 0,
        duration: mission.completedAt ? mission.completedAt - mission.createdAt : 0,
        success: true,
      }, 'workflow');

      // 记录经验学习
      await this.config.learningPlane.record({
        type: 'experience',
        missionId,
        goal: mission.goal,
        outcome: 'completed',
        duration: mission.completedAt ? mission.completedAt - mission.createdAt : 0,
      }, 'experience');

      // 发射 v10 学习事件
      this.emitV10Event('learning.updated', {
        missionId,
        goal: mission.goal,
        learningTypes: ['workflow', 'experience'],
      });

    } catch (err: any) {
      console.warn(`[V10MissionAdapter] ⚠️ Learning record failed for ${missionId}:`, err.message);
    }
  }

  /**
   * handleMissionFailed — MISSION_FAILED 事件
   *   记录失败经验
   */
  private async handleMissionFailed(payload: any): Promise<void> {
    if (!this.config.learningPlane) return;

    const missionId = payload?.missionId || payload?.executionId;
    if (!missionId) return;

    try {
      const mission = this.config.missionRuntime.getMission(missionId);
      if (!mission) return;

      await this.config.learningPlane.record({
        type: 'experience',
        missionId,
        goal: mission.goal,
        outcome: 'failed',
        error: payload?.error || mission.error || 'unknown',
      }, 'experience');

      this.emitV10Event('learning.updated', {
        missionId,
        goal: mission.goal,
        learningTypes: ['experience'],
        outcome: 'failed',
      });

    } catch (err: any) {
      console.warn(`[V10MissionAdapter] ⚠️ Failed learning record for ${missionId}:`, err.message);
    }
  }

  /**
   * handleMissionUpdated — MISSION_UPDATED 状态转换事件
   *   跟踪 Mission 状态变化
   */
  private handleMissionUpdated(payload: any): void {
    const missionId = payload?.missionId;
    const state = payload?.state;
    if (!missionId || !state) return;

    // 如果 Mission 进入 VERIFYING 状态且我们没有 verification engine，跳过
    if (state === MissionState.VERIFYING && !this.config.verificationEngine) return;

    // 如果有 EventMesh，发射状态转换事件（v10 格式）
    if (this.config.eventMesh && state) {
      this.emitV10Event('mission.state.changed', {
        missionId,
        state,
        goal: payload?.goal,
        timestamp: Date.now(),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 辅助方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * emitV10Event — 通过 EventMesh 或 EventBus 发射 v10 格式事件
   */
  private emitV10Event(type: string, payload: Record<string, unknown>): void {
    const event: MorpexEventV10 = {
      id: `v10_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      version: 1,
      timestamp: Date.now(),
      traceId: String(payload.missionId || 'unknown'),
      missionId: String(payload.missionId || 'unknown'),
      payload,
    };

    // 优先通过 EventMesh（如果有）
    if (this.config.eventMesh) {
      try {
        this.config.eventMesh.publish(event);
      } catch (err: any) {
        console.warn('[V10MissionAdapter] EventMesh publish failed:', err.message);
      }
    } else {
      // 回退到 EventBus
      try {
        this.bus.emit({
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          executionId: event.missionId,
          source: 'v10-mission-adapter',
          payload: event.payload,
        });
      } catch (err: any) {
        console.warn('[V10MissionAdapter] EventBus emit failed:', err.message);
      }
    }
  }
}
