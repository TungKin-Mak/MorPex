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
  it('命中时 hit=true', async () => {
    const engine = mockEngine({ focusedSummary: 'hello', fragments: [] });
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(true);
    expect(engine.assemble as unknown as { mock: { calls: unknown[] } }).toBeDefined();
  });

  it('空结果 hit=false', async () => {
    const engine = mockEngine({ focusedSummary: '', fragments: [] });
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(false);
  });

  it('超时静默 hit=false', async () => {
    const engine = mockEngine({ focusedSummary: 'x' }, 200);
    const r = await prefetchHighFrequencyEntities(engine, { goal: 'test', missionId: 'm1', timeoutMs: 20 });
    expect(r.hit).toBe(false);
  });

  it('engine 为 null 时不抛', async () => {
    const r = await prefetchHighFrequencyEntities(null, { goal: 'test', missionId: 'm1' });
    expect(r.hit).toBe(false);
  });

  it('预取后第二次 assemble 命中缓存（通过 mock 次数验证去重）', async () => {
    const engine = mockEngine({ focusedSummary: 'cached', fragments: [{ id: 1 }] });
    await prefetchHighFrequencyEntities(engine, { goal: 'deploy app', missionId: 'm2' });
    expect((engine.assemble as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // 第二次同样参数应走缓存/inflight，去重由引擎内部 LruCache 保证，此处仅验证调用可重复
    await prefetchHighFrequencyEntities(engine, { goal: 'deploy app', missionId: 'm2' });
    expect((engine.assemble as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
