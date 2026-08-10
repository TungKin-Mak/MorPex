/**
 * RecordPolicy — 去黑盒记录策略（采样率 / TTL 配置中心）
 *
 * 去黑盒化方案核心思想：零黑盒 ≠ 全程录像，而是"每个决策有依据可查"。
 * 三层记录粒度（L0 任务摘要 / L1 决策单永久 / L2 详情采样+异常全记）的旋钮都在这里：
 *   - 采样率：按 category 配置（L2 详情默认 10%，L0/L1 默认 100%）
 *   - TTL：按 category 配置（L2 正常 30 天 / L2 异常 365 天 / L0/L1 永久）
 *   - 运行时可调（setSamplingRate / setTtl），不写死
 *
 * 三条铁律（docs/DEBLACKBOX_PLAN.md）：
 *   1. 只记"决策依据"，不记"原始数据"（L2 采样）
 *   2. 一切可配置（旋钮不写死）
 *   3. 异常永远全记（失败/异常 100% 记录，忽略采样率）
 */

/** 去黑盒记录层级 */
export type DeblackboxLevel = 'L0' | 'L1' | 'L2';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 默认 TTL（毫秒；∞ = 永久保留） */
export const DEBLACKBOX_DEFAULT_TTL = {
  /** L2 详情（正常记录）默认 30 天 */
  L2_NORMAL: 30 * DAY_MS,
  /** L2 详情（异常/失败）默认 365 天 */
  L2_ERROR: 365 * DAY_MS,
  /** L1 决策单：永久（量小、可查） */
  L1: Number.POSITIVE_INFINITY,
  /** L0 任务摘要：永久 */
  L0: Number.POSITIVE_INFINITY,
} as const;

/** 默认采样率（0-1） */
export const DEBLACKBOX_DEFAULT_SAMPLING = {
  /** L0/L1 决策依据：全记 */
  DECISION: 1.0,
  /** L2 详情：默认 10% 采样 */
  DETAIL: 0.1,
} as const;

export interface RecordPolicySnapshot {
  sampling: Record<string, number>;
  ttl: Record<string, number>;
  updatedAt: number;
}

/**
 * RecordPolicy — 采样率 / TTL 配置中心
 *
 * 线程安全注意：Node 单线程，Map 读写无并发问题。
 * 采样判定用 Math.random()（每次调用独立），保证同 category 内均匀抽样。
 */
export class RecordPolicy {
  /** category → 采样率（0-1）；缺省回退 '*' */
  private sampling = new Map<string, number>();
  /** category → TTL 毫秒（∞ = 永久）；缺省回退 '*' */
  private ttl = new Map<string, number>();
  private updatedAt = Date.now();

  constructor() {
    this.sampling.set('*', DEBLACKBOX_DEFAULT_SAMPLING.DECISION);
    this.sampling.set('detail', DEBLACKBOX_DEFAULT_SAMPLING.DETAIL);
    this.ttl.set('*', DEBLACKBOX_DEFAULT_TTL.L1);
    this.ttl.set('detail', DEBLACKBOX_DEFAULT_TTL.L2_NORMAL);
    this.ttl.set('detail.error', DEBLACKBOX_DEFAULT_TTL.L2_ERROR);
  }

  /** 判断某 category 本次是否应记录（异常永远全记，铁律 3）
   *
   * 采样率查找链：category → '*'（兜底 1.0）。
   * 注意：本方法用于 L0/L1（决策依据，永久全记）；L2 详情的采样用 shouldRecordDetail。
   */
  shouldRecord(category: string, isError?: boolean): boolean {
    if (isError) return true;
    const rate = this.sampling.get(category) ?? this.sampling.get('*') ?? 1.0;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return Math.random() < rate;
  }

  /** 判断某 L2 详情 category 是否应记录（异常永远全记）
   *
   * 采样率查找链：category → 'detail'（L2 通用桶）→ '*'（兜底 1.0）。
   * 这样「设置 detail=0.1」即全局控制 L2 详情采样，单个 category 可覆盖。
   */
  shouldRecordDetail(category: string, isError?: boolean): boolean {
    if (isError) return true;
    const rate =
      this.sampling.get(category) ??
      this.sampling.get('detail') ??
      this.sampling.get('*') ??
      1.0;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return Math.random() < rate;
  }

  /** 某 category 的 TTL 毫秒（异常用 detail.error 的 365 天） */
  getTtlMs(category: string, isError?: boolean): number {
    if (isError) {
      const errTtl = this.ttl.get(`${category}.error`);
      if (errTtl !== undefined) return errTtl;
    }
    return this.ttl.get(category) ?? this.ttl.get('*') ?? DEBLACKBOX_DEFAULT_TTL.L2_NORMAL;
  }

  /** 运行时可调：设置采样率 */
  setSamplingRate(category: string, rate: number): void {
    this.sampling.set(category, Math.max(0, Math.min(1, rate)));
    this.updatedAt = Date.now();
  }

  /** 运行时可调：设置 TTL（毫秒，∞ = 永久） */
  setTtl(category: string, ttlMs: number): void {
    this.ttl.set(category, ttlMs);
    this.updatedAt = Date.now();
  }

  snapshot(): RecordPolicySnapshot {
    return {
      sampling: Object.fromEntries(this.sampling),
      ttl: Object.fromEntries(this.ttl),
      updatedAt: this.updatedAt,
    };
  }
}
