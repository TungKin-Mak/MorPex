/**
 * engines/mock/MockEngine — 测试用内存引擎
 *
 * 无外部依赖，用于单元测试与 cognee server 离线时的降级验证。
 * 实现同构语义（remember/recall/searchGraph/searchHybrid/available）。
 */

import type {
  EngineHit,
  EngineSearchOptions,
  EngineWriteOptions,
  MemoryEngine,
} from '../../memory-types.js';

/** n-gram 子串集合（模拟语义检索） */
function ngrams(s: string, minLen: number): string[] {
  const out = new Set<string>();
  for (let i = 0; i < s.length; i++) {
    for (let j = i + minLen; j <= s.length && j - i <= 8; j++) {
      out.add(s.slice(i, j));
    }
  }
  return [...out];
}

export class MockEngine implements MemoryEngine {
  readonly kind = 'mock';
  private store: Array<{ content: string; dataset: string; id: string; validUntil?: string }> = [];
  private online = true;

  setOnline(v: boolean): void {
    this.online = v;
  }

  async remember(content: string, opts: EngineWriteOptions = {}): Promise<{ ok: boolean; id?: string; reason?: string }> {
    const id = `mock_${this.store.length + 1}`;
    this.store.push({ content, dataset: opts.dataset ?? 'company', id });
    return { ok: true, id };
  }

  async recall(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    return this.match(query, opts);
  }

  async searchGraph(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    return this.match(query, opts);
  }

  async searchHybrid(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    return this.match(query, opts);
  }

  async forget(dataset: string): Promise<void> {
    this.store = this.store.filter((m) => m.dataset !== dataset);
  }

  async available(): Promise<boolean> {
    return this.online;
  }

  private match(query: string, opts: EngineSearchOptions = {}): EngineHit[] {
    const q = query.toLowerCase();
    const qNgrams = ngrams(q, 2);
    return this.store
      .filter((m) => (opts.dataset ? m.dataset === opts.dataset : true))
      .map((m) => {
        const c = m.content.toLowerCase();
        const shared = qNgrams.filter((g) => c.includes(g));
        if (shared.length === 0) return null;
        const maxLen = Math.max(...shared.map((g) => g.length));
        const score = Math.min(0.98, maxLen / Math.max(q.length, 2) + 0.2);
        return {
          id: m.id,
          content: m.content,
          score,
          validUntil: m.validUntil,
          metadata: { dataset: m.dataset, source: 'mock' },
        };
      })
      .filter(Boolean) as EngineHit[];
  }
}
