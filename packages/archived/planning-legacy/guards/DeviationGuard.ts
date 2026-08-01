/**
 * DeviationGuard — 偏差防护守卫
 *
 * 职责：
 *   1. 防无限规划死循环（Infinity Planning Loop Guard）：
 *      为每个 Session 维护 deviationCount。若单次 Session 连续触发
 *      重规划超过 maxDeviationsPerSession（默认 3）次，自动熔断。
 *   2. 事实来源一致性（JSONL Trace）：
 *      当 DynamicReflexEngine 成功执行 hotPatch 后，显式调用
 *      appendLog() 将 Meta 层的干预决策顺序追加到 JSONL 文件中。
 *
 * 设计原则：
 *   - 熔断后不再执行重规划，交由 Self-Healing Runtime 全局兜底
 *   - JSONL 日志追加写入，保证 audit trail 完整性
 *   - 线程安全：使用 Map 存储偏差计数，无锁设计（JS 单线程）
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryWiki, JSONLWriter } from '../../../../../memory/src/index.js';
import type { DeviationRecord, DeviationGuardConfig, MemoryBusLogEntry } from '../types.js';

/** 默认配置 */
const DEFAULT_CONFIG: DeviationGuardConfig = {
  maxDeviationsPerSession: 3,
  traceLogPath: './data/planning/deviation-traces.jsonl',
};

/**
 * DeviationGuard — 偏差防护守卫
 */
export class DeviationGuard {
  private config: DeviationGuardConfig;

  /** 会话偏差计数: sessionId -> count */
  private deviationCounts = new Map<string, number>();

  /** 偏差历史记录: eventId -> DeviationRecord */
  private deviationHistory = new Map<string, DeviationRecord>();

  /** 是否已触发熔断: sessionId -> boolean */
  private circuitBreakers = new Map<string, boolean>();

  /** JSONLWriter 微批处理写入器 */
  private logWriter: JSONLWriter | null = null;

  /** ★ MemoryWiki 持久化 */
  private wiki: MemoryWiki | null = null;

