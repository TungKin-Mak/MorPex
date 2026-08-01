/**
 * ActiveEvolutionTrigger — 主动进化触发器
 *
 * v16 Phase 4.7: 一人跨多领域虚拟公司的主动自我进化能力。
 * 在被动式 WorkflowMiner（每30分钟定期挖掘）之外，
 * 增加基于失败、质量、新部门等条件的主动进化触发器。
 *
 * 设计原则：
 *   - EventBus 通信（监听 mission.completed、evolution.active_triggered 等）
 *   - 部门隔离（按 deptId 独立追踪失败计数）
 *   - 阈值可配置
 *   - 非阻塞：触发检查不干扰主线执行
 *
 * 触发条件：
 *   1. 连续失败 N 次（按部门追踪）
 *   2. 质量评分连续低于阈值
 *   3. 新部门创建时自动迁移高成功模式
 *   4. 定期低活跃度检查（如果太久未进化）
 *
 * 数据流：
 *   ActiveEvolutionTrigger.checkAndTrigger()
 *     → 检查失败/质量/新部门条件
 *     → EventBus.emit('evolution.active_triggered')
 *     → SelfImprovementLoop.evolve() / PatternMigrationEngine.migratePattern()
 *
 * @packageDocumentation
 */

import { EventBus } from '../infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../infrastructure/common/types.js';
import type { DepartmentId } from '../governance/control-plane/department-types.js';

// ── Types ──

export type TriggerReason =
  | 'consecutive_failures'
  | 'quality_degradation'
  | 'new_department'
  | 'stale_evolution'
  | 'manual';

export interface ActiveTriggerEvent {
  reason: TriggerReason;
  deptId?: DepartmentId;
  missionId?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
}

export interface TriggerConfig {
  /** 连续失败触发阈值 */
  consecutiveFailureThreshold: number;
  /** 质量评分连续低于阈值 */
  qualityDegradationThreshold: number;
  /** 质量评分检查窗口（次数） */
  qualityWindowSize: number;
  /** 新部门自动迁移阈值（部门创建后几分钟内） */
  newDeptMigrationWindowMinutes: number;
  /** 最低活跃进化间隔（分钟），超过则触发 */
  staleEvolutionThresholdMinutes: number;
}

export interface DeptFailureTracker {
  deptId: DepartmentId;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  recentQualities: number[];
  lastEvolutionAt: number | null;
}

export interface TriggerStats {
  totalTriggers: number;
  triggersByReason: Record<TriggerReason, number>;
  activeDepartments: number;
  departmentsAtRisk: DepartmentId[];
}

const DEFAULT_CONFIG: TriggerConfig = {
  consecutiveFailureThreshold: 3,
  qualityDegradationThreshold: 0.4,
  qualityWindowSize: 5,
  newDeptMigrationWindowMinutes: 30,
  staleEvolutionThresholdMinutes: 120,
};

// ── ActiveEvolutionTrigger ──

export class ActiveEvolutionTrigger {
  name = 'ActiveEvolutionTrigger';
  version = '1.0.0';

  private eventBus: EventBus;
  private config: TriggerConfig;

  /** 按部门追踪失败和状态 */
  private deptTrackers: Map<DepartmentId, DeptFailureTracker> = new Map();

  /** 已注册的的 SelfImprovementLoop 引用 */
  private selfImprovementLoop?: {
    evolve: (metrics: {
      taskSuccessRate: number;
      avgLatency: number;
      failurePatterns: string[];
      artifactQuality: number;
    }) => Promise<{ proposals: any[]; insights: any[]; observations: any[] }>;
  };

  /** vNext+ L8：演化安全沙箱（Verifiable Evolution） */
  private sandbox: import('./EvolutionSandbox.js').EvolutionSandbox | null = null;

  /** 统计 */
  private stats: TriggerStats = {
    totalTriggers: 0,
    triggersByReason: {
      consecutive_failures: 0,
      quality_degradation: 0,
      new_department: 0,
      stale_evolution: 0,
      manual: 0,
    },
    activeDepartments: 0,
    departmentsAtRisk: [],
  };

