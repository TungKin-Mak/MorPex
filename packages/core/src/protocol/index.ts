/**
 * protocol — MorPex Protocol Layer Barrel
 *
 * Phase 1 / MorPex v8: 协议层统一入口。
 *
 * 子模块：
 *   protocol/events/   — 事件协议层（EventType, BaseEvent）
 *
 * 设计原则：
 *   - 协议层不依赖任何运行时组件
 *   - 任何模块都可以安全引用 protocol/
 *   - 协议层可以引用 contracts/（纯类型）
 */

// ── Events Protocol ──
export {
  EventType,
  EVENT_LAYERS,
  getAllEventTypes,
  isStandardEvent,
  isEventInLayer,
  extractEventLayer,
  // Event Sourcing (Phase 4 / v8.5)
  EventStore,
  EventRepository,
  EventProjection,
  // Decision Events (v8.6: Cognitive Event Stream)
  createDecisionEvent,
  decisionToBaseEvent,
  // v9.2 Stage 0: SQLite EventStore
  SqliteEventStore,
  UnifiedEventStore,
} from './events/index.js';
export type {
  BaseEvent,
  IEventStore,
  EventQueryFilter,
  EventStoreStats,
  EventStoreConfig,
  EventQuery,
  AggregationResult,
  MissionProjection,
  SystemProjection,
  DecisionEvent,
  DecisionEventQuery,
  ReplayState,
  SourcingEvent,
} from './events/index.js';

// ═══════════════════════════════════════════════════════════════
// 后续 Phase 将在此进一步扩展：
//
// Phase X: protocol/messages/   — 消息协议层（IncomingMessage, OutgoingMessage）
// Phase X: protocol/commands/   — 命令协议层（Command pattern）
// Phase X: protocol/states/     — 状态协议层（State descriptors）
// ═══════════════════════════════════════════════════════════════
