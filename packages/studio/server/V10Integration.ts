/**
 * V10Integration — v10 模块统一集成入口
 *
 * 在 StudioServer 启动时初始化并连接所有 v10 模块。
 *
 * 职责：
 *   1. 实例化所有 v10 模块（依赖注入）
 *   2. 创建 V10MissionAdapter 并连接到 MissionRuntime
 *   3. 注册 V10API 路由到 Express
 *   4. 提供 start/stop 生命周期
 *   5. 发射 v10.integration.started 事件
 *
 * 设计原则：
 *   - 零破坏：不修改 StudioServer 核心初始化代码
 *   - 可选集成：所有 v10 模块可选注入
 *   - 统一生命周期：start() 初始化全部，stop() 清理全部
 *   - 可观测：每个模块有 health() 方法
 */

import type { Router as ExpressRouter } from 'express';
import type { EventBus } from '../../core/src/common/EventBus.js';
import type { MissionRuntime } from '../../core/src/runtime/mission/MissionRuntime.js';
import type Database from 'better-sqlite3';

// v10 模块
import { SimulationEngine } from './simulation/simulation-engine.js';
import { ExecutionPredictor } from './simulation/execution-predictor.js';
import { BehaviorVerificationEngine } from './verification/behavior-verification-engine.js';
import { EventMesh } from './event-mesh/event-mesh.js';
import { LearningPlane } from './learning/learning-plane.js';
// 集成层
import { V10MissionAdapter } from './V10MissionAdapter.js';
import { registerV10Routes } from './V10API.js';
import type { V10Dependencies } from './V10API.js';

// ── V10IntegrationConfig ──

export interface V10IntegrationConfig {
  /** EventBus 引用（必需） */
  bus: EventBus;

  /** MissionRuntime 引用（必需，用于适配器） */
  missionRuntime: MissionRuntime;

  /** SQLite 数据库（可选，用于 RegressionStore、EventMesh 持久化） */
  db?: Database.Database;

  /** Express Router（可选，用于注册 API 路由） */
  router?: ExpressRouter;

  /** 是否启用 Simulation Twin（默认为 true） */
  enableSimulation?: boolean;

  /** 是否启用 Behavior Verification（默认为 true） */
  enableVerification?: boolean;

  /** 是否启用 Event Mesh（默认为 true） */
  enableEventMesh?: boolean;

  /** 是否启用 Learning Plane（默认为 true） */
  enableLearning?: boolean;

  /** 是否自动启动 MissionRuntime 适配器（默认为 true） */
  enableMissionAdapter?: boolean;
}

// ── V10IntegrationConfigInternal（内部使用） ──

interface V10IntegrationConfigInternal {
  bus: EventBus;
  missionRuntime: MissionRuntime;
  db: Database.Database | null;
  router: ExpressRouter | null;
  enableSimulation: boolean;
  enableVerification: boolean;
  enableEventMesh: boolean;
  enableLearning: boolean;
  enableMissionAdapter: boolean;
}

// ── V10Integration ──

export class V10Integration {
  private config: V10IntegrationConfigInternal;
  private bus: EventBus;
  private startTime: number;
  private started = false;

  // v10 模块实例
  public simulationEngine: SimulationEngine | null = null;
  public executionPredictor: ExecutionPredictor | null = null;
  public verificationEngine: BehaviorVerificationEngine | null = null;
  public eventMesh: EventMesh | null = null;
  public learningPlane: LearningPlane | null = null;
  // 集成层
  public missionAdapter: V10MissionAdapter | null = null;

  constructor(config: V10IntegrationConfig) {
    this.bus = config.bus;
    this.startTime = Date.now();

    this.config = {
      bus: config.bus,
      missionRuntime: config.missionRuntime,
      db: config.db ?? null,
      router: config.router ?? null,
      enableSimulation: config.enableSimulation ?? true,
      enableVerification: config.enableVerification ?? true,
      enableEventMesh: config.enableEventMesh ?? true,
      enableLearning: config.enableLearning ?? true,
      enableMissionAdapter: config.enableMissionAdapter ?? true,
    };
  }

