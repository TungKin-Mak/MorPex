/**
 * DeblackboxRecorder — 统一去黑盒记录入口（L0/L1/L2 三层）
 *
 * 核心思想（docs/DEBLACKBOX_PLAN.md）：
 *   ❌ 零黑盒 ≠ 全程录像（会爆炸）
 *   ✅ 零黑盒 = 每个决策有依据可查（量小、可查）
 *
 * 三层记录粒度：
 *   - L0 任务摘要（~1KB/任务，永久）→ BaseEvent type='deblackbox.task.summary'
 *   - L1 决策单（~0.2KB/条，永久）  → IEventStore.appendDecision（复用 events_decision 表）
 *   - L2 详情（量大，采样+短期）    → DeblackboxDetailStore（30 天/异常 365 天）
 *
 * 三条铁律：
 *   1. 只记"决策依据"，不记"原始数据"（L2 采样）
 *   2. 一切可配置（RecordPolicy 旋钮，运行时可调）
 *   3. 异常永远全记（失败/异常 100% 记录，忽略采样率）
 *
 * 设计：
 *   - 进程级全局单例 getSharedDeblackboxRecorder()（模仿 PiBridge.sharedPiBridge 模式），
 *     任何模块（含 PiBridge）无需依赖 EventStore 即可调用。
 *   - configure() 在 bootstrap/ServiceContainer 注入 EventStore + EventBus；
 *     未注入时回退内存缓冲（不丢、不抛）。
 *   - record() 为 fire-and-forget：内部 .catch(console.warn)，永不 throw，绝不阻断业务主流程。
 *   - 内部 on()/emit() 轻量 pub-sub，供 llm-tracer 等观测组件订阅（不污染 EventBus 历史）。
 */

import type { BaseEvent } from '../../protocol/events/BaseEvent.js';
import { createDecisionEvent, type DecisionEvent } from '../../protocol/events/DecisionEvent.js';
import type { IEventStore } from '../../protocol/events/store/IEventStore.js';
import { DeblackboxDetailStore, type DeblackboxDetailRecord } from './DeblackboxDetailStore.js';
import { RecordPolicy, type DeblackboxLevel } from './RecordPolicy.js';

/** 去黑盒记录负载 */
export interface DeblackboxRecord {
  /** 记录类别（如 'llm.call' | 'gate.decision' | 'context.retrieval'） */
  category: string;
  /** 来源组件（如 'pi-bridge' | 'gate' | 'planner'） */
  source: string;
  /** 关联执行 ID（缺省 'kernel'） */
  executionId?: string;
  /** 记录层级 */
  level: DeblackboxLevel;
  /** 决策依据/摘要字段（L0/L1 永久保存） */
  summary: Record<string, unknown>;
  /** L2 详情原始数据（采样保存，异常全记） */
  detail?: unknown;
  /** 是否异常/失败（强制全记，铁律 3） */
  isError?: boolean;
  /** LLM 成本（可选；存在时写入 summary.cost 供成本审计） */
  cost?: { inputTokens: number; outputTokens: number; estimatedCost: number };
}

type RecordHandler = (record: DeblackboxRecord) => void;

/** 内存缓冲上限（getRecent 用） */
const MAX_RECENT = 2000;

/**
 * DeblackboxRecorder — 统一去黑盒记录入口
 */
export class DeblackboxRecorder {
  private eventStore: IEventStore | null = null;
  private readonly policy = new RecordPolicy();
  private readonly detailStore = new DeblackboxDetailStore();
  private readonly listeners = new Map<string, Set<RecordHandler>>();
  private recent: DeblackboxRecord[] = [];
  private counts = new Map<string, { total: number; errors: number }>();
  private configured = false;

