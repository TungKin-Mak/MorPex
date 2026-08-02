/**
 * protocol/events/store — Event Sourcing Barrel
 *
 * Phase 4 / MorPex v8.5: 事件溯源存储层。
 *
 * v9.2 Stage 0 + Wave 9：统一 IEventStore 契约；旧版 EventStore 已删除（纯架构）。
 */

// ── 统一 EventStore ──
export type { IEventStore } from './IEventStore.js';
export type { EventQueryFilter, EventStoreStats } from './IEventStore.js';
export { SqliteEventStore } from './SqliteEventStore.js';
export { UnifiedEventStore } from './UnifiedEventStore.js';

// ── 事件查询层（IEventStore 异步 API，Wave 9） ──
export { EventRepository } from './EventRepository.js';
export type { EventQuery, AggregationResult } from './EventRepository.js';

// ── 事件投影 ──
export { EventProjection } from './EventProjection.js';
export type { MissionProjection, SystemProjection } from './EventProjection.js';