  constructor(eventBus: EventBus, config?: Partial<TriggerConfig>) {
    if (!eventBus) throw new Error('[ActiveEvolutionTrigger] EventBus 是必填参数');
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 监听 Mission 完成事件
    this.eventBus.on('mission.completed', async (event: MorPexEvent) => {
      const p = event.payload;
      if (!p?.departmentId) return;

      // 异步检查：不阻塞主流程
      try {
        await this.checkMissionCompleted(p);
      } catch (err) {
        console.warn('[ActiveEvolutionTrigger] Mission 完成回调检查失败:', (err as Error).message);
      }
    });

    // 监听评估事件
    this.eventBus.on('evaluation.scored', (event: MorPexEvent) => {
      const p = event.payload;
      if (p?.departmentId && typeof p.qualityScore === 'number') {
        this.recordQuality(p.departmentId, p.qualityScore);
      }
    });

    // 监听新部门创建
    this.eventBus.on('department.created', (event: MorPexEvent) => {
      const p = event.payload;
      if (p?.departmentId) {
        // 新部门创建，记录追踪器
        if (!this.deptTrackers.has(p.departmentId)) {
          this.deptTrackers.set(p.departmentId, {
            deptId: p.departmentId,
            consecutiveFailures: 0,
            lastFailureAt: null,
            recentQualities: [],
            lastEvolutionAt: Date.now(),
          });
          this.stats.activeDepartments = this.deptTrackers.size;
        }
      }
    });
  }

  // ── 依赖注入 ──

  setSelfImprovementLoop(loop: {
    evolve: (metrics: {
      taskSuccessRate: number;
      avgLatency: number;
      failurePatterns: string[];
      artifactQuality: number;
    }) => Promise<{ proposals: any[]; insights: any[]; observations: any[] }>;
  }): void {
    this.selfImprovementLoop = loop;
  }

  /**
   * setEvolutionSandbox — 注入演化安全沙箱（vNext+ L8）
   * autoEvolve 产物经沙箱 dry-run + 版本化登记，而非直接改生产行为。
   */
  setEvolutionSandbox(sandbox: import('./EvolutionSandbox.js').EvolutionSandbox): void {
    this.sandbox = sandbox;
  }

  setConfig(config: Partial<TriggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  isReady(): boolean {
    return !!this.selfImprovementLoop;
  }

  // ══════════════════════════════════════════════════════════
  // 核心方法
  // ══════════════════════════════════════════════════════════

  /**
   * checkAndTrigger — 主动检查并触发进化
   *
   * 供外部手动调用或定时器调用。
   * 检查所有活跃部门的触发条件。
   */
  async checkAndTrigger(): Promise<ActiveTriggerEvent[]> {
    const triggered: ActiveTriggerEvent[] = [];

    for (const [deptId, tracker] of this.deptTrackers) {
      // 条件1: 连续失败
      if (tracker.consecutiveFailures >= this.config.consecutiveFailureThreshold) {
        const evt = await this.fireTrigger({
          reason: 'consecutive_failures',
          deptId,
          severity: tracker.consecutiveFailures >= 5 ? 'critical' : 'high',
          details: {
            consecutiveFailures: tracker.consecutiveFailures,
            lastFailureAt: tracker.lastFailureAt,
          },
        });
        triggered.push(evt);
      }

      // 条件2: 质量退化
      if (tracker.recentQualities.length >= this.config.qualityWindowSize) {
        const avg = tracker.recentQualities.reduce((s, q) => s + q, 0) / tracker.recentQualities.length;
        if (avg < this.config.qualityDegradationThreshold) {
          const evt = await this.fireTrigger({
            reason: 'quality_degradation',
            deptId,
            severity: avg < 0.2 ? 'critical' : 'high',
            details: {
              averageQuality: avg,
              windowSize: tracker.recentQualities.length,
            },
          });
          triggered.push(evt);
        }
      }

      // 条件3: 进化停滞
      if (tracker.lastEvolutionAt) {
        const staleMs = this.config.staleEvolutionThresholdMinutes * 60 * 1000;
        if (Date.now() - tracker.lastEvolutionAt > staleMs) {
          const evt = await this.fireTrigger({
            reason: 'stale_evolution',
            deptId,
            severity: 'medium',
            details: {
              lastEvolutionAt: tracker.lastEvolutionAt,
              hoursSinceEvolution: Math.round((Date.now() - tracker.lastEvolutionAt) / 3600000),
            },
          });
          triggered.push(evt);
        }
      }
    }

    return triggered;
  }

  /**
   * fireTrigger — 发射主动触发事件
   */
  async fireTrigger(event: ActiveTriggerEvent): Promise<ActiveTriggerEvent> {
    // 更新统计
    this.stats.totalTriggers++;
    this.stats.triggersByReason[event.reason]++;

    if (event.deptId && (event.severity === 'high' || event.severity === 'critical')) {
      if (!this.stats.departmentsAtRisk.includes(event.deptId)) {
        this.stats.departmentsAtRisk.push(event.deptId);
      }
    }

    // 发射事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'evolution.active_triggered',
      timestamp: Date.now(),
      executionId: `trigger_${event.reason}_${Date.now()}`,
      source: 'active-evolution-trigger',
      payload: event,
    });