  /** 注入 EventStore / EventBus（bootstrap 时调用；可重复调用以更新） */
  configure(opts: { eventStore?: IEventStore }): void {
    if (opts.eventStore) {
      this.eventStore = opts.eventStore;
      // 挂载共享 SQLite 供 L2 详情持久化
      const getDb = (opts.eventStore as { getDatabase?: () => unknown }).getDatabase;
      if (typeof getDb === 'function') {
        try {
          this.detailStore.attachDatabase(getDb.call(opts.eventStore));
        } catch (err) {
          console.warn('[DeblackboxRecorder] ⚠️ L2 详情库挂载失败（回退内存）:', err instanceof Error ? err.message : String(err));
        }
      }
    }
    if (!this.configured) {
      console.log('[DeblackboxRecorder] ✅ 去黑盒记录器已接入（EventStore=' + (opts.eventStore ? 'SQLite' : '无') + '）');
      this.configured = true;
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  getRecordPolicy(): RecordPolicy {
    return this.policy;
  }

  getDetailStore(): DeblackboxDetailStore {
    return this.detailStore;
  }

  /**
   * record — 统一记录入口（fire-and-forget，永不 throw）
   *
   * 按层级分派：
   *   - L0/L1 → 永久写入（appendDecision / append）
   *   - L2 → 详情采样（异常强制全记）
   * 同时维护内存 recent + 计数 + 内部 pub-sub（供 llm-tracer 订阅）。
   */
  record(r: DeblackboxRecord): void {
    try {
      const isError = r.isError === true;
      const executionId = r.executionId ?? 'kernel';
      const full: DeblackboxRecord = { ...r, executionId };

      // 计数
      const c = this.counts.get(r.category) ?? { total: 0, errors: 0 };
      c.total++;
      if (isError) c.errors++;
      this.counts.set(r.category, c);

      // 内存 recent（有界）
      this.recent.push(full);
      if (this.recent.length > MAX_RECENT) this.recent.shift();

      // 内部 pub-sub（llm-tracer 等观测组件）
      this.emit(r.category, full);

      // 持久化分派（异步，失败仅告警）
      // 语义：level 决定主持久化目标（L0 摘要 / L1 决策单永久 / L2 详情采样）；
      //       同时任何 level 若携带 detail → 额外走 L2 采样（异常强制全记），
      //       使「LLM 调用」这类事件能同时满足：摘要永久可查 + 全文采样可溯源。
      if (r.detail !== undefined && r.level !== 'L2') {
        // L0/L1 携带详情 → 额外 L2 采样写入（异常全记）
        this.writeDetail(r, full, isError);
      }
      if (r.level === 'L2') {
        this.writeDetail(r, full, isError);
      } else if (r.level === 'L1') {
        // 决策单（永久，可查询）
        this.writeDecision(r, full).catch((err) =>
          console.warn(`[DeblackboxRecorder] ⚠️ L1 决策单写入失败 (${r.category}):`, err instanceof Error ? err.message : String(err))
        );
      } else {
        // L0 任务摘要（永久）
        this.writeSummary(r, full).catch((err) =>
          console.warn(`[DeblackboxRecorder] ⚠️ L0 摘要写入失败 (${r.category}):`, err instanceof Error ? err.message : String(err))
        );
      }
    } catch (err) {
      // 记录器自身绝不抛出（record 是旁路）
      console.warn('[DeblackboxRecorder] ⚠️ record 内部异常（已忽略）:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 直接追加一条 DecisionEvent（供已有决策流的模块复用） */
  recordDecision(decision: DecisionEvent): void {
    if (!this.eventStore) return;
    this.eventStore.appendDecision(decision).catch((err) =>
      console.warn(`[DeblackboxRecorder] ⚠️ appendDecision 失败 (${decision.source}):`, err instanceof Error ? err.message : String(err))
    );
  }

  /**
   * recordStateSnapshot — 内存态数据快照（去黑盒化黑盒⑨，L1 决策单永久）
   *
   * 关键内存 Map（teams/agentPool/capabilityCache/stepResults 等）在生命周期节点
   * 写快照到 EventStore（appendDecision → events_decision 表），重启后可按
   * category='memory.state.snapshot' 查询上次运行时的内存态。
   * 量级控制：只记关键字段（数量/摘要/ID 列表），不记全量对象。
   */
  recordStateSnapshot(opts: {
    name: string;
    state: Record<string, unknown>;
    executionId?: string;
    trigger: string;
  }): void {
    try {
      // 统一走 record()（level L1）：决策单永久落 EventStore + 内存 recent/计数，避免双写
      this.record({
        category: 'memory.state.snapshot',
        source: 'memory-snapshot',
        executionId: opts.executionId ?? 'kernel',
        level: 'L1',
        summary: {
          name: opts.name,
          trigger: opts.trigger,
          ...opts.state,
          decision: `内存态快照: ${opts.name}`,
          reasoning: `内存态快照（触发: ${opts.trigger}），重启后可据此恢复内存态视图`,
        },
      });
    } catch (err) {
      console.warn('[DeblackboxRecorder] ⚠️ 内存态快照失败（忽略）:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 统计：category → { total, errors } */
  stats(): Record<string, { total: number; errors: number }> {
    return Object.fromEntries(this.counts);
  }

  /** 最近记录（按 category 过滤，内存） */
  getRecent(category?: string, limit = 100): DeblackboxRecord[] {
    const pool = category ? this.recent.filter((r) => r.category === category) : this.recent;
    return pool.slice(-limit);
  }

  /** 订阅某类记录（llm-tracer 等观测组件）；返回退订函数 */
  on(category: string, handler: RecordHandler): () => void {
    if (!this.listeners.has(category)) this.listeners.set(category, new Set());
    this.listeners.get(category)!.add(handler);
    return () => this.listeners.get(category)?.delete(handler);
  }

  // ── 内部 ──

  private emit(category: string, record: DeblackboxRecord): void {
    const handlers = this.listeners.get(category);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(record);
      } catch (err) {
        console.warn('[DeblackboxRecorder] ⚠️ 订阅处理器异常:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  private buildDecision(r: DeblackboxRecord, full: DeblackboxRecord): DecisionEvent {
    const summary = full.summary;
    const reason = typeof summary.reasoning === 'string' ? summary.reasoning : '';
    const decisionStr =
      typeof summary.decision === 'string'
        ? summary.decision
        : JSON.stringify(summary).slice(0, 500);
    const metadata: Record<string, unknown> = {
      category: r.category,
      level: r.level,
      isError: r.isError === true,
      ...summary,
    };
    if (r.cost) {
      metadata.cost = r.cost;
    }
    return createDecisionEvent({
      executionId: full.executionId!,
      source: r.source,
      input: typeof summary.input === 'object' && summary.input !== null ? (summary.input as Record<string, unknown>) : {},
      reasoning: reason,
      evidence: Array.isArray(summary.evidence) ? (summary.evidence as string[]) : [],
      decision: decisionStr,
      confidence: typeof summary.confidence === 'number' ? summary.confidence : 1,
      twinVersion: 0,
      metadata,
    });
  }

  private async writeDecision(r: DeblackboxRecord, full: DeblackboxRecord): Promise<void> {
    if (!this.eventStore) return; // 未配置 → 仅内存
    await this.eventStore.appendDecision(this.buildDecision(r, full));
  }

  private async writeSummary(r: DeblackboxRecord, full: DeblackboxRecord): Promise<void> {
    if (!this.eventStore) return;
    const event: BaseEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      type: 'deblackbox.task.summary',
      timestamp: Date.now(),
      executionId: full.executionId!,
      source: r.source,
      payload: { category: r.category, ...full.summary },
    };
    await this.eventStore.append(event);
  }

  /** L2 详情写入（采样，异常强制全记） */
  private writeDetail(r: DeblackboxRecord, full: DeblackboxRecord, isError: boolean): void {
    if (!this.policy.shouldRecordDetail(r.category, isError)) return;
    const detail: DeblackboxDetailRecord = {
      id: `dbd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      category: r.category,
      executionId: full.executionId!,
      source: r.source,
      timestamp: Date.now(),
      payload: r.detail ?? r.summary,
      isError,
    };
    this.detailStore.append(detail);
  }
}

// ═══════════════════════════════════════════════════════════════
// 进程级共享单例（模仿 PiBridge.sharedPiBridge 模式）
// ═══════════════════════════════════════════════════════════════

let sharedRecorder: DeblackboxRecorder | null = null;

/** 获取进程级共享 DeblackboxRecorder（懒创建） */
export function getSharedDeblackboxRecorder(): DeblackboxRecorder {
  if (!sharedRecorder) {
    sharedRecorder = new DeblackboxRecorder();
  }
  return sharedRecorder;
}

/** 重置共享单例（测试用；业务代码不应调用） */
export function resetSharedDeblackboxRecorder(): void {
  sharedRecorder = null;
}
