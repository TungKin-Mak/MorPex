/**
 * EmbeddingProvider — 向量化提供器（会话 16k：RAG-lazy 装配接真实 embedding 模型）
 *
 * 调用 OpenAI 兼容的 /embeddings 端点（SiliconFlow：https://api-docs.siliconflow.cn/docs/api/embeddings-post）。
 * 配置全部来自 config/embeddingconfig.yaml（不硬编码）：
 *   embedding.baseUrl / apiKey（${VAR} 环境变量引用）/ model / dimensions / batchSize
 *
 * 仅适配器层消费（与 PiBridge 同层隔离约束一致）；不可用（未配置/缺 key）→ embed 抛错，由调用方回退。
 *
 * @packageDocumentation
 */

export interface EmbeddingConfig {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  contextRetrieval?: { enabled?: boolean; topK?: number; minScore?: number };
}

import { createHash } from 'node:crypto';
import { LruCache } from '../../common/cache/LruCache.js';
import { withInflight } from '../../common/cache/inflight.js';

export class EmbeddingProvider {
  private config: EmbeddingConfig;
  private httpTimeoutMs: number;
  /** P1 #2：向量 LRU（≤1000，key=`${model}:${text}`）+ 在飞去重 */
  private cache: LruCache<string, number[]> = new LruCache(1000);
  private inflight: Map<string, Promise<number[][]>> = new Map();
  /** 单文本最大字符（防超长 400；SiliconFlow 建议 ≤8192 tokens，取 8000 字符保守） */
  private static readonly MAX_TEXT_CHARS = 8000;

  constructor(config: EmbeddingConfig, httpTimeoutMs = 30_000) {
    if (!config.baseUrl || !config.model) {
      throw new Error('[EmbeddingProvider] 配置缺失：embeddingconfig.yaml 需 baseUrl + model');
    }
    this.config = config;
    this.httpTimeoutMs = httpTimeoutMs;
  }

  get ready(): boolean {
    return !!(this.config.baseUrl && this.config.model && this.config.apiKey);
  }

  get model(): string | undefined {
    return this.config.model;
  }

  /**
   * embed — 批量向量化文本（OpenAI 兼容 embeddings 端点）
   * P1 #2：LRU 缓存 + 在飞去重——命中缓存零 HTTP；并发同 batch 共享单次请求。
   * @returns number[][]（每项一个向量，与输入顺序一致）
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.ready) throw new Error('[EmbeddingProvider] 未就绪（缺 apiKey/baseUrl/model）');
    const clean = texts.map(t => {
      const s = (t ?? '').trim();
      if (!s) return '';
      return s.length > EmbeddingProvider.MAX_TEXT_CHARS ? s.slice(0, EmbeddingProvider.MAX_TEXT_CHARS) : s;
    }).filter(Boolean);
    if (clean.length === 0) return [];

    // 1) 缓存命中分流
    const resultMap = new Map<string, number[]>();
    const misses: string[] = [];
    const missKeys: string[] = [];
    const seenMiss = new Set<string>();
    for (const t of clean) {
      const k = this.cacheKey(t);
      const hit = this.cache.get(k);
      if (hit) resultMap.set(k, hit);
      else if (!seenMiss.has(k)) { seenMiss.add(k); misses.push(t); missKeys.push(k); }
    }
    if (misses.length === 0) return clean.map(t => resultMap.get(this.cacheKey(t))!);

    // 2) 在飞去重：同 batch 指纹并发共享单次 HTTP（inflight 去重 + 防超长 key）
    // 修复 P1 #2 Reviewer Important #3：旧实现 misses.join('\u0001') 再 hash 存在分隔符碰撞
    //   ["a\u0001b","c"] vs ["a","b\u0001c"] join 后同为 "a\u0001b\u0001c"。
    // 修复策略：逐项 SHA-256 后拼接再整体 hash（每项定长 64 hex，无分隔符二义性；顺序敏感）。
    // 与 model 前缀分工：model 前缀（batchKey `${model}:${batchHash}`）负责跨模型分桶隔离；
    // 此处 batchHash 仅负责同模型内 batch 内容指纹（去重在飞 + 缓存 key 去重），二者正交。
    const perItemHashes = misses.map(t => createHash('sha256').update(t).digest('hex'));
    const batchHash = createHash('sha256').update(perItemHashes.join('')).digest('hex').slice(0, 16);
    const batchKey = `${this.config.model}:${batchHash}`;
    const fetched = await withInflight(this.inflight, batchKey, async () => {
      const out: number[][] = [];
      const batchSize = this.config.batchSize ?? 8;
      for (let i = 0; i < misses.length; i += batchSize) {
        const batch = misses.slice(i, i + batchSize);
        const vectors = await this.embedBatch(batch);
        out.push(...vectors);
      }
      return out;
    });

    // 3) 回填缓存 + 结果
    for (let i = 0; i < misses.length; i++) {
      const k = missKeys[i];
      const v = fetched[i];
      if (v) { this.cache.set(k, v); resultMap.set(k, v); }
    }
    return clean.map(t => resultMap.get(this.cacheKey(t))!);
  }

  /** 单向量（文本不足 1 时返回空数组） */
  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    return v ?? [];
  }

  /** 余弦相似度（0-1；零向量 → 0） */
  cosine(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  private cacheKey(text: string): string {
    // 长文本哈希防 Map key 膨胀（阈值 200 字符，短文本保留可读性，长文本 64bit 指纹）
    if (text.length > 200) {
      const h = createHash('sha256').update(text).digest('hex').slice(0, 16);
      return `${this.config.model}:h:${h}`;
    }
    return `${this.config.model}:${text}`;
  }

  /** 清空缓存（测试/模型切换用） */
  clearCache(): void { this.cache.clear(); this.inflight.clear(); }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.config.baseUrl!.replace(/\/+$/, '')}/embeddings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`[EmbeddingProvider] HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
      const vectors = (json.data ?? []).map(d => d.embedding ?? []);
      if (vectors.length !== texts.length) {
        throw new Error(`[EmbeddingProvider] 返回向量数 ${vectors.length} ≠ 输入 ${texts.length}`);
      }
      return vectors;
    } finally {
      clearTimeout(timer);
    }
  }
}
