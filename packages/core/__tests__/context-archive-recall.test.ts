/**
 * 功能③ Phase 2 — 统一召回接口测试（ContextArchive.loadMerged）
 *
 * 两存储合并：EventStore 权威快照（context.snapshot）+ ContextPersistence 装配快照
 * - 双源都有 → source='both'
 * - 仅 EventStore → 'event-store'；仅装配 → 'persistence'；都无 → 'none'
 * - 任一存储异常/不可用 → 不阻断另一侧
 */

import { describe, it, expect } from 'vitest';
import { loadMerged } from '../src/knowledge/context/ContextArchive.js';
import type { IEventStore } from '../src/infrastructure/protocol/events/store/IEventStore.js';
import type { ExecutionContext } from '../src/knowledge/context/ContextBuilder.js';

// ── fixtures ──

function mockEventStore(events: Array<{ type: string; payload: Record<string, unknown> }>): IEventStore {
  return {
    query: async ({ type }: { type?: string }) =>
      events.filter(e => (type ? e.type === type : true)).map(e => ({ ...e, id: 'evt_1', timestamp: Date.now() })),
  } as unknown as IEventStore;
}

function mockPersistence(snapshots: Array<{ taskRef: string; context: Partial<ExecutionContext> }>) {
  return {
    loadByTaskRef: (taskRef: string) =>
      snapshots.filter(s => s.taskRef === taskRef).map(s => s.context as ExecutionContext),
  };
}

function makeArchived(taskRef: string, archivedAt = 1000) {
  return { type: 'context.snapshot', payload: { taskRef, missionId: 'msn_1', goal: '写报告', archivedAt } };
}

function makeSnapshot(taskRef: string, assembledAt: number): Partial<ExecutionContext> {
  return {
    contextId: `ctx_${taskRef}_${assembledAt}`,
    missionId: 'msn_1',
    goal: '写报告',
    assembledAt,
  } as Partial<ExecutionContext>;
}

// ── 测试 ──

describe('ContextArchive.loadMerged — 统一召回接口', () => {
  it('双源都有 → source=both，快照数合计', async () => {
    const store = mockEventStore([makeArchived('task_a', 2000)]);
    const pers = mockPersistence([
      { taskRef: 'task_a', context: makeSnapshot('task_a', 1000) },
      { taskRef: 'task_a', context: makeSnapshot('task_a', 1500) },
    ]);
    const merged = await loadMerged(store, pers, 'task_a');

    expect(merged.taskRef).toBe('task_a');
    expect(merged.archived?.goal).toBe('写报告');
    expect(merged.snapshots.length).toBe(2);
    expect(merged.summary.source).toBe('both');
    expect(merged.summary.snapshotCount).toBe(3);
    expect(merged.summary.latestAt).toBe(2000);
  });

  it('仅 EventStore → source=event-store', async () => {
    const store = mockEventStore([makeArchived('task_b', 3000)]);
    const merged = await loadMerged(store, null, 'task_b');
    expect(merged.archived).not.toBeNull();
    expect(merged.snapshots).toEqual([]);
    expect(merged.summary.source).toBe('event-store');
  });

  it('仅装配快照 → source=persistence', async () => {
    const pers = mockPersistence([{ taskRef: 'task_c', context: makeSnapshot('task_c', 500) }]);
    const merged = await loadMerged(null, pers, 'task_c');
    expect(merged.archived).toBeNull();
    expect(merged.snapshots.length).toBe(1);
    expect(merged.summary.source).toBe('persistence');
  });

  it('都无 → source=none（不抛错）', async () => {
    const merged = await loadMerged(null, null, 'task_none');
    expect(merged.archived).toBeNull();
    expect(merged.snapshots).toEqual([]);
    expect(merged.summary.source).toBe('none');
  });

  it('EventStore 查询异常 → 不阻断装配快照侧', async () => {
    const badStore = {
      query: async () => { throw new Error('store down'); },
    } as unknown as IEventStore;
    const pers = mockPersistence([{ taskRef: 'task_d', context: makeSnapshot('task_d', 1) }]);
    const merged = await loadMerged(badStore, pers, 'task_d');
    expect(merged.archived).toBeNull(); // EventStore 异常 → 权威侧空
    expect(merged.snapshots.length).toBe(1); // 装配侧正常
    expect(merged.summary.source).toBe('persistence');
  });

  it('taskRef 为空 → 返回空结果（不抛错）', async () => {
    const store = mockEventStore([makeArchived('task_a', 2000)]);
    const pers = mockPersistence([{ taskRef: 'task_a', context: makeSnapshot('task_a', 1000) }]);
    const merged = await loadMerged(store, pers, '');
    expect(merged.archived).toBeNull();
    expect(merged.snapshots).toEqual([]);
    expect(merged.summary.source).toBe('none');
  });
});