  constructor(config?: Partial<DeviationGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 初始化 JSONLWriter（微批处理）
    try {
      this.logWriter = new JSONLWriter({ filePath: this.config.traceLogPath });
    } catch { /* 非关键 */ }
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  /**
   * isAllowed — 检查该会话是否允许继续重规划
   *
   * @param sessionId - 会话 ID
   * @returns true 如果未达到熔断阈值，false 表示已熔断
   */
  isAllowed(sessionId: string): boolean {
    // 检查是否已熔断
    if (this.circuitBreakers.get(sessionId)) {
      return false;
    }

    const count = this.deviationCounts.get(sessionId) ?? 0;
    if (count >= this.config.maxDeviationsPerSession) {
      // 触发熔断
      this.circuitBreakers.set(sessionId, true);
      console.warn(
        `[DeviationGuard] 会话 ${sessionId} 已触发熔断！` +
        `连续偏差 ${count} 次（阈值: ${this.config.maxDeviationsPerSession}）` +
        `，将交由 Self-Healing Runtime 全局兜底。`,
      );
      return false;
    }

    return true;
  }

  /**
   * recordDeviation — 记录一次偏差事件
   *
   * @param record - 偏差记录
   * @returns 当前偏差计数
   */
  recordDeviation(record: DeviationRecord): number {
    const sessionId = record.sessionId;
    const currentCount = (this.deviationCounts.get(sessionId) ?? 0) + 1;

    this.deviationCounts.set(sessionId, currentCount);
    this.deviationHistory.set(record.eventId, record);

    // 写入 JSONL 追踪
    this.appendTraceToFile(record).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DeviationGuard] 写入 JSONL 追踪失败: ${msg}`);
    });

    // ★ MemoryWiki 持久化
    if (this.wiki?.ready) {
      this.wiki.remember({
        id: record.eventId,
        type: 'DeviationLog',
        name: `deviation_${record.eventId}`,
        data: {
          session_id: record.sessionId,
          execution_id: record.sessionId,
          deviation_type: record.type,
          count: currentCount,
          circuit_broken: currentCount >= this.config.maxDeviationsPerSession ? 1 : 0,
          timestamp: record.timestamp,
        },
      }).catch(() => {});
    }

    return currentCount;
  }

  /**
   * getDeviationCount — 获取会话的偏差计数
   */
  getDeviationCount(sessionId: string): number {
    return this.deviationCounts.get(sessionId) ?? 0;
  }

  /**
   * getRemainingRetries — 获取会话剩余的允许重规划次数
   *
   * (接口兼容: PlanTypes 中 DeviationGuard 期望有此方法)
   */
  getRemainingRetries(sessionId: string): number {
    const used = this.deviationCounts.get(sessionId) ?? 0;
    return Math.max(0, this.config.maxDeviationsPerSession - used);
  }

  /**
   * markPatchApplied — 标记一次补丁已应用
   *
   * (接口兼容: PlanTypes 中 DeviationGuard 期望有此方法)
   */
  markPatchApplied(sessionId: string, eventId: string, patchId: string): void {
    const record: DeviationRecord = {
      sessionId,
      eventId,
      type: 'hot_patch',
      description: `补丁 ${patchId} 已应用`,
      timestamp: Date.now(),
      triggeredReplan: true,
      patchId,
    };
    this.recordDeviation(record);
  }

  /**
   * appendTraceLog — 写入追踪日志到 JSONL
   *
   * (接口兼容: PlanTypes 中 DeviationGuard 期望有此方法)
   */
  async appendTraceLog(entry: MemoryBusLogEntry): Promise<void> {
    await this.appendLog(entry);
  }

  /**
   * isCircuitBroken — 检查会话是否已熔断
   */
  isCircuitBroken(sessionId: string): boolean {
    return this.circuitBreakers.get(sessionId) ?? false;
  }

  /**
   * reset — 重置会话的偏差计数和熔断状态
   *
   * 通常在会话正常完成或重启时调用。
   */
  reset(sessionId: string): void {
    this.deviationCounts.delete(sessionId);
    this.circuitBreakers.delete(sessionId);
  }

  /**
   * appendLog — 写入 MemoryBus JSONL 追踪日志
   *
   * 由 MetaPlanner 或 DynamicReflexEngine 在 hotPatch 成功后调用。
   * 记录 Meta 层的干预决策，确保 Lineage 谱系完整。
   *
   * @param entry - 日志条目
   */
  async appendLog(entry: MemoryBusLogEntry): Promise<void> {
    try {
      this.logWriter!.append(entry);
    } catch (err) {
      console.error(`[DeviationGuard] appendLog 失败: ${err}`);
      // 不抛出异常，日志写入失败不应影响主流程
    }
  }

  /**
   * getDeviationHistory — 获取偏差历史
   */
  getDeviationHistory(sessionId?: string): DeviationRecord[] {
    const records = [...this.deviationHistory.values()];
    if (sessionId) {
      return records.filter(r => r.sessionId === sessionId)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    return records.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * getConfig — 获取当前配置（用于诊断）
   */
  getConfig(): DeviationGuardConfig {
    return { ...this.config };
  }

  // ── 内部方法 ──

  /**
   * appendTraceToFile — 将偏差记录追加到 JSONL 追踪文件
   */
  private async appendTraceToFile(record: DeviationRecord): Promise<void> {
    const traceEntry = {
      type: 'deviation_trace',
      sessionId: record.sessionId,
      eventId: record.eventId,
      deviationType: record.type,
      description: record.description,
      timestamp: record.timestamp,
      triggeredReplan: record.triggeredReplan,
      patchId: record.patchId,
      currentCount: this.deviationCounts.get(record.sessionId),
    };

    try {
      this.logWriter!.append(traceEntry);
    } catch {
      // 静默失败
    }
  }
}
