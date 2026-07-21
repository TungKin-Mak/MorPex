/**
 * protocol/events — MorPex Event Protocol Barrel
 *
 * Phase 1 / MorPex v8: 事件协议层统一导出入口。
 *
 * 导出：
 *   - EventType:         标准事件类型枚举
 *   - EVENT_LAYERS:      事件类型按层分组
 *   - getAllEventTypes:  获取所有标准事件类型
 *   - BaseEvent:         基础事件接口
 *   - isStandardEvent:   判断是否为标准事件类型
 *   - isEventInLayer:    判断事件是否属于指定层
 *   - extractEventLayer: 从事件类型提取层名称
 */

export { EventType, EVENT_LAYERS, getAllEventTypes } from './EventType.js';
export type { BaseEvent } from './BaseEvent.js';
export { isStandardEvent, isEventInLayer, extractEventLayer } from './BaseEvent.js';

// ── Decision Events (v8.6: Cognitive Event Stream) ──
export type { DecisionEvent, DecisionEventQuery } from './DecisionEvent.js';
export { createDecisionEvent, decisionToBaseEvent } from './DecisionEvent.js';

// ── Event Sourcing Store (v9.2 Stage 0: 统一 IEventStore + SQLite) ──
export type { IEventStore } from './store/index.js';
export { SqliteEventStore, UnifiedEventStore, EventStore, EventRepository, EventProjection } from './store/index.js';
export type { EventQueryFilter, EventStoreStats, EventStoreConfig, EventQuery, AggregationResult, MissionProjection, SystemProjection } from './store/index.js';
export type { ReplayState, SourcingEvent } from './store/UnifiedEventStore.js';

// ═══════════════════════════════════════════════════════════════
// 遗留事件类型映射表
//
// 以下是从现有代码中收集的事件类型与 EventType 枚举的对照。
// 用于逐步迁移 emit() 调用点。
//
// 现有事件字符串               → EventType 枚举值
// ──────────────────────────────────────────────────────────────
// 'kernel.started'             → EventType.SYSTEM_STARTED
// 'artifact.created'           → EventType.ARTIFACT_CREATED
// 'artifact.updated'           → EventType.ARTIFACT_UPDATED
// 'runtime.task.started'       → EventType.NODE_STARTED
// 'runtime.task.completed'     → EventType.NODE_COMPLETED
// 'runtime.task.awaiting_input'→ (自定义扩展，尚无标准定义)
// 'dag.node.failed'            → EventType.NODE_FAILED
// 'workflow.step_started'      → EventType.WORKFLOW_STEP_STARTED
// 'workflow.step_completed'    → EventType.WORKFLOW_STEP_COMPLETED
// 'workflow.step_failed'       → EventType.NODE_FAILED（等义）
// 'workflow.completed'         → EventType.EXECUTION_COMPLETED
// 'workflow.failed'            → EventType.EXECUTION_FAILED
// 'message_update'             → (自定义扩展，流式消息更新)
// 'message_complete'           → (自定义扩展，流式消息完成)
// 'cross_domain.artifact_shared' → EventType.CROSS_DOMAIN_ARTIFACT_SHARED
// 'cross_domain.dag_created'   → EventType.CROSS_DOMAIN_DAG_CREATED
// 'runtime.execution.created'  → EventType.EXECUTION_STARTED
// 'runtime.execution.start'    → EventType.EXECUTION_STARTED
// 'runtime.execution.complete' → EventType.EXECUTION_COMPLETED
// 'gateway.adapter.registered' → (自定义扩展)
// 'gateway.harness.attached'   → (自定义扩展)
// 'gateway.memory.attached'    → (自定义扩展)
// 'memory.activated'           → EventType.MEMORY_READ
// 'negotiation_ticket_created' → (自定义扩展)
// 'negotiation_ticket_resolved'→ (自定义扩展)
// 'stream.started'             → (自定义扩展)
// 'stream.failed'              → (自定义扩展)
// 'run.started'                → EventType.EXECUTION_STARTED
// 'run.completed'              → EventType.EXECUTION_COMPLETED
// 'run.failed'                 → EventType.EXECUTION_FAILED
// 'run.cancelled'              → EventType.EXECUTION_CANCELLED
// 'domain.active'              → (自定义扩展)
// 'domain.error'               → (自定义扩展)
// 'domain.sleeping'            → (自定义扩展)
// 'domain.task_completed'      → EventType.NODE_COMPLETED
// 'domain.waking'              → (自定义扩展)
// 'human.'                     → (自定义扩展，待 v8 Interaction 层定义)
// ═══════════════════════════════════════════════════════════════
