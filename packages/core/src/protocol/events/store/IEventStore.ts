/**
 * IEventStore — 统一 EventStore 接口
 *
 * v9.2 Stage 0: 定义统一的 EventStore 契约。
 * 所有模块通过此接口访问事件存储，不依赖具体实现。
 *
 * 设计原则:
 *   - 接口最小化：只暴露必要方法
 *   - 异步友好：所有方法返回 Promise
 *   - 可替换：内存 / SQLite / PostgreSQL 均可实现
 */

import type { BaseEvent } from '../BaseEvent.js';
import type { DecisionEvent } from '../DecisionEvent.js';

// ── 查询过滤条件 ──

export interface EventQueryFilter {
  executionId?: string;
  type?: string;
  source?: string;
  since?: number;          // timestamp >= since
  until?: number;          // timestamp <= until
  aggregateId?: string;
  limit?: number;
  offset?: number;
}

// ── 存储统计 ──

export interface EventStoreStats {
  totalEvents: number;
  totalDecisions: number;
  byType: Record<string, number>;
  latestSequence: number;
  dbSizeBytes: number;
}

// ── IEventStore 接口 ──

export interface IEventStore {
  /** 追加一条 BaseEvent */
  append(event: BaseEvent): Promise<void>;

  /** 批量追加 BaseEvent（事务内） */
  appendBatch(events: BaseEvent[]): Promise<void>;

  /** 追加一条 DecisionEvent（存入独立表） */
  appendDecision(decision: DecisionEvent): Promise<void>;

  /** 按条件查询事件 */
  query(filter: EventQueryFilter): Promise<BaseEvent[]>;

  /** 按条件查询决策事件 */
  queryDecisions(filter: EventQueryFilter): Promise<DecisionEvent[]>;

  /** 异步迭代器：从 sequence 开始重放 */
  replay(fromSequence?: number): AsyncIterable<BaseEvent>;

  /** 获取最新 sequence 号 */
  getLatestSequence(): Promise<number>;

  /** 获取存储统计 */
  getStats(): Promise<EventStoreStats>;

  /** 清空所有事件（测试用） */
  clear(): Promise<void>;

  /** 关闭数据库连接 */
  close(): Promise<void>;
}
