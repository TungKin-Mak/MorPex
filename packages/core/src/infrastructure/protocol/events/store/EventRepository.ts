/**
 * EventRepository — 事件查询层（Wave 9 迁移：EventStore → IEventStore 异步 API）
 *
 * Phase 4 / MorPex v8.5: 在 IEventStore 基础上提供过滤、聚合、时序查询。
 *
 * 使用方式:
 *   const repo = new EventRepository(eventStore);
 *   const errors = await repo.query({ types: [EventType.SYSTEM_ERROR], since: Date.now() - 3600000 });
 *   const timeline = await repo.getTimeline('mis_001');
 *   const counts = await repo.aggregate();
 */

import type { IEventStore } from './IEventStore.js';
import { EventType } from '../EventType.js';
import type { BaseEvent } from '../BaseEvent.js';

// ── 查询参数 ──

export interface EventQuery {
  /** 按执行 ID 过滤 */
  executionId?: string;
  /** 按事件类型列表过滤 */
  types?: (EventType | string)[];
  /** 起始时间戳 */
  since?: number;
  /** 结束时间戳 */
  until?: number;
  /** 按来源组件过滤 */
  source?: string;
  /** 最大返回条数 */
  limit?: number;
  /** 跳过前 N 条 */
  offset?: number;
  /** 排序方式 */
  orderBy?: 'timestamp-asc' | 'timestamp-desc';
}

export interface AggregationResult {
  type: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export class EventRepository {
  private store: IEventStore;

  constructor(store: IEventStore) {
    this.store = store;
  }

  /**
   * query — 按条件查询事件
   *
   * 支持 executionId、事件类型、时间范围、来源组件过滤。
   * 按 orderBy 排序，支持分页。
   */
  async query(q: EventQuery): Promise<BaseEvent[]> {
    let results = await this.store.query({});

    // 按 executionId 过滤
    if (q.executionId) {
      results = await this.store.query({ executionId: q.executionId });
    }

    // 按事件类型过滤
    if (q.types && q.types.length > 0) {
      const typeSet = new Set(q.types);
      results = results.filter(e => typeSet.has(e.type));
    }

    // 按时间范围过滤
    if (q.since !== undefined) {
      results = results.filter(e => e.timestamp >= q.since!);
    }
    if (q.until !== undefined) {
      results = results.filter(e => e.timestamp <= q.until!);
    }

    // 按来源组件过滤
    if (q.source) {
      results = results.filter(e => e.source === q.source);
    }

    // 排序
    if (q.orderBy === 'timestamp-desc') {
      results.sort((a, b) => b.timestamp - a.timestamp);
    } else {
      results.sort((a, b) => a.timestamp - b.timestamp);
    }

    // 分页
    if (q.offset) {
      results = results.slice(q.offset);
    }
    if (q.limit) {
      results = results.slice(0, q.limit);
    }

    return results;
  }

  /**
   * getLatest — 获取某个事务的最新特定类型事件
   */
  async getLatest(executionId: string, type: EventType | string): Promise<BaseEvent | null> {
    const events = (await this.store.query({ executionId }))
      .filter(e => e.type === type)
      .sort((a, b) => b.timestamp - a.timestamp);
    return events[0] ?? null;
  }

  /**
   * count — 统计匹配条件的事件数
   */
  async count(q: Omit<EventQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number> {
    return (await this.query({ ...q, limit: 0 })).length;
  }

  /**
   * aggregate — 按事件类型聚合统计
   *
   * 可选择限定 executionId。
   */
  async aggregate(executionId?: string): Promise<AggregationResult[]> {
    const events = executionId
      ? await this.store.query({ executionId })
      : await this.store.query({});

    const typeMap = new Map<string, { count: number; first: number; last: number }>();

    for (const e of events) {
      const existing = typeMap.get(e.type);
      if (existing) {
        existing.count++;
        if (e.timestamp < existing.first) existing.first = e.timestamp;
        if (e.timestamp > existing.last) existing.last = e.timestamp;
      } else {
        typeMap.set(e.type, { count: 1, first: e.timestamp, last: e.timestamp });
      }
    }

    return [...typeMap.entries()]
      .map(([type, data]) => ({
        type,
        count: data.count,
        firstSeen: data.first,
        lastSeen: data.last,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * getTimeline — 获取事务的完整时间线
   *
   * 返回按时间排序的事件序列，可用于重建事务的完整演化过程。
   */
  async getTimeline(executionId: string): Promise<BaseEvent[]> {
    return this.query({
      executionId,
      orderBy: 'timestamp-asc',
    });
  }

  /**
   * getStateAt — 获取事务在某个时间点的状态
   *
   * 返回指定时间点之前的最新事件列表。
   * 用于"回滚查看"场景。
   */
  async getStateAt(executionId: string, timestamp: number): Promise<BaseEvent[]> {
    return (await this.store.query({ executionId }))
      .filter(e => e.timestamp <= timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}
