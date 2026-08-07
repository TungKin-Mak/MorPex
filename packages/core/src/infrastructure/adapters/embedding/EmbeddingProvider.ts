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

export class EmbeddingProvider {
  private config: EmbeddingConfig;
  private httpTimeoutMs: number;

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
   * @returns number[][]（每项一个向量，与输入顺序一致）
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.ready) throw new Error('[EmbeddingProvider] 未就绪（缺 apiKey/baseUrl/model）');
    const clean = texts.map(t => (t ?? '').trim()).filter(Boolean);
    if (clean.length === 0) return [];
    const out: number[][] = [];
    const batchSize = this.config.batchSize ?? 8;
    for (let i = 0; i < clean.length; i += batchSize) {
      const batch = clean.slice(i, i + batchSize);
      const vectors = await this.embedBatch(batch);
      out.push(...vectors);
    }
    return out;
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
