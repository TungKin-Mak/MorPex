/**
 * ContextRetriever — 上下文相关性检索器（会话 16i · RAG-lazy 装配：情境层语义召回）
 *
 * 目的：装配时按 goal 语义相关性检索 Top-K 上下文（替代"最近 N 条按时间全量注入"），
 * 只装相关（省 token）+ 保证质量（语义相关而非时间相关）。
 *
 * 检索源（组合打分）：
 *   1. 任务上下文（装配快照 + EventStore 权威快照）：goal 关键词/domain 相关 + 新鲜度加权
 *   2. 经验事件（LearningEvent：空参/安全拦截/高重试）——按 capability/domain 匹配
 *   3. 已应用策略（PromptStrategyRegistry）——全局注入（跨领域通用痛点）
 *
 * 输出：RelevantContext[]（含 ref 指针 + 蒸馏摘要 + 相关度分），装配层拼成【相关任务摘要】节。
 * 详情按需拉取（ContextArchive.loadByTaskRef 等工具），指针化不注入全文。
 *
 * @packageDocumentation
 */

import type { LearningEvent } from '../../../evolution/LearningEventDetector.js';
import type { AppliedStrategy } from '../../../evolution/PromptStrategyRegistry.js';
import { ContextDistiller } from './ContextDistiller.js';

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
   * 会话 16j/16k（B1 可插拔 embedding + 16k 接真实模型）：语义相似度评分器（可选，可异步）。
   * 注入后替代默认关键词/domain 打分（更高语义精度）；返回 0-1 相似度。
   * 未注入 → 默认关键词 + domain + 新鲜度打分。
   */
  similarityScorer?: (goal: string, candidate: string) => number | Promise<number>;
}

/** goal 提取检索关键词（去停用词；中文分词近似：按常用业务词匹配） */
const STOPWORDS = new Set(['的', '了', '和', '并', '以及', '与', '一个', '生成', '输出', '完成', '提供', '需要', '请', '给', '出']);

function extractKeywords(goal: string): string[] {
  return goal
    .split(/[\s,，。；;、:：/\\\n]+/)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length >= 2 && !STOPWORDS.has(s))
    .slice(0, 20);
}

export class ContextRetriever {
  private sources: RetrieverSources;
  private distiller: ContextDistiller;

  constructor(sources: RetrieverSources, distiller?: ContextDistiller) {
    this.sources = sources;
    this.distiller = distiller ?? new ContextDistiller();
  }

  /**
   * retrieveRelevant — 按 goal 语义相关性检索 Top-K 上下文
   */
  async retrieveRelevant(goal: string, domain?: string, topK = 5): Promise<RelevantContext[]> {
    const results: RelevantContext[] = [];

    // 1. 任务上下文（语义相关打分）
    try {
      const tasks = await this.sources.loadRecentTasks(Math.max(topK * 3, 15));
      for (const t of tasks) {
        const score = await this.relevanceScore(goal, domain, `${t.goal ?? ''} ${t.summary ?? ''}`, t.taskRef, t.archivedAt);
        if (score <= 0) continue;
        const raw = t.summary && t.summary.length > 0 ? t.summary : (t.goal ?? `任务 ${t.taskRef}`);
        results.push({
          ref: t.taskRef,
          type: 'task',
          summary: await this.distiller.distill(raw, 120),
          score,
        });
      }
    } catch {
      /* 任务源失败 → 其余源兜底 */
    }

    // 2. 经验事件（按 capability/domain 匹配）
    for (const ev of this.sources.getEvents?.() ?? []) {
      const cap = ev.capability.toLowerCase();
      const dom = (domain ?? '').toLowerCase();
      const matched = (dom && (cap.includes(dom) || dom.includes(cap))) || (goal.toLowerCase().includes(cap) && cap.length > 2);
      if (!matched) continue;
      results.push({
        ref: `exp:${ev.type}`,
        type: 'experience',
        summary: ev.detail.slice(0, 120),
        score: 0.7,
      });
    }

    // 3. 已应用策略（跨领域通用，注入有分）
    for (const s of this.sources.getStrategies?.() ?? []) {
      results.push({
        ref: `strategy:${s.type}`,
        type: 'strategy',
        summary: s.hint.slice(0, 120),
        score: 0.5,
      });
    }

    // 按相关度降序取 Top-K
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** 相关性打分：可插拔相似度（embedding，可异步）优先，缺省关键词/domain + 新鲜度 */
  private async relevanceScore(goal: string, domain: string | undefined, candidate: string, _ref: string, archivedAt?: number): Promise<number> {
    // ═══ 会话 16k·3：语义为主（embedding 余弦，可异步）+ 确定性加成（关键词/领域/新鲜度）═══
    // 用户确认：RAG 语义匹配为默认（智能、灵活），确定性做轻量强化（精确命中/领域/时效），
    // 非替代——语义捕捉跨词义相关性（价格合规↔定价合规），关键词/领域提升精确命中排序。
    const c = candidate.toLowerCase();
    if (this.sources.similarityScorer) {
      try {
        const sim = await this.sources.similarityScorer(goal, candidate);
        if (!Number.isFinite(sim) || (sim as number) <= 0) return 0;
        // 语义基分（0-1 → 0-3 量纲）
        let score = (sim as number) * 3;
        // 关键词精确命中加成（语义为主，精确词强化）
        for (const kw of extractKeywords(goal)) {
          if (c.includes(kw)) score += 1.0;
        }
        // 领域加成
        if (domain && c.includes(domain.toLowerCase())) score += 0.5;
        // 新鲜度衰减
        if (archivedAt) {
          const ageDays = (Date.now() - archivedAt) / 86_400_000;
          if (ageDays > 7) score *= Math.max(0.3, 1 - ageDays / 30);
        }
        return score;
      } catch {
        /* scorer 异常 → 回退关键词 */
      }
    }
    let score = 0;
    for (const kw of extractKeywords(goal)) {
      if (c.includes(kw)) score += 1.5;
    }
    if (domain && c.includes(domain.toLowerCase())) score += 1;
    if (score === 0) return 0;
    // 新鲜度加权（7 天内全权重，之后衰减）
    if (archivedAt) {
      const ageDays = (Date.now() - archivedAt) / 86_400_000;
      if (ageDays > 7) score *= Math.max(0.3, 1 - ageDays / 30);
    }
    return score;
  }
}