  /**
   * start — 初始化并启动所有 v10 模块
   */
  async start(): Promise<void> {
    if (this.started) {
      console.log('[V10Integration] Already started');
      return;
    }

    console.log('[V10Integration] 🚀 Starting v10 integration...');

    try {
      // 1. 按依赖顺序初始化模块
      await this.initModules();

      // 2. 创建 MissionRuntime 适配器
      if (this.config.enableMissionAdapter) {
        await this.initMissionAdapter();
      }

      // 3. 注册 API 路由
      if (this.config.router) {
        this.initAPI(this.config.router);
      }

      // 4. 发射集成启动事件
      this.emitIntegrationEvent('v10.integration.started', {
        modules: {
          simulation: !!this.simulationEngine,
          verification: !!this.verificationEngine,
          eventMesh: !!this.eventMesh,
          learning: !!this.learningPlane,
          missionAdapter: !!this.missionAdapter,
        },
      });

      this.started = true;
      console.log('[V10Integration] ✅ v10 integration complete');
      console.log(`  ├─ Simulation:      ${this.simulationEngine ? '✅' : '⏭️'}`);
      console.log(`  ├─ Verification:    ${this.verificationEngine ? '✅' : '⏭️'}`);
      console.log(`  ├─ Event Mesh:      ${this.eventMesh ? '✅' : '⏭️'}`);
      console.log(`  ├─ Learning Plane:  ${this.learningPlane ? '✅' : '⏭️'}`);

      console.log(`  └─ Mission Adapter: ${this.missionAdapter ? '✅' : '⏭️'}`);

    } catch (err: any) {
      console.error('[V10Integration] ❌ Failed to start:', err.message);
      this.emitIntegrationEvent('v10.integration.failed', { error: err.message });
      throw err;
    }
  }

