/**
 * Reranker — Cross-Encoder 重排序器（会话 16k·4：RAG 流水线精排）
 *
 * 调用 OpenAI 兼容 /rerank（SiliconFlow：BAAI/bge-reranker-v2-m3）。
 * 对 (query, doc) 对联合编码打分（比 bi-encoder 精度更高），重排候选集。
 * 配置来自 embeddingconfig.yaml 的 reranker 块（非硬编码）；未启用/不可用 → 不重排（跳过）。
 *
 * @packageDocumentation
 */

export interface RerankerConfig {
  enabled?: boolean;
  model?: string;
  topN?: number;
}

export class Reranker {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private topN: number;
  private httpTimeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    topN?: number;
    httpTimeoutMs?: number;
  }) {
    if (!opts.baseUrl || !opts.apiKey || !opts.model) {
      throw new Error('[Reranker] 配置缺失：需 baseUrl + apiKey + model');
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.topN = opts.topN ?? 10;
    this.httpTimeoutMs = opts.httpTimeoutMs ?? 30_000;
  }

  /**
   * rerank — 对 (query, docs) 对打分并重排
   * @returns 按相关度降序的 [{ index, score }]
   */
  async rerank(query: string, docs: string[]): Promise<Array<{ index: number; score: number }>> {
    if (!docs || docs.length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, query, documents: docs, top_n: Math.min(this.topN, docs.length) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`[Reranker] HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json() as { results?: Array<{ index: number; relevance_score: number }> };
      const results = (json.results ?? [])
        .map(r => ({ index: r.index, score: r.relevance_score }))
        .sort((a, b) => b.score - a.score);
      return results;
    } finally {
      clearTimeout(timer);
    }
  }
}
