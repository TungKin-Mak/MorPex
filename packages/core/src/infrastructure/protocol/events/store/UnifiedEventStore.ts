/**
 * UnifiedEventStore — 统一 EventStore 门面
 *
 * v9.2 Stage 0: 桥接新旧 EventStore API。
 * 内部使用 SqliteEventStore，实现 IEventStore 统一契约（append/appendDecision/query/replay）。
 *
 * Wave 9：旧版 API 兼容层（replayLegacy/queryLegacy/getStream/getByExecutionId/ReplayState/
 * SourcingEvent/load/persist）已删除——仅保留 IEventStore 标准接口。
 *   - getStream() → BaseEvent[]                  (新 EventStore)
 *   - getByExecutionId(id) → BaseEvent[]          (新 EventStore)
 *
 * 使用方式（生产）:
 *   const store = new UnifiedEventStore();
 *   await store.append(event);
 *   const events = await store.query({ executionId: 'mis_123' });
 */

import type { BaseEvent } from '../BaseEvent.js';
import type { DecisionEvent } from '../DecisionEvent.js';
import type { EventQueryFilter, EventStoreStats, IEventStore } from './IEventStore.js';
import { SqliteEventStore, createSqliteEventStore } from './SqliteEventStore.js';

// ── UnifiedEventStore — 统一门面 ──

export class UnifiedEventStore implements IEventStore {
  private inner!: SqliteEventStore;

  /**
   * @param dbOrPath - SQLite Database 实例、路径字符串、或空（使用默认路径）
   */
  constructor(dbOrPath?: any) {
    if (dbOrPath && typeof dbOrPath !== 'string' && typeof dbOrPath.prepare === 'function') {
      // It's a Database instance (DI mode)
      this.inner = new SqliteEventStore(dbOrPath);
    } else {
      // It's a path string or undefined — store for lazy init
      this._pendingDbPath = dbOrPath;
    }
  }

  private _pendingDbPath: string | undefined;

  /**
   * init — 延迟初始化（异步，仅在需要时调用）
   */
  async init(): Promise<void> {
    if (this.inner) return;
    if (this._pendingDbPath !== undefined && typeof this._pendingDbPath !== 'string') {
      throw new Error('Invalid constructor argument: expected a Database instance, string path, or undefined');
    }
    this.inner = await createSqliteEventStore(this._pendingDbPath);
    this._pendingDbPath = undefined;
  }

  /**
   * ensureDb — 确保 inner 已初始化
   */
  private async ensureDb(): Promise<SqliteEventStore> {
    await this.init();
    return this.inner;
  }

  // ═══════════════════════════════════════════════════════════════
  // ★ IEventStore 接口（推荐）
  // ═══════════════════════════════════════════════════════════════

  async append(event: BaseEvent): Promise<void> {
    const db = await this.ensureDb();
    await db.append(event);
  }

  async appendBatch(events: BaseEvent[]): Promise<void> {
    const db = await this.ensureDb();
    await db.appendBatch(events);
  }

  async appendDecision(decision: DecisionEvent): Promise<void> {
    const db = await this.ensureDb();
    await db.appendDecision(decision);
  }

  async query(filter: EventQueryFilter): Promise<BaseEvent[]> {
    const db = await this.ensureDb();
    return db.query(filter);
  }

  async queryDecisions(filter: EventQueryFilter): Promise<DecisionEvent[]> {
    const db = await this.ensureDb();
    return db.queryDecisions(filter);
  }

  replay(fromSequence?: number): AsyncIterable<BaseEvent> {
    // 延迟初始化：实际的 Error 会在首次迭代时抛出
    return this.inner
      ? this.inner.replay(fromSequence)
      : this.lazyReplay(fromSequence);
  }

  private async *lazyReplay(fromSequence?: number): AsyncIterable<BaseEvent> {
    const db = await this.ensureDb();
    yield* db.replay(fromSequence);
  }

  async getLatestSequence(): Promise<number> {
    const db = await this.ensureDb();
    return db.getLatestSequence();
  }

  // ═══════════════════════════════════════════════════════════════
  // ★ Event Sourcing 方法（v16 新增）
  // ═══════════════════════════════════════════════════════════════

  /** 按 executionId 重放所有事件（事件源） */
  async replayStream(executionId: string): Promise<BaseEvent[]> {
    return this.query({ executionId });
  }

  /** 按事件类型重放所有事件（事件源） */
  async replayByType(eventType: string): Promise<BaseEvent[]> {
    return this.query({ type: eventType });
  }

  /** 获取系统全局统计 */
  async getSystemStats(): Promise<{ totalEvents: number; byType: Record<string, number>; totalMissions: number; totalArtifacts: number }> {
    const all = await this.query({});
    const byType: Record<string, number> = {};
    for (const e of all) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return {
      totalEvents: all.length,
      byType,
      totalMissions: all.filter(e => e.type.startsWith('mission.')).length,
      totalArtifacts: all.filter(e => e.type.startsWith('artifact.')).length,
    };
  }

  async getStats(): Promise<EventStoreStats> {
    const db = await this.ensureDb();
    return db.getStats();
  }

  async clear(): Promise<void> {
    const db = await this.ensureDb();
    await db.clear();
  }

  async close(): Promise<void> {
    const db = await this.ensureDb();
    await db.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * getDatabase — 暴露内部 SQLite 实例（功能③ Phase 2 统一召回接线）
   *
   * 供 ContextPersistence（装配快照持久化）共享同一 SQLite 连接：
   * `ServiceContainer.getContextPersistence()` 依赖此方法（此前 UnifiedEventStore
   * 未委托 → getContextPersistence 恒返 null → 装配快照侧在生产路径死代码）。
   * 未初始化（无事件写入）→ undefined（调用方应先在 recall 前 await init()）。
   */
  getDatabase(): unknown {
    return (this.inner as unknown as { getDatabase?: () => unknown })?.getDatabase?.();
  }

  /**
   * enableAutoCompaction — 启用定时自动压缩 + VACUUM（数据治理：快照归档 + 定期清理）
   *
   * 委托给底层 SqliteEventStore：定时清理旧事件/保留每 Mission 最新快照/保留每产物最新版本，
   * 清理量或库体积超阈值时 VACUUM 回收磁盘（morpex-events.db 增长治理）。
   *
   * @param intervalMs - 运行间隔（默认 12 小时）
   */
  async enableAutoCompaction(intervalMs?: number): Promise<void> {
    const db = await this.ensureDb();
    db.enableAutoCompaction(intervalMs);
  }

  /**
   * disableAutoCompaction — 停止定时自动压缩
   */
  async disableAutoCompaction(): Promise<void> {
    const db = await this.ensureDb();
    db.disableAutoCompaction();
  }
}