    console.log(
      `[ActiveEvolutionTrigger] 🔥 主动进化触发: ${event.reason}` +
      (event.deptId ? ` @ ${event.deptId}` : '') +
      ` [${event.severity}]`,
    );

    // 如果有 SelfImprovementLoop，自动调用进化
    if (event.severity === 'high' || event.severity === 'critical') {
      await this.autoEvolve(event);
    }

    return event;
  }

  /**
   * autoEvolve — 自动触发进化流程
   */
  private async autoEvolve(event: ActiveTriggerEvent): Promise<void> {
    if (!this.selfImprovementLoop) {
      console.warn('[ActiveEvolutionTrigger] ⚠️ SelfImprovementLoop 未注入，跳过自动进化');
      return;
    }

    try {
      const result = await this.selfImprovementLoop.evolve({
        taskSuccessRate: event.reason === 'consecutive_failures' ? 0 : 0.5,
        avgLatency: 0,
        failurePatterns: event.reason === 'consecutive_failures' ? ['连续失败'] : [],
        artifactQuality: event.reason === 'quality_degradation' ? 0 : 0.5,
      });

      // ═══ vNext+ L8：演化安全沙箱（Verifiable Evolution）═══
      // 产物先经沙箱 dry-run 试跑 + 版本化登记（pending_approval），而非直接改生产行为。
      if (this.sandbox) {
        for (const proposal of result.proposals ?? []) {
          const rec = await this.sandbox.proposeChange({
            proposalId: proposal.id ?? proposal.name,
            summary: proposal.summary ?? proposal.description ?? '自演化提案',
          });
          console.log(`[ActiveEvolutionTrigger] 🧪 演化提案经沙箱登记: v${rec.version} status=${rec.status} sandbox=${rec.sandboxPassed ? 'PASS' : 'FAIL'}`);
        }
        // 高严重度且沙箱全过 → 仍需人工审批（未自动 apply）；已记录 pending_approval
        this.eventBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'evolution.proposal.pending_approval',
          timestamp: Date.now(),
          executionId: `auto_evolve_${Date.now()}`,
          source: 'active-evolution-trigger',
          payload: { triggerReason: event.reason, proposalsCount: result.proposals.length },
        });
      }

      // 记录进化时间
      if (event.deptId) {
        const tracker = this.deptTrackers.get(event.deptId);
        if (tracker) {
          tracker.lastEvolutionAt = Date.now();
          // 重置失败计数
          tracker.consecutiveFailures = 0;
        }
      }

      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'evolution.auto_completed',
        timestamp: Date.now(),
        executionId: `auto_evolve_${Date.now()}`,
        source: 'active-evolution-trigger',
        payload: {
          triggerReason: event.reason,
          deptId: event.deptId,
          proposalsCount: result.proposals.length,
          insightsCount: result.insights.length,
        },
      });

      console.log(`[ActiveEvolutionTrigger] ✅ 自动进化完成: ${result.proposals.length} 提案, ${result.insights.length} 洞察`);
    } catch (err) {
      console.warn('[ActiveEvolutionTrigger] ❌ 自动进化失败:', (err as Error).message);
    }
  }

  /**
   * triggerManual — 手动触发某部门的进化
   */
  async triggerManual(deptId: DepartmentId, reason?: string): Promise<ActiveTriggerEvent> {
    return this.fireTrigger({
      reason: 'manual',
      deptId,
      severity: 'medium',
      details: { reason: reason || '手动触发' },
    });
  }

  // ══════════════════════════════════════════════════════════
  // 内部状态管理
  // ══════════════════════════════════════════════════════════

  /**
   * checkMissionCompleted — 检查 Mission 完成事件
   */
  private async checkMissionCompleted(payload: Record<string, unknown>): Promise<void> {
    const deptId = payload.departmentId as string;
    const result = payload.result as string;
    const qualityScore = payload.qualityScore as number | undefined;

    let tracker = this.deptTrackers.get(deptId);
    if (!tracker) {
      tracker = {
        deptId,
        consecutiveFailures: 0,
        lastFailureAt: null,
        recentQualities: [],
        lastEvolutionAt: Date.now(),
      };
      this.deptTrackers.set(deptId, tracker);
      this.stats.activeDepartments = this.deptTrackers.size;
    }

    if (result === 'failed') {
      tracker.consecutiveFailures++;
      tracker.lastFailureAt = Date.now();
    } else if (result === 'success') {
      // 成功重置失败计数
      tracker.consecutiveFailures = 0;
    }

    // 记录质量评分
    if (typeof qualityScore === 'number') {
      this.recordQuality(deptId, qualityScore);
    }

    // 检查是否需要触发
    // 使用 setTimeout 避免阻塞事件循环
    setTimeout(async () => {
      try {
        const triggered = await this.checkAndTrigger();
        if (triggered.length > 0) {
          console.log(`[ActiveEvolutionTrigger] 📢 Mission 完成触发了 ${triggered.length} 个进化事件`);
        }
      } catch (err) {
        console.warn('[ActiveEvolutionTrigger] checkAndTrigger 异步失败:', (err as Error).message);
      }
    }, 0);
  }

  /**
   * recordQuality — 记录质量评分
   */
  private recordQuality(deptId: string, qualityScore: number): void {
    let tracker = this.deptTrackers.get(deptId);
    if (!tracker) {
      tracker = {
        deptId,
        consecutiveFailures: 0,
        lastFailureAt: null,
        recentQualities: [],
        lastEvolutionAt: Date.now(),
      };
      this.deptTrackers.set(deptId, tracker);
      this.stats.activeDepartments = this.deptTrackers.size;
    }

    tracker.recentQualities.push(qualityScore);
    if (tracker.recentQualities.length > this.config.qualityWindowSize * 2) {
      tracker.recentQualities = tracker.recentQualities.slice(-this.config.qualityWindowSize);
    }
  }

  // ── 查询 ──

  /**
   * getDeptTracker — 获取部门追踪状态
   */
  getDeptTracker(deptId: DepartmentId): DeptFailureTracker | undefined {
    return this.deptTrackers.get(deptId);
  }

  /**
   * listDeptsAtRisk — 列出有风险的部门
   */
  listDeptsAtRisk(): Array<{ deptId: DepartmentId; reason: string; severity: string }> {
    const atRisk: Array<{ deptId: DepartmentId; reason: string; severity: string }> = [];

    for (const [deptId, tracker] of this.deptTrackers) {
      if (tracker.consecutiveFailures >= this.config.consecutiveFailureThreshold) {
        atRisk.push({
          deptId,
          reason: `连续 ${tracker.consecutiveFailures} 次失败`,
          severity: tracker.consecutiveFailures >= 5 ? 'critical' : 'high',
        });
      }

      if (tracker.recentQualities.length >= this.config.qualityWindowSize) {
        const avg = tracker.recentQualities.reduce((s, q) => s + q, 0) / tracker.recentQualities.length;
        if (avg < this.config.qualityDegradationThreshold) {
          atRisk.push({
            deptId,
            reason: `质量退化 (平均 ${avg.toFixed(2)})`,
            severity: avg < 0.2 ? 'critical' : 'high',
          });
        }
      }
    }

    return atRisk;
  }

  /**
   * getStats — 获取统计信息
   */
  getStats(): TriggerStats {
    return { ...this.stats };
  }

  /**
   * resetDeptTracker — 重置某部门的追踪状态
   */
  resetDeptTracker(deptId: DepartmentId): void {
    const tracker = this.deptTrackers.get(deptId);
    if (tracker) {
      tracker.consecutiveFailures = 0;
      tracker.lastFailureAt = null;
      tracker.recentQualities = [];
      tracker.lastEvolutionAt = Date.now();
      console.log(`[ActiveEvolutionTrigger] 🔄 部门 ${deptId} 追踪状态已重置`);
    }
  }
}
