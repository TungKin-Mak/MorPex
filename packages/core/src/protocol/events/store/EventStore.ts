/**
 * EventStore — Event Sourcing 不可变事件存储
 *
 * Phase 4 / MorPex v8.5: 所有状态变更通过事件记录，不直接修改状态。
 * 状态由 EventProjection 从事件流投影生成。
 *
 * 设计原则:
 *   - append-only: 事件写入后不可修改、不可删除
 *   - 纯事件流: 不存储状态快照，状态 = f(event_stream)
 *   - JSONL 持久化: 与旧 EventStore（event/EventStore.ts）共存
 *
 * 与旧 EventStore 的区别:
 *   旧 EventStore: SourcingEvent 联合类型，专注工具/FSM/节点级事件
 *   新 EventStore: BaseEvent 通用类型，支持所有 45 个 EventType
 *
 * 使用方式:
 *   const store = new EventStore({ dataDir: './data/events' });
 *   await store.load();
 *   await store.append(baseEvent);
 *   const missionEvents = store.getByExecutionId('mis_001');
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BaseEvent } from '../BaseEvent.js';
import { EventType } from '../EventType.js';
import type { DecisionEvent, DecisionEventQuery } from '../DecisionEvent.js';

// ── 配置 ──

export interface EventStoreConfig {
  /** 数据存储目录 (默认 ./data/event-store) */
  dataDir?: string;
  /** 内存中保留的最大事件数 (默认 100000) */
  maxInMemory?: number;
}

// ── EventStore ──

export class EventStore {
  /** 内存事件流（按追加顺序排列） */
  private events: BaseEvent[] = [];

  /** 按 executionId 索引的视图: executionId → events[] */
  private byExecutionId: Map<string, BaseEvent[]> = new Map();

  /** 按 EventType 索引的视图: type → events[] */
  private byType: Map<string, BaseEvent[]> = new Map();

  // ═══════════════════════════════════════════════════════
  // ★ v8.6: Cognitive Event Stream — DecisionEvent 存储
  // ═══════════════════════════════════════════════════════

  /** 决策事件流（按追加顺序排列） */
  private decisions: DecisionEvent[] = [];

  /** 按 executionId 索引的决策视图: executionId → decisions[] */
  private decisionsByExecution: Map<string, DecisionEvent[]> = new Map();

  /** 数据目录路径 */
  private dataDir: string;

  /** 最大内存事件数 */
  private maxInMemory: number;

  /** 日志文件路径 */
  private get logPath(): string {
    return path.join(this.dataDir, 'event-store.jsonl');
  }

  /** 索引文件路径 */
  private get indexPath(): string {
    return path.join(this.dataDir, 'event-store.idx.json');
  }

  /** 写入缓冲 */
  private writeBuffer: BaseEvent[] = [];
  private flushing = false;

  constructor(config?: EventStoreConfig) {
    this.dataDir = config?.dataDir ?? './data/event-store';
    this.maxInMemory = config?.maxInMemory ?? 100000;
  }

  // ═══════════════════════════════════════════════════════════
  // 核心写入
  // ═══════════════════════════════════════════════════════════

  /**
   * append — 追加事件（不可变写入）
   *
   * 事件写入内存 + 索引，异步持久化到 JSONL。
   *
   * @param event - 符合 BaseEvent 接口的事件
   * @returns 写入后的事件（id 不变）
   */
  async append(event: BaseEvent): Promise<BaseEvent> {
    // 写入内存
    this.events.push(event);

    // 按 executionId 索引
    const execEvents = this.byExecutionId.get(event.executionId);
    if (execEvents) {
      execEvents.push(event);
    } else {
      this.byExecutionId.set(event.executionId, [event]);
    }

    // 按 type 索引
    const typeEvents = this.byType.get(event.type);
    if (typeEvents) {
      typeEvents.push(event);
    } else {
      this.byType.set(event.type, [event]);
    }

    // 内存上限保护
    if (this.events.length > this.maxInMemory) {
      this.events.splice(0, this.events.length - this.maxInMemory);
    }

    // 异步持久化
    this.writeBuffer.push(event);
    this.flush().catch(err => {
      console.error('[EventStore] Flush error:', err);
    });

    return event;
  }

  /**
   * appendMany — 批量追加事件
   */
  async appendMany(events: BaseEvent[]): Promise<BaseEvent[]> {
    for (const event of events) {
      this.events.push(event);

      const execEvents = this.byExecutionId.get(event.executionId);
      if (execEvents) execEvents.push(event);
      else this.byExecutionId.set(event.executionId, [event]);

      const typeEvents = this.byType.get(event.type);
      if (typeEvents) typeEvents.push(event);
      else this.byType.set(event.type, [event]);
    }
    this.writeBuffer.push(...events);
    await this.flush();
    return events;
  }

  // ═══════════════════════════════════════════════════════
  // ★ v8.6: Decision Event（认知决策流）写入
  // ═══════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════
  // ★ v8.6: Decision Event（认知决策流）写入
  // ═══════════════════════════════════════════════════════

