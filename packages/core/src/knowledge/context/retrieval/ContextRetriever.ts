/**
 * ContextRetriever — 上下文相关性检索器（会话 16i RAG-lazy · 16k·4 升级为 Dense+Sparse+Cross-Encoder）
 *
 * 检索流水线（经典 RAG）：
 *   1. Dense（bi-encoder 向量，similarityScorer 注入，如 bge-m3 余弦）——语义召回
 *   2. Sparse（BM25，内置纯 JS，中文双字分词）——精确词项召回（专有名词/型号/ID）
 *   3. Fusion：RRF（Reciprocal Rank Fusion）融合两路排名
 *   4. Cross-Encoder 重排（reranker 注入，如 bge-reranker-v2-m3）——精排 Top-N
 *   5. 领域加成 + 新鲜度衰减 + Top-K 截断
 *
 * 组件全部可插拔/可缺省：
 *   - 无 embedding（similarityScorer）→ 仅 Sparse(BM25) + 领域/新鲜度
 *   - 无 reranker → 跳过精排（Dense+Sparse RRF 已可用）
 *   - 输出 ref 指针 + 摘要，装配层拼【相关任务摘要】；详情按需拉取（指针化）
 *
 * @packageDocumentation
 */

import type { LearningEvent } from '../../../evolution/LearningEventDetector.js';
import type { AppliedStrategy } from '../../../evolution/PromptStrategyRegistry.js';
import { ContextDistiller } from './ContextDistiller.js';
import { SparseRetriever } from './SparseRetriever.js';

export type RelevantContextType = 'task' | 'experience' | 'strategy';

export interface RelevantContext {
  /** 指针引用（taskRef / exp:type / strategy:type），供按需拉取 */
  ref: string;
  type: RelevantContextType;
  /** 蒸馏后的短摘要（≤120 字符） */
  summary: string;
  /** 相关度分（>0 命中；越大越相关） */
  score: number;
}

/** 任务上下文数据源（装配快照 + 权威快照归一化） */
export interface RecentTaskRecord {
  taskRef: string;
  goal?: string;
  result?: 'success' | 'failure';
  summary?: string;
  archivedAt?: number;
}

export interface RetrieverSources {
  /** 近期任务上下文（装配快照 + EventStore 权威快照；返回 ≤limit 条） */
  loadRecentTasks: (limit: number) => Promise<RecentTaskRecord[]>;
  /** 经验事件（可学习事件：空参/安全拦截/高重试） */
  getEvents?: () => LearningEvent[];
  /** 已应用策略 */
  getStrategies?: () => AppliedStrategy[];
  /**
   * Dense：bi-encoder 语义相似度（可异步，如 bge-m3 余弦）。注入 → 语义召回；未注入 → 仅 Sparse。
   */
  similarityScorer?: (goal: string, candidate: string) => number | Promise<number>;
  /**
   * Cross-Encoder 重排（可异步，如 bge-reranker-v2-m3）。注入 → RRF 融合后精排 Top-N。
   * @param query 查询文本
   * @param docs 候选文档（与融合后候选顺序一致）
   * @returns 按相关度降序 [{ index, score }]
   */
  reranker?: (query: string, docs: string[]) => Promise<Array<{ index: number; score: number }>>;
}

/** RRF 融合常数 */
const RRF_K = 60;

/** 检索候选（流水线中间形态） */
interface Candidate {
  ref: string;
  type: RelevantContextType;
  /** 用于 dense/sparse/rerank 的检索文本 */
  text: string;
  /** 蒸馏后摘要（任务源） */
  summary?: string;
  archivedAt?: number;
  /** 保底分（领域匹配经验/全局策略——即使 BM25/Dense 无重叠也计入） */
  baseScore?: number;
}

export class ContextRetriever {
  private sources: RetrieverSources;
  private distiller: ContextDistiller;
  private sparse: SparseRetriever;

  constructor(sources: RetrieverSources, distiller?: ContextDistiller) {
    this.sources = sources;
    this.distiller = distiller ?? new ContextDistiller();
    this.sparse = new SparseRetriever();
  }

