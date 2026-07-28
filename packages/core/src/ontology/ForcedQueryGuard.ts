/**
 * ForcedQueryGuard — 代码级强制查询守卫
 *
 * 迭代1：
 *   - 记录所有 ontology 工具调用
 *   - 断言至少调用了 N 次（代码兜底）
 *   - 校验 proposal 引用的 ID 是否确实被查询过
 */

import type { QueryTrace } from './types.js';

/**
 * TraceEventCallback — 当查询 Trace 被 flush 时调用
 * 用于将 Trace 写入 Event Sourcing
 */
export type TraceEventCallback = (
  executionId: string,
  trace: QueryTrace,
  missionId?: string,
) => Promise<void> | void;

export class ForcedQueryGuard {
  private traces = new Map<string, QueryTrace>();
  private onTraceCallback: TraceEventCallback | null = null;
  private missionIds = new Map<string, string>();

  /**
   * recordToolCall — 记录一次 ontology 工具调用
   */
  recordToolCall(
    executionId: string,
    name: string,
    args: unknown,
    result: unknown,
  ): void {
    const trace = this.traces.get(executionId) ?? {
      toolCalls: [],
      retrievedObjectIds: new Set<string>(),
    };

    trace.toolCalls.push({
      name,
      args,
      resultSummary: this.safeStringify(result).slice(0, 800),
      at: Date.now(),
    });

    for (const id of this.extractIds(result)) {
      trace.retrievedObjectIds.add(id);
    }

    this.traces.set(executionId, trace);
  }

  /**
   * assertQueried — 代码级强制：没有查询就抛错
   *
   * @param executionId - 执行 ID
   * @param minCalls - 最少调用次数（默认 1）
   */
  assertQueried(executionId: string, minCalls = 1): void {
    const trace = this.traces.get(executionId);
    const count = trace?.toolCalls.length ?? 0;
    if (count < minCalls) {
      throw new Error(
        `[ForcedQueryGuard] 必须先调用 ontology 工具获取事实。当前调用次数=${count}, executionId=${executionId}`,
      );
    }
  }

  /**
   * validateReferences — 校验 proposal 引用的 ID 是否都在已检索集合中
   *
   * @returns { valid, missing, knownCount }
   */
  validateReferences(
    executionId: string,
    referencedIds: string[],
  ): { valid: boolean; missing: string[]; knownCount: number } {
    const known = this.traces.get(executionId)?.retrievedObjectIds ?? new Set<string>();
    const missing = referencedIds.filter((id) => !known.has(id));
    return {
      valid: missing.length === 0,
      missing,
      knownCount: known.size,
    };
  }

  /**
   * getTrace — 获取完整查询追踪
   */
  getTrace(executionId: string): QueryTrace | undefined {
    return this.traces.get(executionId);
  }

  /**
   * getRetrievedIds — 获取已检索的 ID 列表
   */
  getRetrievedIds(executionId: string): string[] {
    return Array.from(this.traces.get(executionId)?.retrievedObjectIds ?? []);
  }

  /**
   * clear — 清理追踪记录
   */
  clear(executionId: string): void {
    this.traces.delete(executionId);
  }

  /**
   * clearAll — 清理所有追踪记录
   */
  /**
   * setOnTrace — 设置 Trace 事件回调
   * 每次 flushTrace 时调用，用于写入 Event Sourcing。
   */
  setOnTrace(callback: TraceEventCallback): void {
    this.onTraceCallback = callback;
  }

  /**
   * setMissionId — 关联 executionId 与 missionId
   */
  setMissionId(executionId: string, missionId: string): void {
    this.missionIds.set(executionId, missionId);
  }

  /**
   * flushTrace — 将查询 Trace 写入 Event Sourcing
   * 调用 onTrace 回调（如果已设置）。
   */
  async flushTrace(executionId: string, missionId?: string): Promise<void> {
    const trace = this.traces.get(executionId);
    if (!trace || !this.onTraceCallback) return;
    const effectiveMissionId = missionId ?? this.missionIds.get(executionId);
    await this.onTraceCallback(executionId, trace, effectiveMissionId);
  }

  /**
   * flushAllTraces — 刷新所有未 flush 的 Trace
   */
  async flushAllTraces(): Promise<void> {
    for (const executionId of this.traces.keys()) {
      await this.flushTrace(executionId);
    }
  }

  /**
   * 注意：traces 是内存 Map，重启后清空。
   * 持久化依赖 flushTrace() → EventStore，分析以 EventStore 为准。
   */
  clearAll(): void {
    this.traces.clear();
    this.missionIds.clear();
  }

  // ---------- 内部方法 ----------

  private extractIds(result: unknown): string[] {
    const ids: string[] = [];
    const walk = (node: unknown): void => {
      if (node == null) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (typeof obj.id === 'string') ids.push(obj.id);
        if (typeof obj.object_id === 'string') ids.push(obj.object_id);
        // 递归遍历所有值
        Object.values(obj).forEach(walk);
      }
    };
    walk(result);
    return ids;
  }

  private safeStringify(v: unknown): string {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}
