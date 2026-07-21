/**
 * protocol/events/store — Event Sourcing Barrel
 *
 * Phase 4 / MorPex v8.5: 事件溯源存储层。
 */

export { EventStore } from './EventStore.js';
export type { EventStoreConfig } from './EventStore.js';

export { EventRepository } from './EventRepository.js';
export type { EventQuery, AggregationResult } from './EventRepository.js';

export { EventProjection } from './EventProjection.js';
export type { MissionProjection, SystemProjection } from './EventProjection.js';
