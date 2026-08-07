/**
 * Reranker — Cross-Encoder 重排序器（会话 16k·4：RAG 流水线精排）
 *
 * 调用 OpenAI 兼容 /rerank（SiliconFlow：BAAI/bge-reranker-v2-m3）。
 * 对 (query, doc) 对联合编码打分（比 bi-encoder 精度更高），重排候选集。
 * 配置来自 embeddingconfig.yaml 的 reranker 块（非硬编码）；未启用/不可用 → 不重排（跳过）。
 *
 * ═══ 会话 16l·2（P1-4）：结果缓存——同 (query, docs指纹) 的 rerank 结果 TTL 30s 内复用，
 *     避免每次装配重复调用 HTTP /rerank（实测单次 808ms）。TTL 过期自动失效，零 stale 风险。
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

export interface RerankerConfig {
  enabled?: boolean;
  model?: string;
  topN?: number;
  /** 结果缓存 TTL（ms），默认 30s */
  cacheTtlMs?: number;
}

/** 缓存条目：结果 + 过期时间戳 */
interface CacheEntry {
  results: Array<{ index: number; score: number }>;
  expiresAt: number;
}

export class Reranker {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private topN: number;
  private httpTimeoutMs: number;
  private cacheTtlMs: number;
  /** 指纹 → 缓存结果（LRU 意识：超 TTL 即丢弃，简单 Map） */
  private cache: Map<string, CacheEntry> = new Map();
  /** 缓存上限（防无限增长，超出清空最旧） */
  private static readonly MAX_CACHE = 512;

  constructor(opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    topN?: number;
    httpTimeoutMs?: number;
    cacheTtlMs?: number;
  }) {
    if (!opts.baseUrl || !opts.apiKey || !opts.model) {
      throw new Error('[Reranker] 配置缺失：需 baseUrl + apiKey + model');
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.topN = opts.topN ?? 10;
    this.httpTimeoutMs = opts.httpTimeoutMs ?? 30_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 30_000;
  }

  /**
   * rerank — 对 (query, docs) 对打分并重排
   * @returns 按相关度降序的 [{ index, score }]
   *
   * 缓存键 = hash(query + sorted(docs))：同 query 同候选集 → 命中缓存（TTL 内），零 HTTP 调用。
   */
  async rerank(query: string, docs: string[]): Promise<Array<{ index: number; score: number }>> {
    if (!docs || docs.length === 0) return [];

    const cacheKey = this.cacheKey(query, docs);
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.results;
    }
    if (hit) this.cache.delete(cacheKey); // 过期条目移除

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

      // 写缓存（TTL 30s；超出上限清最旧）
      if (this.cache.size >= Reranker.MAX_CACHE) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { results, expiresAt: Date.now() + this.cacheTtlMs });

      return results;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * clearCache — 清空结果缓存（测试/配置变更用）
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * cacheKey — 生成 (query, docs) 指纹：query + SHA256(排序后 docs join)
   * docs 排序保证候选集顺序变化不影响缓存命中。
   */
  private cacheKey(query: string, docs: string[]): string {
    const sorted = [...docs].sort();
    const hash = createHash('sha256').update(sorted.join('\u0001')).digest('hex').slice(0, 16);
    return `${this.model}|${query}|${hash}`;
  }
}
