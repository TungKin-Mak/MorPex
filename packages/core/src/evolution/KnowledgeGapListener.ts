/**
 * KnowledgeGapListener — 知识缺失监听器（QueryMiss → Feedback → Evolution）
 *
 * vNext+ 演化安全闭环的一部分：
 *   Ontology Gate 无结果（QueryMiss）不能静默失败。
 *   本监听器订阅 EventBus 的 `ontology.query.miss` 事件：
 *     1. 将每次知识缺失写入 FeedbackService（Feedback 对象，source='query_miss'）
 *     2. 聚合缺失统计（按 tier / reason / goal），供 FailureAnalyzer / 仪表盘消费
 *
 * 用途：
 *   - 让「知识缺失」成为一等信号，进入演化回路而非只分析执行失败
 *   - 为「稀疏知识可降级」提供可观测数据
 */

import type { FeedbackInput } from '../ontology/FeedbackService.js';

/** 松耦合 EventBus 接口（避免强依赖 common/EventBus） */
export interface EventBusLike {
  on(type: string, handler: (event: unknown) => void): unknown;
}

/** 松耦合 FeedbackService 接口 */
export interface FeedbackServiceLike {
  submit(input: FeedbackInput): Promise<unknown>;
}

export interface KnowledgeGapRecord {
  executionId: string;
  missionId?: string;
  tier: string;
  goal: string;
  reason: 'no_results' | 'reference_validation_failed' | 'parse_failed';
  controlledExploration: boolean;
  feedbackId?: string;
  recordedAt: number;
}

export interface KnowledgeGapStats {
  total: number;
  byTier: Record<string, number>;
  byReason: Record<string, number>;
  /** 缺失最频繁的目标（前 N 条，按次数倒序） */
  topGoals: Array<{ goal: string; count: number }>;
}

interface QueryMissEventPayload {
  missionId?: string;
  tier: string;
  goal: string;
  reason?: 'no_results' | 'reference_validation_failed' | 'parse_failed';
  controlledExploration?: boolean;
  retrievedObjectIds?: string[];
}

export class KnowledgeGapListener {
  name = 'KnowledgeGapListener';

  private eventBus: EventBusLike | null = null;
  private feedbackService: FeedbackServiceLike | null = null;
  private unsubscribes: Array<() => void> = [];
  private gaps: Map<string, KnowledgeGapRecord> = new Map();
  private goalCounts: Map<string, number> = new Map();
  private attached = false;

  constructor(opts?: { eventBus?: EventBusLike; feedbackService?: FeedbackServiceLike }) {
    this.eventBus = opts?.eventBus ?? null;
    this.feedbackService = opts?.feedbackService ?? null;
  }

  setEventBus(bus: EventBusLike): void {
    this.eventBus = bus;
  }

  setFeedbackService(service: FeedbackServiceLike): void {
    this.feedbackService = service;
  }

  /**
   * attach — 订阅 ontology.query.miss 事件（幂等）
   */
  attach(): void {
    if (this.attached || !this.eventBus) return;
    this.attached = true;

    const handler = (event: unknown): void => {
      const e = event as { type?: string; executionId?: string; payload?: QueryMissEventPayload };
      if (e?.type !== 'ontology.query.miss' || !e.executionId) return;
      const p: Partial<QueryMissEventPayload> = e?.payload ?? {};
      // 去重：同一 executionId 只记录一次
      if (this.gaps.has(e.executionId)) return;
      void this.recordMiss({
        executionId: e.executionId,
        missionId: p.missionId,
        tier: p.tier ?? 'tier-1',
        goal: p.goal ?? '',
        reason: p.reason ?? 'no_results',
        controlledExploration: p.controlledExploration ?? false,
      });
    };

    const unsub = this.eventBus.on('ontology.query.miss', handler) as (() => void) | undefined;
    if (typeof unsub === 'function') this.unsubscribes.push(unsub);
    console.log('[KnowledgeGapListener] 👂 已订阅 ontology.query.miss（QueryMiss → Feedback → Evolution）');
  }

  /**
   * recordMiss — 记录一次知识缺失并写入 Feedback（source='query_miss'）
   */
  async recordMiss(input: {
    executionId: string;
    missionId?: string;
    tier: string;
    goal: string;
    reason: 'no_results' | 'reference_validation_failed' | 'parse_failed';
    controlledExploration: boolean;
  }): Promise<KnowledgeGapRecord | null> {
    const { executionId, missionId, tier, goal, reason, controlledExploration } = input;
    if (this.gaps.has(executionId)) return this.gaps.get(executionId) ?? null;

    let feedbackId: string | undefined;
    if (this.feedbackService) {
      try {
        const fb = await this.feedbackService.submit({
          targetId: executionId,
          rating: 0, // down
          source: 'query_miss',
          markAsTestCase: true,
          comment: `[KnowledgeGap] tier=${tier}, reason=${reason}, controlledExploration=${controlledExploration}, goal=${goal.substring(0, 120)}`,
        });
        feedbackId = (fb as { id?: string })?.id;
      } catch (err) {
        console.warn(`[KnowledgeGapListener] ⚠️ 写入 Feedback 失败:`, (err as Error).message);
      }
    }

    const record: KnowledgeGapRecord = {
      executionId,
      missionId,
      tier,
      goal,
      reason,
      controlledExploration,
      feedbackId,
      recordedAt: Date.now(),
    };
    this.gaps.set(executionId, record);
    this.goalCounts.set(goal, (this.goalCounts.get(goal) ?? 0) + 1);

    console.log(
      `[KnowledgeGapListener] 🔍 知识缺失已记录: executionId=${executionId}, tier=${tier}, reason=${reason}` +
      (feedbackId ? `, feedback=${feedbackId}` : ''),
    );
    return record;
  }

  /**
   * getGap — 按 executionId 获取缺失记录
   */
  getGap(executionId: string): KnowledgeGapRecord | undefined {
    return this.gaps.get(executionId);
  }

  /**
   * listKnowledgeGaps — 列出全部知识缺失记录（供 FailureAnalyzer / 仪表盘消费）
   */
  listKnowledgeGaps(): KnowledgeGapRecord[] {
    return [...this.gaps.values()];
  }

  /**
   * getMissStats — 聚合缺失统计（按 tier / reason / 高频目标）
   */
  getMissStats(topN = 10): KnowledgeGapStats {
    const byTier: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const g of this.gaps.values()) {
      byTier[g.tier] = (byTier[g.tier] ?? 0) + 1;
      byReason[g.reason] = (byReason[g.reason] ?? 0) + 1;
    }
    const topGoals = [...this.goalCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([goal, count]) => ({ goal, count }));
    return { total: this.gaps.size, byTier, byReason, topGoals };
  }

  /**
   * clear — 清空（测试用）
   */
  clear(): void {
    this.gaps.clear();
    this.goalCounts.clear();
  }

  /**
   * detach — 取消订阅
   */
  detach(): void {
    for (const unsub of this.unsubscribes) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribes = [];
    this.attached = false;
  }
}
