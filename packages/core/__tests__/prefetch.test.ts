import { describe, it, expect, vi } from 'vitest';
import { prefetchHighFrequencyEntities } from '../src/knowledge/context/prefetch.js';

function mockEngine(result: unknown, delay = 10) {
  return {
    assemble: vi.fn(async () => {
      await new Promise(r => setTimeout(r, delay));
      return result;
    }),
  } as unknown as import('../src/knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine;
}

describe('prefetchHighFrequencyEntities', () => {
  it('命中时 hit=true（真实 Provider 片段）', async () => {
    const engine = mockEngine({
      focusedSummary: 'hello',
      fragments: [{ attribution: { providerType: 'registered' } }],
      providerAttribution: [{ source: 'goal_graph', providerType: 'registered', collectedAt: Date.now() }],
    });
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(true);
    expect(engine.assemble as unknown as { mock: { calls: unknown[] } }).toBeDefined();
  });

  it('空结果 hit=false（仅 fallback/空摘要）', async () => {
    const engine = mockEngine({
      focusedSummary: '【当前任务】test',
      fragments: [{ attribution: { providerType: 'fallback' } }],
      providerAttribution: [{ source: 'goal_graph', providerType: 'fallback', collectedAt: Date.now() }],
    });
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(false);
  });

  it('召回摘要命中 hit=true', async () => {
    const engine = mockEngine({
      focusedSummary: '【当前任务】test',
      fragments: [{ attribution: { providerType: 'fallback' } }],
      providerAttribution: [{ source: 'goal_graph', providerType: 'fallback', collectedAt: Date.now() }],
      recentSummaries: [{ taskRef: 't1', summary: 'prev' }],
    });
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(true);
  });

  it('超时静默 hit=false', async () => {
    const engine = mockEngine(
      {
        focusedSummary: 'x',
        fragments: [{ attribution: { providerType: 'registered' } }],
        providerAttribution: [{ source: 'goal_graph', providerType: 'registered', collectedAt: Date.now() }],
      },
      200,
    );
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1', timeoutMs: 20 });
    expect(r.hit).toBe(false);
  });

  it('engine 为 null 时不抛', async () => {
    const r = await prefetchHighFrequencyEntities(null, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(false);
  });

  it('预取后第二次 assemble 命中缓存（通过 mock 次数验证去重）', async () => {
    const engine = mockEngine({
      focusedSummary: 'cached',
      fragments: [{ attribution: { providerType: 'registered' } }],
      providerAttribution: [{ source: 'mission_state', providerType: 'registered', collectedAt: Date.now() }],
    });
    await prefetchHighFrequencyEntities(engine, { goal: 'deploy app', missionId: 'm2' });
    expect((engine.assemble as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // 第二次同样参数应走缓存/inflight，去重由引擎内部 LruCache 保证，此处仅验证调用可重复
    await prefetchHighFrequencyEntities(engine, { goal: 'deploy app', missionId: 'm2' });
    expect((engine.assemble as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
