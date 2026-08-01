/**
 * UnifiedEventStore — 统一 EventStore 门面
 *
 * v9.2 Stage 0: 桥接新旧 EventStore API。
 * 内部使用 SqliteEventStore，对外暴露旧版 API 实现平滑迁移。
 *
 * 旧 API 兼容（@deprecated，用于迁移期）:
 *   - replay(executionId?) → ReplayState        (旧 EventStore)
 *   - query(executionId) → SourcingEvent[]       (旧 EventStore)
 *   - queryByType(type, limit) → SourcingEvent[] (旧 EventStore)
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

// ── 旧版 ReplayState 类型（保持兼容） ──

/**
 * ReplayState — 重放状态（兼容旧 EventStore API）
 * @deprecated 使用 IEventStore.query() 代替
 */
export interface ReplayState {
  toolCallStates: Map<string, string>;
  fsmStates: Map<string, string>;
  activeArtifacts: Set<string>;
  activeTickets: Map<string, string>;
  activeWorkers: Map<string, string>;
  dagNodeStates: Map<string, string>;
  totalEvents: number;
}

// ── 旧版 SourcingEvent 类型（保持兼容） ──

/**
 * SourcingEvent — 旧版事件类型联合
 * @deprecated 使用 BaseEvent 代替
 */
