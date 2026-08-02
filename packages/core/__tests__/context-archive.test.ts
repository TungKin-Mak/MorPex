/**
 * ContextArchive 召回测试（功能③ 历史抽离·完整快照按 taskRef 召回）
 *
 * 覆盖：
 *   - loadByTaskRef 从 EventStore 的 context.snapshot 精确召回（按 payload.taskRef）
 *   - 同会话多任务（A/B/C）按任务身份 ID 可分，互不混淆
 *   - 多条同 taskRef 快照 → 返回最新（archivedAt 降序）
 *   - 无匹配 / eventStore 为空 → 返回 null（不抛错）
 *   - listTaskRefs 去重列出全部任务身份 ID
 */
import { describe, it, expect } from 'vitest';
import { loadByTaskRef, listTaskRefs, type ArchivedContext } from '../src/knowledge/context/ContextArchive.js';
import type { BaseEvent } from '../src/infrastructure/protocol/events/BaseEvent.js';
import type { EventQueryFilter, IEventStore } from '../src/infrastructure/protocol/events/store/IEventStore.js';

/** 最小内存 IEventStore mock（仅 query 按 type 过滤） */
function makeMockStore(events: BaseEvent[]): IEventStore {
  return {
    query: async (filter: EventQueryFilter) => {
      let rows = [...events];
      if (filter.type) rows = rows.filter((e) => e.type === filter.type);
      return rows;
    },
    append: async () => {},
    appendBatch: async () => {},
    appendDecision: async () => {},
    queryDecisions: async () => [],
    replay: async function* () {},
    getLatestSequence: async () => 0,
    getStats: async () => ({ totalEvents: 0, totalDecisions: 0, byType: {}, latestSequence: 0, dbSizeBytes: 0 }),
    clear: async () => {},
    close: async () => {},
  } as IEventStore;
}

function snapshot(taskRef: string, archivedAt: number, extra: Partial<ArchivedContext> = {}): BaseEvent {
  return {
    id: `evt_${taskRef}_${archivedAt}`,
    type: 'context.snapshot',
    timestamp: archivedAt,
    executionId: `exec_${taskRef}`,
    source: 'morpex-runtime',
    payload: { taskRef, missionId: taskRef, goal: `任务 ${taskRef}`, archivedAt, ...extra },
  };
}

describe('ContextArchive 按 taskRef 召回（功能③ 身份 ID 主键）', () => {
  it('同会话多任务（A/B/C）按任务身份 ID 精确召回，互不混淆', async () => {
    const store = makeMockStore([
      snapshot('taskA', 1000, { result: 'success', domain: 'software' }),
      snapshot('taskB', 2000, { result: 'success', domain: 'software' }),
      snapshot('taskC', 3000, { result: 'failure' }),
    ]);

    const b = await loadByTaskRef(store, 'taskB');
    expect(b).not.toBeNull();
    expect(b!.taskRef).toBe('taskB');
    expect(b!.missionId).toBe('taskB');
    expect(b!.domain).toBe('software');

    // A/C 与 B 不混淆
    const a = await loadByTaskRef(store, 'taskA');
    expect(a!.taskRef).toBe('taskA');
    const c = await loadByTaskRef(store, 'taskC');
    expect(c!.result).toBe('failure');
  });

  it('多条同 taskRef 快照 → 返回最新（archivedAt 降序）', async () => {
    const store = makeMockStore([
      snapshot('taskB', 1000, { score: 0.5 }),
      snapshot('taskB', 3000, { score: 0.9 }), // 最新
      snapshot('taskB', 2000, { score: 0.7 }),
    ]);
    const b = await loadByTaskRef(store, 'taskB');
    expect(b!.archivedAt).toBe(3000);
    expect(b!.score).toBe(0.9);
  });

  it('无匹配 / eventStore 为空 → 返回 null（不抛错）', async () => {
    const store = makeMockStore([snapshot('taskA', 1000)]);
    expect(await loadByTaskRef(store, 'taskX')).toBeNull();
    expect(await loadByTaskRef(null, 'taskA')).toBeNull();
    expect(await loadByTaskRef(undefined, 'taskA')).toBeNull();
    expect(await loadByTaskRef(store, '')).toBeNull();
  });

  it('listTaskRefs 去重列出全部任务身份 ID', async () => {
    const store = makeMockStore([
      snapshot('taskA', 1000),
      snapshot('taskB', 2000),
      snapshot('taskB', 3000), // 重复 taskRef
    ]);
    const refs = await listTaskRefs(store);
    expect(refs.sort()).toEqual(['taskA', 'taskB']);
  });
});
