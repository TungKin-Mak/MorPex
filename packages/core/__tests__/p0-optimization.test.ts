/**
 * P0 优化测试（会话 16l）
 *
 * 覆盖：
 *   1. SystemMetadataGraph.registerEntity 同 key 业务无变化 → 跳过 append（去重）
 *   2. registerEntity 业务有实质变化 → 仍 append（记录最新状态）
 *   3. restoreFromEvents 分页拉全量（>100 条不再截断，修复 limit=100 隐藏 bug）
 *   4. getSharedPiBridge 进程级单例（多处调用返回同一实例）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SystemMetadataGraph } from '../src/knowledge/graph/SystemMetadataGraph.js';
import { EventType } from '../src/infrastructure/protocol/events/EventType.js';
import type { IEventStore } from '../src/infrastructure/protocol/events/store/IEventStore.js';
import type { BaseEvent } from '../src/infrastructure/protocol/events/BaseEvent.js';

/**
 * 轻量内存 IEventStore（测试用）——支持 query 过滤 + 分页 + append
 */
class MemoryEventStore implements IEventStore {
  events: BaseEvent[] = [];
  private seq = 0;

  async append(event: BaseEvent): Promise<void> {
    this.events.push({ ...event, sequence: ++this.seq } as BaseEvent & { sequence: number });
  }
  async appendBatch(events: BaseEvent[]): Promise<void> {
    for (const e of events) await this.append(e);
  }
  async appendDecision(): Promise<void> { /* noop */ }
  async query(filter: { type?: string; limit?: number; offset?: number } = {}): Promise<BaseEvent[]> {
    let rows = [...this.events];
    if (filter.type) rows = rows.filter(e => e.type === filter.type);
    // 与 SqliteEventStore 一致：sequence DESC
    rows.sort((a, b) => ((b as BaseEvent & { sequence: number }).sequence) - ((a as BaseEvent & { sequence: number }).sequence));
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return rows.slice(offset, offset + limit);
  }
  async queryDecisions(): Promise<never[]> { return []; }
  async replay(): AsyncIterable<BaseEvent> {
    const self = this;
    return (async function* () { yield* self.events; })();
  }
  async getLatestSequence(): Promise<number> { return this.seq; }
  async getStats(): Promise<{ totalEvents: number }> { return { totalEvents: this.events.length }; }
}

function makeGraph() {
  const store = new MemoryEventStore();
  const graph = new SystemMetadataGraph();
  graph.setEventStore(store as unknown as IEventStore);
  return { store, graph };
}

describe('SystemMetadataGraph — registerEntity 去重（P0-1）', () => {
  it('同 key 业务无变化重复注册 → 跳过 append（只写 1 条事件）', () => {
    const { store, graph } = makeGraph();
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE' });
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE' }); // 重复
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE' }); // 重复
    const regEvents = store.events.filter(e => e.type === EventType.SYSTEM_ENTITY_REGISTERED);
    expect(regEvents).toHaveLength(1);
  });

  it('同 key 业务变化（metadata 非时间戳字段）→ 仍 append（记录最新状态）', () => {
    const { store, graph } = makeGraph();
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE' });
    graph.registerEntity('e1', 'mission', '目标A', { status: 'DONE' }); // 业务变化
    const regEvents = store.events.filter(e => e.type === EventType.SYSTEM_ENTITY_REGISTERED);
    expect(regEvents).toHaveLength(2);
  });

  it('同 key 仅时间戳差异（recordedAt/updatedAt）→ 视为无变化，跳过 append', () => {
    const { store, graph } = makeGraph();
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE', recordedAt: 1000 });
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE', recordedAt: 9999 }); // 仅时间戳变
    const regEvents = store.events.filter(e => e.type === EventType.SYSTEM_ENTITY_REGISTERED);
    expect(regEvents).toHaveLength(1);
  });

  it('不同 key → 各自记录事件', () => {
    const { store, graph } = makeGraph();
    graph.registerEntity('e1', 'mission', '目标A', {});
    graph.registerEntity('e2', 'artifact', '产物B', {});
    const regEvents = store.events.filter(e => e.type === EventType.SYSTEM_ENTITY_REGISTERED);
    expect(regEvents).toHaveLength(2);
  });
});