export type SourcingEvent =
  | { type: 'tool_call_state_change'; toolCallId: string; from: string; to: string; ts: number; execId: string }
  | { type: 'fsm_transition'; taskId: string; from: string; to: string; ts: number; execId: string }
  | { type: 'artifact_created'; artifactId: string; ts: number; execId: string; name?: string }
  | { type: 'artifact_updated'; artifactId: string; version: number; ts: number; execId: string }
  | { type: 'negotiation_ticket_created'; ticketId: string; ts: number; execId: string; sourceDomain?: string; targetDomain?: string }
  | { type: 'negotiation_ticket_resolved'; ticketId: string; status: string; ts: number; execId: string }
  | { type: 'worker_spawned'; toolCallId: string; ts: number; execId: string; toolName?: string }
  | { type: 'worker_terminated'; toolCallId: string; reason: string; ts: number; execId: string }
  | { type: 'dag_node_status_change'; nodeId: string; from: string; to: string; ts: number; execId: string };

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
  // ★ 旧版 API 兼容（@deprecated）
  // ═══════════════════════════════════════════════════════════════

  /**
   * replay — 重放事件流（兼容旧 EventStore）
   * @deprecated 使用 IEventStore.query() + replay() 代替
   */
  async replayLegacy(executionId?: string): Promise<ReplayState> {
    const state: ReplayState = {
      toolCallStates: new Map(),
      fsmStates: new Map(),
      activeArtifacts: new Set(),
      activeTickets: new Map(),
      activeWorkers: new Map(),
      dagNodeStates: new Map(),
      totalEvents: 0,
    };

    const events = executionId
      ? await this.query({ executionId, limit: 100000 })
      : await this.query({ limit: 100000 });

    for (const event of events) {
      state.totalEvents++;
      const t = event.type;

      switch (t) {
        case 'tool_call_state_change':
        case 'fsm_transition':
        case 'dag_node_status_change': {
          const p = event.payload as any;
          if (p?.taskId) state.fsmStates.set(p.taskId, p.to ?? '');
          if (p?.toolCallId) state.toolCallStates.set(p.toolCallId, p.to ?? '');
          if (p?.nodeId) state.dagNodeStates.set(p.nodeId, p.to ?? '');
          break;
        }
        case 'artifact_created':
          state.activeArtifacts.add((event.payload as any)?.artifactId ?? event.id);
          break;
        case 'artifact_updated':
          state.activeArtifacts.add((event.payload as any)?.artifactId ?? event.id);
          break;
        case 'negotiation_ticket_created':
          state.activeTickets.set((event.payload as any)?.ticketId ?? event.id, 'PENDING');
          break;
        case 'negotiation_ticket_resolved':
          state.activeTickets.set((event.payload as any)?.ticketId ?? event.id, (event.payload as any)?.status ?? 'RESOLVED');
          break;
        case 'worker_spawned':
          state.activeWorkers.set((event.payload as any)?.toolCallId ?? event.id, 'spawned');
          break;
        case 'worker_terminated':
          state.activeWorkers.set((event.payload as any)?.toolCallId ?? event.id, 'terminated');
          break;
      }
    }

    return state;
  }

  /**
   * query (legacy) — 按 executionId 查询旧版 SourcingEvent
   * @deprecated 使用 IEventStore.query({ executionId }) 代替
   */
  async queryLegacy(executionId: string): Promise<SourcingEvent[]> {
    const events = await this.query({ executionId, limit: 100000 });
    return events.map(e => this.toSourcingEvent(e)).filter(Boolean) as SourcingEvent[];
  }

  /**
   * queryByType — 按事件类型查询旧版事件
   * @deprecated 使用 IEventStore.query({ type }) 代替
   */
  async queryByType(type: string, limit: number = 100): Promise<SourcingEvent[]> {
    const events = await this.query({ type, limit });
    return events.map(e => this.toSourcingEvent(e)).filter(Boolean) as SourcingEvent[];
  }

  /**
   * getStream — 获取完整事件流（兼容新 EventStore API）
   * 注意：返回快照，不反映后续写入
   */
  async getStream(): Promise<BaseEvent[]> {
    return this.query({ limit: 100000 });
  }

  /**
   * getByExecutionId — 按 executionId 获取（兼容新 EventStore API）
   */
  async getByExecutionId(executionId: string): Promise<BaseEvent[]> {
    return this.query({ executionId, limit: 100000 });
  }

  /**
   * getDecisionStream — 获取完整决策事件流
   */
  async getDecisionStream(): Promise<DecisionEvent[]> {
    return this.queryDecisions({ limit: 100000 });
  }

  /**
   * getDecisionsByExecution — 按 executionId 获取决策事件
   */
  async getDecisionsByExecution(executionId: string): Promise<DecisionEvent[]> {
    return this.queryDecisions({ executionId, limit: 100000 });
  }

  /**
   * load — 兼容旧 API（SQLite 始终就绪）
   * @deprecated SQLite 无需加载
   */
  async load(): Promise<void> {
    // no-op: SQLite is always ready
  }

  /**
   * persist — 兼容旧 API（SQLite 实时持久化）
   * @deprecated SQLite 数据实时写入
   */
  async persist(): Promise<void> {
    // no-op: data is immediately durable
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * toSourcingEvent — 将 BaseEvent 映射为旧版 SourcingEvent
   * 仅转换已知的旧版事件类型，未知类型返回 null
   */
  private toSourcingEvent(event: BaseEvent): SourcingEvent | null {
    const p = event.payload as any;
    switch (event.type) {
      case 'tool_call_state_change':
      case 'fsm_transition':
      case 'dag_node_status_change':
        return {
          type: event.type as any,
          toolCallId: p?.toolCallId ?? '',
          taskId: p?.taskId ?? '',
          nodeId: p?.nodeId ?? '',
          from: p?.from ?? '',
          to: p?.to ?? '',
          ts: event.timestamp,
          execId: event.executionId,
        } as any;
      case 'artifact_created':
        return { type: 'artifact_created', artifactId: p?.artifactId ?? '', ts: event.timestamp, execId: event.executionId, name: p?.name } as any;
      case 'artifact_updated':
        return { type: 'artifact_updated', artifactId: p?.artifactId ?? '', version: p?.version ?? 0, ts: event.timestamp, execId: event.executionId } as any;
      case 'negotiation_ticket_created':
        return { type: 'negotiation_ticket_created', ticketId: p?.ticketId ?? '', ts: event.timestamp, execId: event.executionId } as any;
      case 'negotiation_ticket_resolved':
        return { type: 'negotiation_ticket_resolved', ticketId: p?.ticketId ?? '', status: p?.status ?? 'RESOLVED', ts: event.timestamp, execId: event.executionId } as any;
      case 'worker_spawned':
        return { type: 'worker_spawned', toolCallId: p?.toolCallId ?? '', ts: event.timestamp, execId: event.executionId } as any;
      case 'worker_terminated':
        return { type: 'worker_terminated', toolCallId: p?.toolCallId ?? '', reason: p?.reason ?? '', ts: event.timestamp, execId: event.executionId } as any;
      default:
        return null;
    }
  }
}
