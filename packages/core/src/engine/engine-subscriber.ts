/**
 * Engine Subscriber — 引擎事件订阅器
 *
 * 订阅 EventBus 上的 engine/* 事件，写入 EventStore 和 Memory 系统。
 * 替代旧的 EventStoreSubscriber + MemoryBusListener 在新引擎中的角色。
 *
 * 订阅的事件类型：
 *   - workflow.step_started    → dag_node_status_change (EventStore)
 *   - workflow.step_completed  → dag_node_status_change (EventStore)
 *   - workflow.step_failed     → dag_node_status_change (EventStore)
 *   - workflow.completed       → workflow event
 *   - workflow.failed          → workflow event
 *   - agent.result             → MemoryBusListener (归档到 VectorStore)
 */

import type { EventBus } from '../common/EventBus.js';
import { EventStore, type SourcingEvent } from '../event/EventStore.js';

export interface EngineSubscriberConfig {
  eventBus: EventBus;
  eventStore?: EventStore;
  memoryBus?: { upsert: (type: string, content: string, importance: number) => Promise<void> };
}

export class EngineSubscriber {
  private eventBus: EventBus;
  private eventStore?: EventStore;
  private memoryBus?: { upsert: (type: string, content: string, importance: number) => Promise<void> };
  private unsubs: Array<() => void> = [];

  constructor(config: EngineSubscriberConfig) {
    this.eventBus = config.eventBus;
    this.eventStore = config.eventStore;
    this.memoryBus = config.memoryBus;
  }

  start(): void {
    // 订阅工作流事件 → EventStore
    this.subscribeTo('workflow.step_started', (event) => {
      if (!this.eventStore) return;
      const p = event.payload as any;
      const sourcingEvent: SourcingEvent = {
        type: 'dag_node_status_change',
        nodeId: p?.stepId ?? 'unknown',
        from: 'pending',
        to: 'running',
        ts: event.timestamp,
        execId: event.executionId,
      };
      this.eventStore.append(sourcingEvent).catch(() => {});
    });

    this.subscribeTo('workflow.step_completed', (event) => {
      if (!this.eventStore) return;
      const p = event.payload as any;
      const sourcingEvent: SourcingEvent = {
        type: 'dag_node_status_change',
        nodeId: p?.stepId ?? 'unknown',
        from: 'running',
        to: 'completed',
        ts: event.timestamp,
        execId: event.executionId,
      };
      this.eventStore.append(sourcingEvent).catch(() => {});
    });

    this.subscribeTo('workflow.step_failed', (event) => {
      if (!this.eventStore) return;
      const p = event.payload as any;
      const sourcingEvent: SourcingEvent = {
        type: 'dag_node_status_change',
        nodeId: p?.stepId ?? 'unknown',
        from: 'running',
        to: 'failed',
        ts: event.timestamp,
        execId: event.executionId,
      };
      this.eventStore.append(sourcingEvent).catch(() => {});
    });

    // 订阅工作流完成事件 → MemoryBus
    this.subscribeTo('workflow.completed', (event) => {
      if (!this.memoryBus) return;
      const p = event.payload as any;
      const summary = `工作流完成: execution=${event.executionId}, 步骤=${p?.totalSteps ?? '?'}, 耗时=${p?.totalDurationMs ?? '?'}ms`;
      this.memoryBus.upsert('workflow_summary', summary, 3).catch(() => {});
    });

    this.subscribeTo('workflow.failed', (event) => {
      if (!this.memoryBus) return;
      const p = event.payload as any;
      const summary = `工作流失败: execution=${event.executionId}, 错误=${p?.error ?? '?'}`;
      this.memoryBus.upsert('workflow_failure', summary, 5).catch(() => {});
    });

    // 订阅 Agent 结果事件 → MemoryBus（替代旧的 MemoryBusListener）
    this.subscribeTo('agent.result', (event) => {
      if (!this.memoryBus) return;
      const p = event.payload as any;
      const content = p?.content ?? p?.summary ?? '';
      if (content.length > 20) {
        this.memoryBus.upsert('agent_reflection', content.slice(0, 2000), 3).catch(() => {});
      }
    });
  }

  stop(): void {
    for (const unsub of this.unsubs) {
      try { unsub(); } catch {}
    }
    this.unsubs = [];
  }

  private subscribeTo(type: string, handler: (event: any) => void): void {
    const unsub = this.eventBus.on(type, handler);
    this.unsubs.push(unsub);
  }
}
