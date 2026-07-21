/**
 * protocol/events/store — Event Sourcing Barrel
 *
 * Phase 4 / MorPex v8.5: 事件溯源存储层。
 *
 * v9.2 Stage 0:
 *   - 新增 IEventStore 接口（统一契约）
 *   - 新增 SqliteEventStore（SQLite 实现，取代 JSONL）
 *   - 新增 UnifiedEventStore（兼容新旧 API 的门面）
 *   - 旧 EventStore 标记为 @deprecated，保留向后兼容
 */

// ── v9.2 Stage 0: 统一 EventStore ──
export type { IEventStore } from './IEventStore.js';
export type { EventQueryFilter, EventStoreStats } from './IEventStore.js';
export { SqliteEventStore } from './SqliteEventStore.js';
export { UnifiedEventStore } from './UnifiedEventStore.js';
export type { ReplayState, SourcingEvent } from './UnifiedEventStore.js';

// ── 旧版 EventStore（@deprecated，保留向后兼容） ──
/** @deprecated 使用 UnifiedEventStore 或 IEventStore 代替 */
export { EventStore } from './EventStore.js';
export type { EventStoreConfig } from './EventStore.js';

/** @deprecated 使用 UnifiedEventStore.query() 代替 */
export { EventRepository } from './EventRepository.js';
export type { EventQuery, AggregationResult } from './EventRepository.js';

/** @deprecated 保留向后兼容 */
export { EventProjection } from './EventProjection.js';
export type { MissionProjection, SystemProjection } from './EventProjection.js';
