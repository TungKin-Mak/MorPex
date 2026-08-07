/**
 * scripts/tracing/TraceRecorder.ts — 函数调用追踪器（数据流链路记录）
 *
 * 运行时包装类实例的方法，每次调用记录：
 *   - 函数路径（如 CompanyFacade.executeGoal）
 *   - 全局调用顺序号（形成数据流调用链）
 *   - 耗时 / 成败 / 入参出参摘要
 *
 * 语义保持：同步方法保持同步返回，异步方法保持 Promise（不破坏调用方）。
 * 不侵入产品代码：仅测试脚本内 wrap 实例。
 */

export interface TraceCall {
  /** 全局调用顺序号（数据流链） */
  seq: number;
  /** 函数路径 */
  fn: string;
  /** 调用时间戳 */
  at: number;
  /** 入参摘要 */
  args: string;
  /** 出参摘要（成功值或 ERROR） */
  result: string;
  /** 是否成功 */
  ok: boolean;
  /** 耗时 ms */
  durationMs: number;
}

/** 值摘要（安全序列化：截断长字符串/深层对象） */
export function summarize(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length}项]`;
  if (typeof v === 'object') {
    if (depth > 1) return '{…}';
    try {
      const obj = v as Record<string, unknown>;
      const parts = Object.keys(obj)
        .slice(0, 6)
        .map((k) => `${k}:${summarize(obj[k], depth + 1)}`);
      return `{${parts.join(', ')}}`;
    } catch {
      return '{…}';
    }
  }
  return String(v);
}

export interface TraceSession {
  /** 包装实例方法（重复包装自动跳过） */
  wrap(instance: unknown, label: string, methods?: string[]): void;
  /** 导出调用记录 */
  report(): TraceCall[];
  /** 调用总数 */
  size(): number;
  /** ═══ P2-10：采样/丢弃统计 */
  stats(): { recorded: number; droppedBySample: number; droppedByCap: number; enabled: boolean; sampleRate: number; maxCalls: number };
}

export interface TraceOptions {
  /** 总开关（默认 true）；false → 零记录、零开销（wrap 仍可调用但内部直接跳过） */
  enabled?: boolean;
  /** 采样率 0-1（默认 1=全量）；如 0.1 = 10% 调用被记录 */
  sampleRate?: number;
  /** 单任务最大记录条数（默认 0=不限）；超出后停止记录（防内存膨胀） */
  maxCalls?: number;
}

export function createTraceSession(taskId: string, options?: TraceOptions): TraceSession {
  const enabled = options?.enabled ?? true;
  const sampleRate = Math.min(1, Math.max(0, options?.sampleRate ?? 1));
  const maxCalls = options?.maxCalls ?? 0;
  const calls: TraceCall[] = [];
  let seq = 0;
  let droppedBySample = 0;
  let droppedByCap = 0;
  const wrapped = new Set<string>();

  // ═══ P2-10（会话 16l·3）：采样判断（仅当需要记录时调）
  function shouldRecord(): boolean {
    if (!enabled) return false;
    if (maxCalls > 0 && calls.length >= maxCalls) {
      droppedByCap++;
      return false;
    }
    if (sampleRate < 1 && Math.random() > sampleRate) {
      droppedBySample++;
      return false;
    }
    return true;
  }

  function record(call: TraceCall): void {
    calls.push(call);
  }

  function wrapOne(obj: Record<string, unknown>, name: string, label: string): void {
    // 只包装数据属性方法；跳过访问器属性（getter/setter）——否则赋值会触发 setter 覆盖字段
    const desc =
      Object.getOwnPropertyDescriptor(obj, name) ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(obj), name);
    if (!desc || typeof desc.value !== 'function') return;
    const key = `${label}.${name}`;
    if (wrapped.has(key)) return;
    wrapped.add(key);
    const original = desc.value as (...args: unknown[]) => unknown;
    obj[name] = function (...args: unknown[]): unknown {
      const at = Date.now();
      seq += 1;
      const callSeq = seq;
      const argsSummary = args.map((a) => summarize(a)).join(' | ').slice(0, 200);
      const finish = (result: unknown, ok: boolean, durationMs: number): void => {
        // ═══ P2-10（会话 16l·3）：采样/上限判断——不记录时零存储开销
        if (!shouldRecord()) return;
        record({
          seq: callSeq,
          fn: key,
          at,
          args: argsSummary,
          result: (ok ? summarize(result) : `ERROR: ${String(result)}`).slice(0, 200),
          ok,
          durationMs,
        });
      };
      try {
        const result = original.apply(this, args);
        // 异步方法：保持 Promise 语义
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).then(
            (r) => {
              finish(r, true, Date.now() - at);
              return r;
            },
            (e) => {
              finish((e as Error).message ?? String(e), false, Date.now() - at);
              throw e;
            },
          );
        }
        // 同步方法：保持同步返回
        finish(result, true, Date.now() - at);
        return result;
      } catch (err) {
        finish((err as Error).message ?? String(err), false, Date.now() - at);
        throw err;
      }
    };
  }

  function wrap(instance: unknown, label: string, methods?: string[]): void {
    if (!instance || !enabled) return; // ═══ P2-10：disabled → 跳过包装（零开销）
    const names: string[] = methods ?? [];
    if (names.length === 0) {
      // 只收集原型链上的方法（数据属性），不收集实例 own 字段——
      // 避免把「值为函数的字段」（如 workflowRegistry = WorkflowRegistry 类）误当方法包装覆盖状态。
      const proto = Object.getPrototypeOf(instance);
      if (proto && proto !== Object.prototype) {
        for (const n of Object.getOwnPropertyNames(proto)) {
          const d = Object.getOwnPropertyDescriptor(proto, n);
          if (d && typeof d.value === 'function' && n !== 'constructor') {
            names.push(n);
          }
        }
      }
    }
    const obj = instance as Record<string, unknown>;
    for (const n of new Set(names)) wrapOne(obj, n, label);
  }

  return {
    wrap,
    report: () => [...calls],
    size: () => calls.length,
    // ═══ P2-10（会话 16l·3）：采样/丢弃统计（可观测性）
    stats: () => ({
      recorded: calls.length,
      droppedBySample,
      droppedByCap,
      enabled,
      sampleRate,
      maxCalls,
    }),
  };
}

/** 数据流调用链渲染（按 seq 顺序 → A→B→C） */
export function renderCallChain(calls: TraceCall[]): string {
  if (calls.length === 0) return '（无函数调用记录）';
  const sorted = [...calls].sort((a, b) => a.seq - b.seq);
  const lines: string[] = [];
  let prevSeq = 0;
  for (const c of sorted) {
    const gap = c.seq - prevSeq > 1 ? ` (+${c.seq - prevSeq - 1} 个并行/内嵌调用)` : '';
    lines.push(`${String(c.seq).padStart(4)}. ${c.fn}${gap}`);
    prevSeq = c.seq;
  }
  return lines.join('\n');
}