  /**
   * stop — 停止所有 v10 模块
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    console.log('[V10Integration] Stopping v10 integration...');

    // 按逆序停止
    if (this.missionAdapter) {
      this.missionAdapter.stop();
      this.missionAdapter = null;
    }

    if (this.eventMesh) {
      // EventMesh 初始化是同步的，无 stop 需要调用
      this.eventMesh = null;
    }

    this.learningPlane = null;
    this.verificationEngine = null;
    this.executionPredictor = null;
    this.simulationEngine = null;

    this.started = false;
    this.emitIntegrationEvent('v10.integration.stopped', {});

    console.log('[V10Integration] ✅ Stopped');
  }

  /**
   * health — 聚合健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    started: boolean;
    uptime: number;
    modules: Record<string, unknown>;
  } {
    const modules: Record<string, unknown> = {};
    if (this.simulationEngine) modules.simulation = this.simulationEngine.health();
    if (this.verificationEngine) modules.verification = this.verificationEngine.health();
    if (this.eventMesh) modules.eventMesh = this.eventMesh.health();
    if (this.learningPlane) modules.learning = this.learningPlane.health();
    if (this.missionAdapter) modules.missionAdapter = this.missionAdapter.health();

    const allOk = Object.values(modules).every((m: any) => m?.ok !== false);

    return {
      ok: allOk,
      name: 'V10Integration',
      started: this.started,
      uptime: this.startTime,
      modules,
    };
  }

  /**
   * getAPIDeps — 获取 V10API 依赖（供外部注册路由时复用）
   */
  getAPIDeps(): V10Dependencies {
    return {
      simulationEngine: this.simulationEngine ?? undefined,
      executionPredictor: this.executionPredictor ?? undefined,
      verificationEngine: this.verificationEngine ?? undefined,
      eventMesh: this.eventMesh ?? undefined,
      learningPlane: this.learningPlane ?? undefined,

    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * initModules — 按依赖顺序初始化所有 v10 模块
   */
  private async initModules(): Promise<void> {
    // ── Event Mesh（最底层，其他模块依赖） ──
    if (this.config.enableEventMesh) {
      try {
        // EventMesh 构造函数: (bus, eventSource, db?, config?)
        // eventSource 返回所有事件列表（此处使用空数组）
        const eventSource = () => {
          try {
            // 尝试从 missionRuntime 获取事件
            return this.config.missionRuntime.listProjectedMissions?.()
              ?.map((m: any) => ({
                id: m.id,
                type: `mission.${m.state?.toLowerCase()}`,
                timestamp: m.updatedAt || Date.now(),
                executionId: m.id,
                source: 'mission-runtime',
                payload: m,
              })) ?? [];
          } catch {
            return [];
          }
        };
        this.eventMesh = new EventMesh(this.bus, eventSource, this.config.db ?? undefined);
        console.log('[V10Integration]   ├─ EventMesh ✅');
      } catch (err: any) {
        console.warn('[V10Integration]   ├─ EventMesh ⚠️ failed:', err.message);
      }
    }

    // ── Simulation Twin ──
    if (this.config.enableSimulation) {
      try {
        this.simulationEngine = new SimulationEngine(this.bus);
        this.executionPredictor = new ExecutionPredictor(this.simulationEngine);
        console.log('[V10Integration]   ├─ SimulationEngine ✅');
      } catch (err: any) {
        console.warn('[V10Integration]   ├─ SimulationEngine ⚠️ failed:', err.message);
      }
    }

    // ── Behavior Verification Engine ──
    if (this.config.enableVerification) {
      try {
        this.verificationEngine = new BehaviorVerificationEngine(
          this.bus,
          this.config.db ?? undefined,
          { enableAutoRecord: true },
        );
        console.log('[V10Integration]   ├─ BehaviorVerificationEngine ✅');
      } catch (err: any) {
        console.warn('[V10Integration]   ├─ BehaviorVerificationEngine ⚠️ failed:', err.message);
      }
    }

    // ── Learning Plane ──
    if (this.config.enableLearning) {
      try {
        this.learningPlane = new LearningPlane(this.bus);
        console.log('[V10Integration]   ├─ LearningPlane ✅');
      } catch (err: any) {
        console.warn('[V10Integration]   ├─ LearningPlane ⚠️ failed:', err.message);
      }
    }


  }

  /**
   * initMissionAdapter — 创建并启动 MissionRuntime 适配器
   */
  private async initMissionAdapter(): Promise<void> {
    try {
      this.missionAdapter = new V10MissionAdapter({
        bus: this.bus,
        missionRuntime: this.config.missionRuntime,
        simulationEngine: this.simulationEngine ?? undefined,
        verificationEngine: this.verificationEngine ?? undefined,
        eventMesh: this.eventMesh ?? undefined,
        learningPlane: this.learningPlane ?? undefined,
      });
      this.missionAdapter.start();
      console.log('[V10Integration]   ├─ V10MissionAdapter ✅');
    } catch (err: any) {
      console.warn('[V10Integration]   ├─ V10MissionAdapter ⚠️ failed:', err.message);
    }
  }

  /**
   * initAPI — 注册 v10 REST API 路由
   */
  private initAPI(router: ExpressRouter): void {
    try {
      registerV10Routes(router, this.getAPIDeps());
      console.log('[V10Integration]   ├─ V10API Routes ✅');
    } catch (err: any) {
      console.warn('[V10Integration]   ├─ V10API Routes ⚠️ failed:', err.message);
    }
  }

  /**
   * emitIntegrationEvent — 发射集成生命周期事件
   */
  private emitIntegrationEvent(type: string, payload: Record<string, unknown>): void {
    try {
      this.bus.emit({
        id: `v10_int_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: 'v10-integration',
        source: 'v10-integration',
        payload,
      });
    } catch (err: any) {
      console.warn('[V10Integration] Event emit failed:', err.message);
    }
  }
}
