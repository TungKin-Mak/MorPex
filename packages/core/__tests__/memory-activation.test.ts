/**
 * Memory Tests — MemoryActivationEngine context-aware recall
 * + L7 深水区：working 数据源统一到 MemoryAPI（source 注入 + refresh）
 */
import { describe, test, expect } from 'vitest';
import { MemoryActivationEngine, type ActivationContext } from '../src/knowledge/memory/MemoryActivationEngine.js';
import { createMemoryActivationSource, hitToMemoryRecord } from '../src/knowledge/memory/MemoryApiBus.js';

function makeCtx(over: Partial<ActivationContext> = {}): ActivationContext {
  return {
    executionStatus: 'running',
    goal: 'Build API',
    currentStep: 1,
    totalSteps: 3,
    completedSteps: [],
    errors: [],
    tags: [],
    ...over,
  };
}

describe('MemoryActivationEngine — context-aware recall', () => {
  const engine = new MemoryActivationEngine();
  engine.addMemory({ id: 'm1', content: 'Use Express.js for REST APIs', type: 'pattern', relevanceScore: 0.9, timestamp: Date.now() });
  engine.addMemory({ id: 'm2', content: 'Handle errors with middleware', type: 'error', relevanceScore: 0.7, timestamp: Date.now() });
  engine.addMemory({ id: 'm3', content: 'Use TypeORM for database', type: 'pattern', relevanceScore: 0.5, timestamp: Date.now() });

  test('running state activates memories', () => {
    const r = engine.activate(makeCtx({ completedSteps: ['Setup'], tags: ['backend'] }));
    expect(r.memories.length).toBeGreaterThan(0);
  });

  test('idle activates less or equal than running', () => {
    const running = engine.activate(makeCtx({ completedSteps: ['Setup'], tags: ['backend'] }));
    const idle = engine.activate(makeCtx({ executionStatus: 'idle', currentStep: 0, totalSteps: 5, completedSteps: [], tags: [] }));
    expect(idle.activationScore).toBeLessThanOrEqual(running.activationScore);
  });

  test('error context boosts error memories', () => {
    const r = engine.activate(makeCtx({ goal: 'Fix bug', errors: ['HTTP 500'], tags: ['debug'] }));
    expect(r.contextBias).toContain('error');
  });

  test('different goals produce different context bias', () => {
    const api = engine.activate(makeCtx({ goal: 'Build REST API', tags: ['api'] }));
    const db = engine.activate(makeCtx({ goal: 'Setup database', tags: ['database'] }));
    expect(typeof api.contextBias).toBe('string');
    expect(typeof db.contextBias).toBe('string');
  });
});

describe('MemoryActivationEngine — L7 working 数据源统一（source 注入 + refresh）', () => {
  test('refresh loads snapshot from source and replaces store', async () => {
    const eng = new MemoryActivationEngine();
    eng.setSource({
      available: async () => true,
      load: async () => [
        { id: 's1', content: 'Use middleware for errors', type: 'error', relevanceScore: 0.8, timestamp: Date.now() },
        { id: 's2', content: 'Express pattern for REST', type: 'pattern', relevanceScore: 0.7, timestamp: Date.now() },
      ],
    });
    const r = await eng.refresh();
    expect(r).toEqual({ loaded: 2, available: true });
    expect(eng.memoryCount).toBe(2);
    expect(eng.lastRefreshedAt).not.toBeNull();
  });

  test('offline source keeps existing snapshot (不误清空)', async () => {
    const eng = new MemoryActivationEngine();
    eng.addMemory({ id: 'local', content: 'local memory', type: 'experience', relevanceScore: 0.5, timestamp: Date.now() });
    eng.setSource({
      available: async () => false,
      load: async () => [{ id: 'x', content: 'should not apply', type: 'experience', relevanceScore: 0.9, timestamp: Date.now() }],
    });
    const r = await eng.refresh();
    expect(r).toEqual({ loaded: 0, available: false });
    expect(eng.memoryCount).toBe(1);
    expect(eng.memoryStore[0].id).toBe('local');
  });

  test('no source → refresh unavailable', async () => {
    const eng = new MemoryActivationEngine();
    expect(await eng.refresh()).toEqual({ loaded: 0, available: false });
    expect(await eng.isSourceAvailable()).toBe(false);
  });

  test('createMemoryActivationSource maps MemoryAPI hits to MemoryRecord', async () => {
    const fakeApi: any = {
      query: async () => ({
        hits: [
          { id: 'h1', content: 'Error recovery: retry with backoff', score: 0.9, source: 'graph', validFrom: '2026-08-01T00:00:00.000Z', metadata: { type: 'error' } },
          { id: 'h2', content: 'Use TypeORM migrations', score: 0.6, source: 'graph', metadata: { entityType: 'pattern' } },
        ],
        need_human: false, reason: undefined, source: 'graph', confidence: 0.8,
      }),
    };
    const src = createMemoryActivationSource(fakeApi, { available: async () => true });
    const records = await src.load();
    expect(records).toHaveLength(2);
    expect(records[0].type).toBe('error');
    expect(records[1].type).toBe('pattern');
  });

  test('need_human → empty load（防幻觉：无证据不注入）', async () => {
    const fakeApiMiss: any = {
      query: async () => ({ hits: [], need_human: true, reason: 'QueryMiss', source: 'graph', confidence: 0 }),
    };
    const src = createMemoryActivationSource(fakeApiMiss, { available: async () => true });
    expect(await src.load()).toHaveLength(0);
  });

  test('hitToMemoryRecord: empty content → null', () => {
    const rec = hitToMemoryRecord({ id: 'x', content: '   ', score: 0.5, source: 'graph' });
    expect(rec).toBeNull();
  });

  test('hitToMemoryRecord: cognee 内部工件噪音 → null', () => {
    const noise = hitToMemoryRecord({ id: 'n1', content: 'TextSummary_abc-123', score: 0.9, source: 'graph' });
    expect(noise).toBeNull();
    const chunk = hitToMemoryRecord({ id: 'n2', content: 'DocumentChunk_xyz', score: 0.8, source: 'graph' });
    expect(chunk).toBeNull();
    const real = hitToMemoryRecord({ id: 'r1', content: '899 元/月', score: 0.9, source: 'graph' });
    expect(real?.content).toBe('899 元/月');
  });
});