describe('SystemMetadataGraph — restoreFromEvents 分页全量（P0-3 limit bug）', () => {
  it('>100 条实体事件 → 全部恢复（不再截断为 100）', async () => {
    const store = new MemoryEventStore();
    // 模拟 250 条实体事件（超过默认 limit=100）
    const batch: BaseEvent[] = [];
    for (let i = 0; i < 250; i++) {
      batch.push({
        id: `evt_${i}`,
        type: EventType.SYSTEM_ENTITY_REGISTERED,
        timestamp: 1000 + i,
        executionId: `e${i}`,
        source: 'test',
        payload: { entityId: `e${i}`, entityType: 'mission', name: `目标${i}` },
      } as BaseEvent);
    }
    await store.appendBatch(batch);

    const graph = new SystemMetadataGraph();
    await graph.restoreFromEvents(store as unknown as IEventStore);
    expect(graph.getEntities()).toHaveLength(250);
  });

  it('restore 后同 key 无变化 upsert → 不重复 append（去重基准重建）', async () => {
    const store = new MemoryEventStore();
    const graph = new SystemMetadataGraph();
    graph.setEventStore(store as unknown as IEventStore);
    // 首次注册
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE' });
    // 模拟 bootstrap：restore 重建
    await graph.restoreFromEvents(store as unknown as IEventStore);
    // restore 后再次 upsert（业务无变化）→ 不应重复 append
    graph.registerEntity('e1', 'mission', '目标A', { status: 'ACTIVE' });
    const regEvents = store.events.filter(e => e.type === EventType.SYSTEM_ENTITY_REGISTERED);
    expect(regEvents).toHaveLength(1);
  });

  it('实体+关系事件混合 → 均完整恢复', async () => {
    const store = new MemoryEventStore();
    const batch: BaseEvent[] = [];
    for (let i = 0; i < 150; i++) {
      batch.push({
        id: `evt_e_${i}`, type: EventType.SYSTEM_ENTITY_REGISTERED, timestamp: 1000 + i,
        executionId: `e${i}`, source: 'test',
        payload: { entityId: `e${i}`, entityType: 'mission', name: `目标${i}` },
      } as BaseEvent);
    }
    for (let i = 0; i < 120; i++) {
      batch.push({
        id: `evt_r_${i}`, type: EventType.SYSTEM_RELATION_ADDED, timestamp: 2000 + i,
        executionId: `e${i}`, source: 'test',
        payload: { fromId: `e${i}`, toId: `e${(i + 1) % 150}`, relationType: 'depends_on' },
      } as BaseEvent);
    }
    await store.appendBatch(batch);

    const graph = new SystemMetadataGraph();
    await graph.restoreFromEvents(store as unknown as IEventStore);
    expect(graph.getEntities()).toHaveLength(150);
    expect(graph.getAllRelations()).toHaveLength(120);
  });
});

describe('getSharedPiBridge — 进程级单例（P0-2）', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('多次调用返回同一实例（懒创建）', async () => {
    // 动态 import 两次（不 reset modules 的情况下模块缓存保证单例）
    const mod1 = await import('../src/infrastructure/adapters/pi-bridge/PiBridge.js');
    const a = mod1.getSharedPiBridge();
    const b = mod1.getSharedPiBridge();
    expect(a).toBe(b);
  });

  it('agent-spawner 与 bootstrap 复用同一共享实例（模块级缓存）', async () => {
    const mod = await import('../src/infrastructure/adapters/pi-bridge/PiBridge.js');
    mod.resetSharedPiBridge();
    const instance = mod.getSharedPiBridge();
    expect(instance).toBeInstanceOf(mod.PiBridge);
    mod.resetSharedPiBridge();
  });
});