  /**
   * appendDecision — 追加一条认知决策事件
   *
   * 与 append() 互补：append() 记录"发生了什么"（状态转换），
   * appendDecision() 记录"为什么发生"（认知过程）。
   *
   * @param decision - DecisionEvent
   * @returns 写入的 DecisionEvent
   */
  async appendDecision(decision: DecisionEvent): Promise<DecisionEvent> {
    this.decisions.push(decision)

    // 按 executionId 索引
    const execDecisions = this.decisionsByExecution.get(decision.executionId)
    if (execDecisions) {
      execDecisions.push(decision)
    } else {
      this.decisionsByExecution.set(decision.executionId, [decision])
    }

    // 持久化到独立的决策事件日志
    try {
      await fs.promises.mkdir(this.dataDir, { recursive: true })
      await fs.promises.appendFile(
        path.join(this.dataDir, 'decision-stream.jsonl'),
        JSON.stringify(decision) + '\n',
        'utf-8'
      )
    } catch (err) {
      console.error('[EventStore] Decision write error:', err)
    }

    return decision
  }

  // ═══════════════════════════════════════════════════════
  // ★ v8.6: Decision Event 查询
  // ═══════════════════════════════════════════════════════

  /**
   * getDecisionStream — 获取完整决策事件流
   */
  getDecisionStream(): readonly DecisionEvent[] {
    return this.decisions
  }

  /**
   * getDecisionsByExecution — 按 executionId 获取决策事件
   *
   * @param executionId - 执行/事务 ID
   * @returns 该 executionId 关联的所有 DecisionEvent
   */
  getDecisionsByExecution(executionId: string): DecisionEvent[] {
    return this.decisionsByExecution.get(executionId) ?? []
  }

  /**
   * getDecisionHistory — 获取指定 executionId 的完整认知决策历史
   *
   * 返回按时间排序的决策链，用于审计和回溯。
   *
   * @param executionId - 执行/事务 ID
   * @returns 按时间升序排列的 DecisionEvent 数组
   */
  getDecisionHistory(executionId: string): DecisionEvent[] {
    const decisions = this.decisionsByExecution.get(executionId)
    if (!decisions) return []
    return [...decisions].sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * getDecisionsByTimeRange — 按时间范围获取决策事件
   *
   * @param start - 起始时间戳
   * @param end - 结束时间戳
   * @returns 时间范围内的 DecisionEvent 列表
   */
  getDecisionsByTimeRange(start: number, end: number): DecisionEvent[] {
    return this.decisions.filter(d => d.timestamp >= start && d.timestamp <= end)
  }

  /**
   * queryDecisions — 复合条件查询决策事件
   *
   * @param query - 查询参数
   * @returns 匹配的 DecisionEvent 列表
   */
  queryDecisions(query: DecisionEventQuery): DecisionEvent[] {
    let results = [...this.decisions]

    if (query.executionId) {
      results = results.filter(d => d.executionId === query.executionId)
    }
    if (query.source) {
      results = results.filter(d => d.source === query.source)
    }
    if (query.since !== undefined) {
      results = results.filter(d => d.timestamp >= query.since!)
    }
    if (query.until !== undefined) {
      results = results.filter(d => d.timestamp <= query.until!)
    }
    if (query.minConfidence !== undefined) {
      results = results.filter(d => d.confidence >= query.minConfidence!)
    }
    if (query.decision) {
      results = results.filter(d => d.decision === query.decision)
    }
    if (query.twinVersion !== undefined) {
      results = results.filter(d => d.twinVersion === query.twinVersion)
    }

    // 按时间倒序排列
    results.sort((a, b) => b.timestamp - a.timestamp)

    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit)
    }

