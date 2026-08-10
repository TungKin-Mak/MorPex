/**
 * LlmTracer — LLM 交互追踪（去黑盒化黑盒⑬）
 *
 * 订阅核心 DeblackboxRecorder 的 llm.call 事件（PiBridge 每次 generateText 都会记录），
 * 维护一个近期的 LLM 调用链内存缓冲，供 /api/observability/llm-trace 查询——
 * 桌宠"显微镜"可回答"引擎某一步问了 AI 什么、AI 回什么、花了多少钱、耗时多久"。
 *
 * 非侵入：只订阅，不修改任何记录/调用逻辑。
 */

import { getSharedDeblackboxRecorder } from '../../../core/src/infrastructure/observability/deblackbox/DeblackboxRecorder.js';
import type { DeblackboxRecord } from '../../../core/src/infrastructure/observability/deblackbox/DeblackboxRecorder.js';

/** LLM 调用链条目（摘要级，不含全文） */
export interface LlmTraceEntry {
  ts: number;
  executionId: string;
  caller: string;
  model: string;
  promptSummary: string;
  responseSummary: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  success: boolean;
  error: string;
  attempt: number;
  finishReason: string;
}

export interface LlmTraceFilter {
  caller?: string;
  model?: string;
  success?: boolean;
  executionId?: string;
  limit?: number;
}

export interface LlmTraceStats {
  total: number;
  success: number;
  failed: number;
  byModel: Record<string, number>;
  byCaller: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  avgDurationMs: number;
}

const MAX_ENTRIES = 2000;

/** 将 recorder 的 llm.call 记录映射为追踪条目（摘字段，不保留全文） */
function mapToEntry(r: DeblackboxRecord): LlmTraceEntry {
  const s = r.summary as Record<string, unknown>;
  return {
    ts: Date.now(),
    executionId: r.executionId ?? 'kernel',
    caller: String(s.caller ?? 'unknown'),
    model: String(s.model ?? ''),
    promptSummary: String(s.promptSummary ?? ''),
    responseSummary: String(s.responseSummary ?? ''),
    durationMs: Number(s.durationMs ?? 0),
    inputTokens: Number(s.inputTokens ?? 0),
    outputTokens: Number(s.outputTokens ?? 0),
    estimatedCost: Number(s.estimatedCost ?? 0),
    success: s.success === true,
    error: String(s.error ?? ''),
    attempt: Number(s.attempt ?? 0),
    finishReason: String(s.finishReason ?? ''),
  };
}

/**
 * LlmTracer — LLM 调用链内存追踪器
 */
export class LlmTracer {
  private entries: LlmTraceEntry[] = [];
  private readonly maxEntries: number;
  private unsub: (() => void) | undefined = undefined;
  private started = false;

  constructor(maxEntries = MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  /** 开始订阅（幂等） */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsub = getSharedDeblackboxRecorder().on('llm.call', (r) => {
      try {
        this.entries.push(mapToEntry(r));
        if (this.entries.length > this.maxEntries) this.entries.shift();
      } catch (err) {
        console.warn('[LlmTracer] ⚠️ llm.call 条目转换失败（忽略）:', err instanceof Error ? err.message : String(err));
      }
    });
    console.log(`[LlmTracer] ✅ 已订阅核心 llm.call 事件（缓冲上限 ${this.maxEntries}）`);
  }

  /** 停止订阅 */
  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
    this.started = false;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** 查询调用链（按 filter 过滤，按时间倒序） */
  query(filter: LlmTraceFilter = {}): LlmTraceEntry[] {
    const limit = filter.limit ?? 100;
    return this.entries
      .filter((e) => {
        if (filter.caller && e.caller !== filter.caller) return false;
        if (filter.model && e.model !== filter.model) return false;
        if (filter.success !== undefined && e.success !== filter.success) return false;
        if (filter.executionId && e.executionId !== filter.executionId) return false;
        return true;
      })
      .slice(-limit)
      .reverse();
  }

  /** 汇总统计 */
  stats(): LlmTraceStats {
    const total = this.entries.length;
    const success = this.entries.filter((e) => e.success).length;
    const byModel: Record<string, number> = {};
    const byCaller: Record<string, number> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCost = 0;
    let totalDuration = 0;
    for (const e of this.entries) {
      byModel[e.model] = (byModel[e.model] ?? 0) + 1;
      byCaller[e.caller] = (byCaller[e.caller] ?? 0) + 1;
      totalInputTokens += e.inputTokens;
      totalOutputTokens += e.outputTokens;
      totalEstimatedCost += e.estimatedCost;
      totalDuration += e.durationMs;
    }
    return {
      total,
      success,
      failed: total - success,
      byModel,
      byCaller,
      totalInputTokens,
      totalOutputTokens,
      totalEstimatedCost,
      avgDurationMs: total > 0 ? totalDuration / total : 0,
    };
  }

  /** 清空缓冲（测试/重置用） */
  clear(): void {
    this.entries = [];
  }
}

/** 进程级单例（Studio 观测面用） */
export const llmTracer = new LlmTracer();
