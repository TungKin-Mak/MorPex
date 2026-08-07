/**
 * P1 优化测试（会话 16l·2）
 *
 * 覆盖：
 *   1. Reranker 结果缓存（同 query+docs 指纹 → TTL 内复用，零 HTTP 调用）
 *   2. SystemMetadataGraph 按 type 索引（getEntities(type) 走索引，registerEntity/restore 维护）
 *   3. type 索引引用一致性（getEntities(type) 与 entities Map 同一引用 → WeakMap 缓存一致）
 *   4. Gate 限流退避（RetryPolicy 封装：RateLimitError 重试、其他错误直接抛）
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Reranker } from '../src/knowledge/context/retrieval/Reranker.js';
import { SystemMetadataGraph } from '../src/knowledge/graph/SystemMetadataGraph.js';
import { RetryPolicy } from '../src/infrastructure/common/resilience/RetryPolicy.js';

// ═══════════════════════════════════════════════════════════════
// P1-4 Reranker 缓存
// ═══════════════════════════════════════════════════════════════

describe('Reranker — 结果缓存（P1-4）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function makeReranker(fetchImpl?: typeof fetch) {
    const reranker = new Reranker({
      baseUrl: 'http://fake/rerank',
      apiKey: 'k',
      model: 'm',
      topN: 10,
      cacheTtlMs: 30_000,
    });
    return { reranker, fetchSpy: vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl ?? (async () => new Response(JSON.stringify({
      results: [
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))) };
  }

  it('同 (query, docs) 重复调用 → 命中缓存，仅 1 次 HTTP', async () => {
    const { reranker, fetchSpy } = makeReranker();
    const docs = ['文档A', '文档B', '文档C'];
    const r1 = await reranker.rerank('目标', docs);
    const r2 = await reranker.rerank('目标', docs);
    expect(r1).toEqual(r2);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 第二次命中缓存
  });

  it('docs 顺序变化 → 指纹一致，仍命中缓存', async () => {
    const { reranker, fetchSpy } = makeReranker();
    await reranker.rerank('目标', ['A', 'B', 'C']);
    await reranker.rerank('目标', ['C', 'A', 'B']); // 顺序颠倒
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('query 不同 → 不命中缓存（不同指纹）', async () => {
    const { reranker, fetchSpy } = makeReranker();
    await reranker.rerank('目标A', ['A', 'B']);
    await reranker.rerank('目标B', ['A', 'B']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('TTL 过期 → 重新 HTTP（缓存失效）', async () => {
    const { reranker, fetchSpy } = makeReranker();
    // 用短 TTL
    const short = new Reranker({ baseUrl: 'http://fake', apiKey: 'k', model: 'm', cacheTtlMs: 1 });
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await short.rerank('q', ['a']);
    await new Promise(r => setTimeout(r, 5)); // 等 TTL 过期
    await short.rerank('q', ['a']);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('空 docs → 不调用 HTTP', async () => {
    const { fetchSpy } = makeReranker();
    const reranker = new Reranker({ baseUrl: 'http://fake', apiKey: 'k', model: 'm' });
    const r = await reranker.rerank('q', []);
    expect(r).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// P1-5 SystemMetadataGraph type 索引
// ═══════════════════════════════════════════════════════════════

describe('SystemMetadataGraph — type 索引（P1-5）', () => {
  it('getEntities(type) 只返回该 type 实体', () => {
    const g = new SystemMetadataGraph();
    g.registerEntity('m1', 'mission', '目标A', {});
    g.registerEntity('a1', 'artifact', '产物B', {});
    g.registerEntity('m2', 'mission', '目标C', {});
    expect(g.getEntities('mission')).toHaveLength(2);
    expect(g.getEntities('artifact')).toHaveLength(1);
    expect(g.getEntities()).toHaveLength(3); // 无 type 全量
  });

  it('registerEntity 覆盖同 id（type 变化）→ 索引正确迁移', () => {
    const g = new SystemMetadataGraph();
    g.registerEntity('x1', 'mission', '目标', {});
    g.registerEntity('x1', 'artifact', '产物', {}); // type 变化
    expect(g.getEntities('mission')).toHaveLength(0);
    expect(g.getEntities('artifact')).toHaveLength(1);
    expect(g.getEntities()).toHaveLength(1);
  });

  it('getEntities(type) 与 entities Map 返回同一引用（WeakMap 缓存一致）', () => {
    const g = new SystemMetadataGraph();
    g.registerEntity('m1', 'mission', '目标A', {});
    const byType = g.getEntities('mission')[0];
    const all = g.getEntities().find(e => e.id === 'm1');
    expect(byType).toBe(all); // 同一引用
  });

  it('restore 后 type 索引正确（从事件重建）', async () => {
    // 轻量内存 store（复用简单实现）
    const store = {
      events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
      async append(e: { type: string; payload: Record<string, unknown> }) { this.events.push(e); },
      async appendBatch(es: Array<{ type: string; payload: Record<string, unknown> }>) { for (const e of es) await this.append(e); },
      async appendDecision() {},
      async query(filter: { type?: string } = {}) {
        let rows = [...this.events];
        if (filter.type) rows = rows.filter(e => e.type === filter.type);
        return rows;
      },
      async queryDecisions() { return []; },
      async replay() { return (async function* () {})(); },
      async getLatestSequence() { return 0; },
      async getStats() { return { totalEvents: 0 }; },
    };
    const g = new SystemMetadataGraph();
    g.setEventStore(store as never);
    g.registerEntity('m1', 'mission', '目标A', {});
    g.registerEntity('a1', 'artifact', '产物B', {});
    g.registerEntity('a2', 'artifact', '产物C', {});

    await g.restoreFromEvents(store as never);
    expect(g.getEntities('mission')).toHaveLength(1);
    expect(g.getEntities('artifact')).toHaveLength(2);
    expect(g.getEntities()).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// P1-6 Gate 限流退避（RetryPolicy）
// ═══════════════════════════════════════════════════════════════

describe('RetryPolicy — 限流退避（P1-6）', () => {
  it('RateLimitError 可重试（retryableErrors 白名单命中）', () => {
    const policy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1, strategy: 'linear', retryableErrors: ['RateLimitError'] });
    const err = Object.assign(new Error('LLM 网关返回 HTTP 429（限流）——provider=opencode'), { name: 'RateLimitError' });
    expect(policy.shouldRetry(err)).toBe(true);
  });

  it('非限流错误 → 不重试（白名单未命中）', () => {
    const policy = new RetryPolicy({ maxAttempts: 3, retryableErrors: ['RateLimitError'] });
    expect(policy.shouldRetry(new Error('Model not found'))).toBe(false);
  });

  it('指数退避延迟递增', () => {
    const policy = new RetryPolicy({ maxAttempts: 5, baseDelayMs: 100, strategy: 'exponential', maxDelayMs: 30000 });
    const d1 = policy.getDelay(0);
    const d2 = policy.getDelay(1);
    const d3 = policy.getDelay(2);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });
});
