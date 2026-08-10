import { describe, it, expect } from 'vitest';
import {
  DeblackboxRecorder,
  getSharedDeblackboxRecorder,
  resetSharedDeblackboxRecorder,
  RecordPolicy,
  RecordCleaner,
} from '../src/infrastructure/observability/deblackbox/index.js';
import type { IEventStore } from '../src/infrastructure/protocol/events/store/IEventStore.js';

/** 内存版 IEventStore（冒烟用，不依赖 SQLite） */
function makeMemStore(): { store: IEventStore; events: Array<Record<string, unknown>>; decisions: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  const store = {
    append: async (e: Record<string, unknown>) => { events.push(e); },
    appendBatch: async (es: Array<Record<string, unknown>>) => { es.forEach((e) => events.push(e)); },
    appendDecision: async (d: Record<string, unknown>) => { decisions.push(d); },
    query: async () => events,
    queryDecisions: async () => decisions,
    replay: () => { throw new Error('n/a'); },
    getLatestSequence: async () => events.length,
    getStats: async () => ({ totalEvents: events.length, totalDecisions: decisions.length, byType: {}, latestSequence: events.length, dbSizeBytes: 0 }),
    clear: async () => { events.length = 0; decisions.length = 0; },
    close: async () => {},
    getDatabase: () => undefined,
  } as unknown as IEventStore;
  return { store, events, decisions };
}

describe('deblackbox recorder 公共基础设施（去黑盒化）', () => {
  it('L1 决策单永久 + L2 采样/异常全记 + L0 摘要 + stats/getRecent', () => {
    resetSharedDeblackboxRecorder();
    const { store, decisions, events } = makeMemStore();
    const rec = getSharedDeblackboxRecorder();
    rec.configure({ eventStore: store });
    rec.record({ category: 'gate.decision', source: 'gate', executionId: 'm1', level: 'L1', summary: { goal: 'x', verdict: 'allow', reasoning: '有依据' } });
    rec.record({ category: 'llm.call', source: 'pi-bridge', executionId: 'm1', level: 'L2', summary: { model: 'm' }, detail: { prompt: '...' }, isError: true });
    rec.record({ category: 'task.summary', source: 'runtime', executionId: 'm1', level: 'L0', summary: { goal: 'x', result: 'ok' } });
    expect(decisions.length).toBe(1);
    expect(decisions[0].metadata.category).toBe('gate.decision');
    expect(decisions[0].executionId).toBe('m1');
    expect(events.some((e) => e.type === 'deblackbox.task.summary')).toBe(true);
    const s = rec.stats();
    expect(s['gate.decision'].total).toBe(1);
    expect(s['llm.call'].errors).toBe(1);
    expect(rec.getRecent('gate.decision').length).toBe(1);
  });

  it('采样率=0 时正常 L2 不记、异常仍全记；TTL 清理可运行', () => {
    resetSharedDeblackboxRecorder();
    const { store } = makeMemStore();
    const rec = getSharedDeblackboxRecorder();
    rec.configure({ eventStore: store });
    rec.getRecordPolicy().setSamplingRate('detail', 0);
    rec.record({ category: 'llm.call', source: 'pi-bridge', level: 'L2', summary: { model: 'm' }, detail: { x: 1 } });
    rec.record({ category: 'llm.call', source: 'pi-bridge', level: 'L2', summary: { model: 'm' }, detail: { x: 2 }, isError: true });
    const detailStore = rec.getDetailStore();
    expect(detailStore.count()).toBe(1);
    const cleaner = new RecordCleaner(rec.getRecordPolicy(), detailStore);
    const r = cleaner.runCleanup();
    expect(typeof r.detailDeleted).toBe('number');
    expect(typeof r.detailRemaining).toBe('number');
    expect(r.detailRemaining).toBe(detailStore.count());
  });

  it('未 configure 时 record 不抛（回退内存缓冲）', () => {
    resetSharedDeblackboxRecorder();
    const rec = getSharedDeblackboxRecorder();
    expect(() => {
      rec.record({ category: 'llm.call', source: 'pi-bridge', level: 'L1', summary: { a: 1 } });
      rec.record({ category: 'llm.call', source: 'pi-bridge', level: 'L2', detail: { a: 1 } });
    }).not.toThrow();
    expect(rec.getRecent('llm.call').length).toBe(2);
  });

  it('内部 on() 订阅可收到记录（供 llm-tracer 消费）', () => {
    resetSharedDeblackboxRecorder();
    const rec = getSharedDeblackboxRecorder();
    const got: string[] = [];
    const off = rec.on('llm.call', (r) => got.push(r.category));
    rec.record({ category: 'llm.call', source: 'pi-bridge', level: 'L1', summary: { model: 'm' } });
    rec.record({ category: 'gate.decision', source: 'gate', level: 'L1', summary: { verdict: 'allow' } });
    off();
    rec.record({ category: 'llm.call', source: 'pi-bridge', level: 'L1', summary: { model: 'm2' } });
    expect(got).toEqual(['llm.call']);
  });

  it('RecordPolicy 默认 TTL / 采样快照可查询、运行时可调', () => {
    const policy = new RecordPolicy();
    expect(policy.shouldRecord('gate.decision')).toBe(true);
    expect(policy.getTtlMs('detail')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(policy.getTtlMs('detail', true)).toBe(365 * 24 * 60 * 60 * 1000);
    policy.setSamplingRate('llm.call', 0.5);
    policy.setTtl('llm.call', 1000);
    expect(policy.getTtlMs('llm.call')).toBe(1000);
    expect(policy.snapshot().sampling['llm.call']).toBe(0.5);
  });
});
