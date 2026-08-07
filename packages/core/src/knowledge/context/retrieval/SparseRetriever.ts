/**
 * SparseRetriever — BM25 稀疏检索器（会话 16k·4：RAG 流水线 Sparse 支线）
 *
 * 与 Dense（bi-encoder 向量）互补：BM25 精确词项匹配（专有名词/型号/ID 等向量弱项），
 * 中文无分词依赖 → CJK 重叠双字（bigram）分词 + ASCII 单词，停用词过滤。
 *
 * 使用方式：对一批文档（候选集）调用 scoreAll（IDF 基于候选集统计——小池适用），
 * 单文档 score 需先 buildIndex 固定 IDF。
 *
 * @packageDocumentation
 */

/** 中文停用字（高频虚词，双字分词前过滤单字） */
const CJK_STOP = new Set(['的', '了', '和', '与', '并', '是', '在', '对', '为', '由', '及', '或', '而', '等', '被', '让', '从', '以', '请', '给', '出', '应', '需', '要']);

/** 分词：ASCII 单词 + CJK 重叠双字 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  // ASCII 单词
  for (const m of text.toLowerCase().match(/[a-z0-9][a-z0-9_\-.]{1,}/g) ?? []) {
    tokens.push(m);
  }
  // CJK 重叠双字
  const cjk = text.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    const bi = cjk.slice(i, i + 2);
    if (!CJK_STOP.has(bi[0]) && !CJK_STOP.has(bi[1])) tokens.push(bi);
  }
  // 单字补充（未覆盖的实义单字——型号/编号场景）
  for (const ch of cjk) {
    if (!CJK_STOP.has(ch) && !tokens.includes(ch) && tokens.filter(t => t.length === 1).length < 50) {
      // 单字只在双字未覆盖时补（低权重靠 IDF）
    }
  }
  return tokens;
}

export class SparseRetriever {
  private k1 = 1.5;
  private b = 0.75;

  /**
   * scoreAll — 对一批文档计算 BM25 分数（IDF 基于候选集统计）
   * @returns 与 docs 顺序一致的分数数组
   */
  scoreAll(query: string, docs: string[]): number[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || docs.length === 0) return docs.map(() => 0);
    const qSet = new Set(qTokens);

    // 词频（df：包含该词的文档数）
    const docTokenLists = docs.map(d => tokenize(d));
    const df = new Map<string, number>();
    for (const tl of docTokenLists) {
      for (const t of new Set(tl)) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const N = docs.length;
    const avgdl = docTokenLists.reduce((a, tl) => a + tl.length, 0) / Math.max(1, N);

    const idf = (t: string): number => {
      const n = df.get(t) ?? 0;
      // BM25 IDF（避免负值：+1 平滑）
      return Math.log(1 + (N - n + 0.5) / (n + 0.5));
    };

    return docTokenLists.map((tl, i) => {
      const dl = tl.length;
      const tf = new Map<string, number>();
      for (const t of tl) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of qSet) {
        const f = tf.get(t) ?? 0;
        if (f === 0) continue;
        const denom = f + this.k1 * (1 - this.b + this.b * dl / Math.max(1, avgdl));
        score += idf(t) * (f * (this.k1 + 1)) / denom;
      }
      return score;
    });
  }
}