  /**
   * retrieveRelevant — RAG 流水线：Dense + Sparse → RRF → Cross-Encoder → 领域/新鲜度 → Top-K
   */
  async retrieveRelevant(goal: string, domain?: string, topK = 5): Promise<RelevantContext[]> {
    // 1. 候选集（任务 + 经验 + 策略）
    const candidates = await this.gatherCandidates(goal, domain);

    // 2. Dense + Sparse 打分
    const texts = candidates.map(c => c.text);
    // Sparse：BM25（纯 JS，恒可用）
    const sparseScores = this.sparse.scoreAll(goal, texts);
    // Dense：bi-encoder（可缺省）
    let denseScores: number[] | null = null;
    if (this.sources.similarityScorer) {
      try {
        denseScores = await Promise.all(texts.map(t => this.sources.similarityScorer!(goal, t)));
      } catch {
        denseScores = null; // Dense 失败 → 仅 Sparse
      }
    }

    // 3. Fusion：RRF（两路排名融合）或单路直取
    let fused = this.fuse(candidates, denseScores, sparseScores);

    // 4. Cross-Encoder 重排（可缺省）
    if (this.sources.reranker && fused.length > 0) {
      try {
        const rerankN = Math.min(fused.length, Math.max(topK * 3, 6));
        const docs = fused.slice(0, rerankN).map(c => c.text);
        const ranked = await this.sources.reranker(goal, docs);
        // 按 rerank 分重建顺序（index → 原 fused 位置）
        const newOrder = ranked.map(r => ({ ...fused[r.index], score: Math.max(0.05, r.score) }));
        for (let i = 0; i < newOrder.length; i++) fused[i] = newOrder[i];
        // 未返回的候选（rerank top_n 限制）→ 保留原顺序尾部
      } catch {
        /* 重排失败 → 用融合结果 */
      }
    }

    // 5. 领域加成 + 新鲜度衰减 + 过滤 + Top-K
    const results: RelevantContext[] = [];
    for (const c of fused) {
      // 融合分 + 保底分（领域匹配经验/全局策略）
      let score = (c.score ?? 0) + (c.baseScore ?? 0);
      if (score <= 0) continue;
      // 领域加成
      if (domain && c.text.toLowerCase().includes(domain.toLowerCase())) score += 0.5;
      // 新鲜度衰减（7 天内全权重）
      if (c.archivedAt) {
        const ageDays = (Date.now() - c.archivedAt) / 86_400_000;
        if (ageDays > 7) score *= Math.max(0.3, 1 - ageDays / 30);
      }
      const summary = c.summary && c.summary.length > 0
        ? await this.distiller.distill(c.summary, 120)
        : (await this.distiller.distill(c.text, 120));
      results.push({ ref: c.ref, type: c.type, summary, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  // ── 内部 ──

  /** 收集候选（任务/经验/策略），附检索文本 */
  private async gatherCandidates(goal: string, domain?: string): Promise<Candidate[]> {
    const cands: Candidate[] = [];
    // 任务源
    try {
      const tasks = await this.sources.loadRecentTasks(Math.max((this.sources.reranker ? 20 : 15), 10));
      for (const t of tasks) {
        if (!t.taskRef) continue;
        cands.push({
          ref: t.taskRef,
          type: 'task',
          text: `${t.goal ?? ''} ${t.summary ?? ''}`.trim(),
          summary: t.summary || t.goal,
          archivedAt: t.archivedAt,
        });
      }
    } catch { /* 任务源失败 → 其余源 */ }
    // 经验源（按 capability/domain 匹配才进候选）
    const dom = (domain ?? '').toLowerCase();
    for (const ev of this.sources.getEvents?.() ?? []) {
      const cap = ev.capability.toLowerCase();
      const matched = (dom && (cap.includes(dom) || dom.includes(cap))) || (goal.toLowerCase().includes(cap) && cap.length > 2);
      if (matched) {
        cands.push({ ref: `exp:${ev.type}`, type: 'experience', text: `${ev.capability} ${ev.detail}`, baseScore: 0.7 });
      }
    }
    // 策略源（全局）
    for (const s of this.sources.getStrategies?.() ?? []) {
      cands.push({ ref: `strategy:${s.type}`, type: 'strategy', text: `策略 ${s.type}：${s.hint}`, baseScore: 0.5 });
    }
    return cands;
  }

  /** 融合：Dense+Sparse 双路 → RRF；单路 → 直取 */
  private fuse(cands: Candidate[], dense: number[] | null, sparse: number[]): Array<Candidate & { score: number }> {
    if (dense) {
      // 双路 RRF
      const rankDense = this.rankBy(cands, dense);
      const rankSparse = this.rankBy(cands, sparse);
      return cands.map((c, i) => ({
        ...c,
        score: (rankDense.get(c.ref) !== undefined ? 1 / (RRF_K + rankDense.get(c.ref)!) : 0)
          + (rankSparse.get(c.ref) !== undefined ? 1 / (RRF_K + rankSparse.get(c.ref)!) : 0),
      })).sort((a, b) => b.score - a.score);
    }
    // 仅 Sparse（无 embedding）
    return cands.map((c, i) => ({ ...c, score: sparse[i] })).sort((a, b) => b.score - a.score);
  }

  /** 按分数排名（高 → rank 0；0 分不入榜） */
  private rankBy(cands: Candidate[], scores: number[]): Map<string, number> {
    const ranked = cands.map((c, i) => ({ ref: c.ref, s: scores[i] ?? 0 }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return new Map(ranked.map((x, i) => [x.ref, i]));
  }
}
