/**
 * EmbeddingProvider 测试（会话 16k 接真实向量模型）
 *
 * 覆盖：
 *   1. embed：调用 OpenAI 兼容 /embeddings（mock fetch）→ 向量维度/批量
 *   2. cosine：相似度计算（语义相近高、无关低）
 *   3. 配置驱动：缺 key/未启用 → 未就绪/抛错
 *   4. HTTP 失败/向量数不匹配 → 抛错
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmbeddingProvider } from '../src/infrastructure/adapters/embedding/EmbeddingProvider.js';

const REAL_FETCH = globalThis.fetch;

function mockFetch(json: unknown, status = 200) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(json),
    json: async () => json,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

const CFG = {
  enabled: true, provider: 'siliconflow',
  baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'sk-test', model: 'BAAI/bge-m3',
  dimensions: 1024, batchSize: 8,
};

describe('EmbeddingProvider — 向量化 + 余弦', () => {
  it('embed 调用 /embeddings 并返回向量（1024 维）', async () => {
    const vec = Array.from({ length: 1024 }, (_, i) => i % 7 / 10);
    mockFetch({ data: [{ embedding: vec }, { embedding: vec }], model: 'BAAI/bge-m3' });
    const p = new EmbeddingProvider(CFG);
    const out = await p.embed(['电商价格合规', '定价合规']);
    expect(out.length).toBe(2);
    expect(out[0].length).toBe(1024);
    // 请求体正确（model + input 批量）
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.siliconflow.cn/v1/embeddings');
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('BAAI/bge-m3');
    expect(body.input).toEqual(['电商价格合规', '定价合规']);
    expect(call[1].headers.Authorization).toBe('Bearer sk-test');
  });

  it('cosine：语义相近高、无关低', () => {
    const p = new EmbeddingProvider(CFG);
    const a = [1, 2, 3, 0];
    const b = [1, 2, 3, 0]; // 相同 → 1
    const c = [0, 0, 0, 1]; // 正交 → 0
    expect(p.cosine(a, b)).toBeCloseTo(1, 5);
    expect(p.cosine(a, c)).toBeCloseTo(0, 5);
    expect(p.cosine([], [1])).toBe(0);
  });

  it('缺 apiKey → ready=false，embed 抛错（调用方回退关键词）', async () => {
    const p = new EmbeddingProvider({ ...CFG, apiKey: undefined });
    expect(p.ready).toBe(false);
    await expect(p.embed(['x'])).rejects.toThrow(/未就绪/);
  });

  it('HTTP 失败 / 向量数不匹配 → 抛错', async () => {
    const p = new EmbeddingProvider(CFG);
    mockFetch({ error: 'unauthorized' }, 401);
    await expect(p.embed(['x'])).rejects.toThrow(/401/);
    mockFetch({ data: [{ embedding: [1] }] }); // 1 个向量 vs 2 输入
    await expect(p.embed(['x', 'y'])).rejects.toThrow(/向量数/);
  });

  it('空输入 → 空数组（不调 API）', async () => {
    const p = new EmbeddingProvider(CFG);
    expect(await p.embed(['', '  '])).toEqual([]);
  });
});