    return results
  }

  /**
   * getDecisionStats — 获取决策事件统计
   */
  getDecisionStats(): {
    totalDecisions: number
    uniqueExecutions: number
    bySource: Record<string, number>
    avgConfidence: number
    oldestDecision: number
    newestDecision: number
  } {
    const bySource: Record<string, number> = {}
    let totalConfidence = 0
    let oldest = this.decisions.length > 0 ? this.decisions[0].timestamp : 0
    let newest = 0

    for (const d of this.decisions) {
      bySource[d.source] = (bySource[d.source] ?? 0) + 1
      totalConfidence += d.confidence
      if (d.timestamp < oldest) oldest = d.timestamp
      if (d.timestamp > newest) newest = d.timestamp
    }

    return {
      totalDecisions: this.decisions.length,
      uniqueExecutions: this.decisionsByExecution.size,
      bySource,
      avgConfidence: this.decisions.length > 0
        ? Math.round((totalConfidence / this.decisions.length) * 100) / 100
        : 0,
      oldestDecision: oldest,
      newestDecision: newest,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════

  /**
   * getStream — 获取完整事件流
   */
  getStream(): readonly BaseEvent[] {
    return this.events;
  }

  /**
   * getByExecutionId — 按执行/事务 ID 获取事件
   */
  getByExecutionId(executionId: string): BaseEvent[] {
    return this.byExecutionId.get(executionId) ?? [];
  }

  /**
   * getByType — 按事件类型获取
   */
  getByType(type: EventType | string): BaseEvent[] {
    return this.byType.get(type) ?? [];
  }

  /**
   * getByTimeRange — 按时间范围获取
   */
  getByTimeRange(start: number, end: number): BaseEvent[] {
    return this.events.filter(e => e.timestamp >= start && e.timestamp <= end);
  }

  // ═══════════════════════════════════════════════════════════
  // 重放（投影）
  // ═══════════════════════════════════════════════════════════

  /**
   * replay — 通过投影函数重放事件流
   *
   * @param executionId - 要重放的执行 ID
   * @param projector - (state, event) => state 投影函数
   * @param initialState - 初始状态
   * @returns 投影后的最终状态
   */
  async replay<T>(
    executionId: string,
    projector: (state: T, event: BaseEvent) => T,
    initialState: T
  ): Promise<T> {
    const events = this.getByExecutionId(executionId);
    return events.reduce((state, event) => projector(state, event), initialState);
  }

  /**
   * replayAll — 对整个事件流执行投影
   */
  async replayAll<T>(
    projector: (state: T, event: BaseEvent) => T,
    initialState: T
  ): Promise<T> {
    return this.events.reduce((state, event) => projector(state, event), initialState);
  }

  // ═══════════════════════════════════════════════════════════
  // 持久化
  // ═══════════════════════════════════════════════════════════

  /**
   * persist — 全量持久化到 JSONL
   */
  async persist(): Promise<void> {
    await this.flush(true);
    const lines = this.events.map(e => JSON.stringify(e)).join('\n');
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await fs.promises.writeFile(this.logPath, lines + '\n', 'utf-8');
  }

  /**
   * load — 从 JSONL 加载事件流
   */
  async load(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const events: BaseEvent[] = lines.map(line => JSON.parse(line));

      this.events = events;
      this.rebuildIndex();
      console.log(`[EventStore] Loaded ${events.length} events from ${this.logPath}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[EventStore] Load error:', (err as Error).message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════

  /**
   * getStats — 获取事件统计
   */
  getStats(): {
    totalEvents: number;
    byType: Record<string, number>;
    uniqueExecutions: number;
    oldestEvent: number;
    newestEvent: number;
    memoryUsage: number;
  } {
    const byType: Record<string, number> = {};
    let oldest = this.events.length > 0 ? this.events[0].timestamp : 0;
    let newest = 0;

    for (const e of this.events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.timestamp < oldest) oldest = e.timestamp;
      if (e.timestamp > newest) newest = e.timestamp;
    }

    return {
      totalEvents: this.events.length,
      byType,
      uniqueExecutions: this.byExecutionId.size,
      oldestEvent: oldest,
      newestEvent: newest,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  /**
   * clear — 清空事件流
   */
  async clear(): Promise<void> {
    this.events = [];
    this.byExecutionId.clear();
    this.byType.clear();
    this.decisions = [];
    this.decisionsByExecution.clear();
    this.writeBuffer = [];
    await fs.promises.writeFile(this.logPath, '', 'utf-8').catch(() => {});
    await fs.promises.writeFile(path.join(this.dataDir, 'decision-stream.jsonl'), '', 'utf-8').catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * flush — 异步刷写缓冲区到 JSONL
   */
  private async flush(force = false): Promise<void> {
    if (this.flushing && !force) return;
    this.flushing = true;

    while (this.writeBuffer.length > 0) {
      const batch = this.writeBuffer.splice(0, 100);
      const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
      try {
        await fs.promises.mkdir(this.dataDir, { recursive: true });
        await fs.promises.appendFile(this.logPath, lines, 'utf-8');
      } catch (err) {
        console.error('[EventStore] Write error:', err);
        // 写回缓冲区
        this.writeBuffer.unshift(...batch);
        break;
      }
    }

    this.flushing = false;
  }

  /**
   * rebuildIndex — 从事件流重建索引
   */
  private rebuildIndex(): void {
    this.byExecutionId.clear();
    this.byType.clear();

    for (const event of this.events) {
      const execEvents = this.byExecutionId.get(event.executionId);
      if (execEvents) execEvents.push(event);
      else this.byExecutionId.set(event.executionId, [event]);

      const typeEvents = this.byType.get(event.type);
      if (typeEvents) typeEvents.push(event);
      else this.byType.set(event.type, [event]);
    }
  }

  /**
   * rebuildDecisionIndex — 从决策事件流重建索引
   */
  private rebuildDecisionIndex(): void {
    this.decisionsByExecution.clear()

    for (const decision of this.decisions) {
      const execDecisions = this.decisionsByExecution.get(decision.executionId)
      if (execDecisions) execDecisions.push(decision)
      else this.decisionsByExecution.set(decision.executionId, [decision])
    }
  }
}
