/**
 * RAG 检索流水线测试（会话 16k·4：Dense + Sparse(BM25) → RRF → Cross-Encoder 重排）
 *
 * 覆盖：
 *   1. SparseRetriever（BM25）：中文双字分词、IDF、精确词项召回
 *   2. ContextRetriever：Dense+Sparse RRF 融合、Cross-Encoder 重排、baseScore 保底
 *   3. 仅 Sparse（无 embedding）→ BM25 + 领域/新鲜度
 */

import { describe, it, expect } from 'vitest';
import { SparseRetriever, tokenize } from '../src/knowledge/context/retrieval/SparseRetriever.js';
import { ContextRetriever, type RecentTaskRecord } from '../src/knowledge/context/retrieval/ContextRetriever.js';

describe('SparseRetriever — BM25 稀疏检索', () => {
  it('中文双字分词 + 精确词项召回（专有名词命中）', () => {
    const s = new SparseRetriever();
    const docs = [
      'MCU 固件开发 XC8P9530 型号',
      '电商商品价格合规检查',
      '空气检测设备开发',
    ];
    const scores = s.scoreAll('XC8P9530 固件开发', docs);
    expect(scores[0]).toBeGreaterThan(scores[1]); // 型号精确命中
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });

  it('tokenize：ASCII 单词 + CJK 双字', () => {
    const t = tokenize('bge-m3 电商价格合规');
    expect(t).toContain('bge-m3');
    expect(t).toContain('价格'); // 双字
    expect(t).toContain('合规');
  });

  it('空查询/空文档 → 全 0', () => {
    const s = new SparseRetriever();
    expect(s.scoreAll('', ['a', 'b'])).toEqual([0, 0]);
    expect(s.scoreAll('x', [])).toEqual([]);
  });
});

describe('ContextRetriever — Dense+Sparse RRF + Cross-Encoder 重排', () => {
  const tasks: RecentTaskRecord[] = [
    { taskRef: 't_price', goal: '电商价格合规检查', result: 'success', archivedAt: Date.now() },
    { taskRef: 't_hw', goal: '开发空气检测设备', result: 'success', archivedAt: Date.now() },
    { taskRef: 't_firm', goal: 'MCU 固件烧录验证', result: 'failure', archivedAt: Date.now() },
  ];

  it('仅 Sparse（无 embedding）→ BM25 召回精确词项任务', async () => {
    const r = new ContextRetriever({ loadRecentTasks: async () => tasks });
    const res = await r.retrieveRelevant('MCU 固件烧录验证', 'software', 5);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].ref).toBe('t_firm'); // 精确词项命中排前
  });

  it('Dense+Sparse RRF 融合：语义相近 + 词项命中共同排序', async () => {
    const r = new ContextRetriever({
      loadRecentTasks: async () => tasks,
      // Dense：价格合规任务语义 0.9，其余 0.2
      similarityScorer: async (goal, c) => c.includes('价格') ? 0.9 : 0.2,
    });
    const res = await r.retrieveRelevant('电商价格合规检查', 'ecommerce', 5);
    expect(res[0].ref).toBe('t_price'); // Dense + Sparse 共同置顶
  });

  it('Cross-Encoder 重排：融合后按 rerank 分精排', async () => {
    // Dense 给出：t_price 最高；rerank 反直觉地把 t_firm 提为第一（模拟精排修正）
    const r = new ContextRetriever({
      loadRecentTasks: async () => tasks,
      similarityScorer: async (goal, c) => c.includes('价格') ? 0.9 : (c.includes('固件') ? 0.3 : 0.2),
      reranker: async (query, docs) => {
        // 把含 '固件' 的文档排第一（cross-encoder 精排修正）
        const idx = docs.findIndex(d => d.includes('固件'));
        const scores = docs.map((_, i) => (i === idx ? 0.95 : 0.4));
        return scores.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score);
      },
    });
    const res = await r.retrieveRelevant('MCU 固件开发', 'software', 5);
    expect(res[0].ref).toBe('t_firm'); // rerank 精排生效
  });

  it('baseScore 保底：领域匹配经验 + 全局策略即使无词项重叠也召回', async () => {
    const events = [{ type: 'empty-param', capability: 'ecommerce', detail: '缺失必需参数 query', timestamp: 1 }];
    const strategies = [{ type: 'empty-param', hint: '调用工具前必须确认参数非空', version: 1, appliedAt: 1 }];
    const r = new ContextRetriever({
      loadRecentTasks: async () => [],
      getEvents: () => events,
      getStrategies: () => strategies,
    });
    const res = await r.retrieveRelevant('电商促销方案', 'ecommerce', 5);
    expect(res.some(x => x.type === 'experience')).toBe(true); // 领域匹配经验保底
    expect(res.some(x => x.type === 'strategy')).toBe(true); // 全局策略保底
  });
});
