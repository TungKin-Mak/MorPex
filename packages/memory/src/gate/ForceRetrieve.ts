/**
 * gate/ForceRetrieve — 强制检索 + need_human + L2 上下文隔离
 *
 * L1 路由硬拦截：QueryMiss / LowConfidence → need_human=true，禁止自由补全。
 * L2 上下文隔离：生成 prompt 只包含本次命中的实体/关系/有效时间（证据），
 *   不夹带 LLM 自身知识。
 * L3（可选）输出校验：由上层对照 hits 校验回答断言。
 */

import type {
  MemoryEngine,
  MemoryHit,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryQuerySource,
  NeedHumanReason,
} from '../memory-types.js';
import { isCompanyKnowledgeDomain, requiresGraphFacts } from './domain.js';

export const CONFIDENCE_HUMAN_THRESHOLD = 0.5;

export interface ForcedRetrieveOutput extends MemoryQueryResult {
  /** L2 隔离后的证据上下文（仅 hits） */
  promptContext: string;
  engineAvailable: boolean;
}

export class ForceRetriever {
  constructor(private readonly engine: MemoryEngine) {}

  async retrieve(req: MemoryQueryRequest): Promise<ForcedRetrieveOutput> {
    const available = await this.engine.available();
    const limit = req.limit ?? 8;

    // ── 图优先检索（主路径：纯图证据，无 LLM 生成）────────────────
    let graphHits: MemoryHit[] = [];
    let answerHits: MemoryHit[] = [];
    if (available) {
      const g = await this.engine.searchGraph(req.text, {
        dataset: req.dataset,
        scope: req.scope,
        entityTypes: req.entityTypes,
        asOf: req.asOf,
        limit,
      });
      graphHits = g.map((h) => ({
        id: h.id,
        content: h.content,
        score: h.score,
        source: 'graph',
        validFrom: h.validFrom,
        validUntil: h.validUntil,
        metadata: h.metadata,
      }));
      // 图补全回答（LLM 生成，仅增强展示，不参与 need_human 判定）
      if (typeof (this.engine as MemoryEngine & { searchAnswer?: unknown }).searchAnswer === 'function') {
        try {
          const a = await (this.engine as MemoryEngine & { searchAnswer: (q: string, o?: object) => Promise<unknown> }).searchAnswer(req.text, { dataset: req.dataset });
          answerHits = (a as Array<{ id: string; content: string; score: number; validFrom?: string; validUntil?: string; metadata?: Record<string, unknown> }>).map((h) => ({
            id: h.id, content: h.content, score: h.score, source: 'graph',
            validFrom: h.validFrom, validUntil: h.validUntil, metadata: h.metadata,
          }));
        } catch {
          answerHits = [];
        }
      }
    }

    // ── 情景/分层召回（补充，不作为事实来源）───────────────────────
    let episodicHits: MemoryHit[] = [];
    if (available) {
      try {
        const e = await this.engine.recall(req.text, {
          dataset: req.dataset,
          scope: req.scope,
        });
        episodicHits = e.map((h) => ({
          id: h.id,
          content: h.content,
          score: h.score,
          source: 'episodic',
          validFrom: h.validFrom,
          validUntil: h.validUntil,
          metadata: h.metadata,
        }));
      } catch {
        // episodic 补充失败不影响图检索主路径（容错降级）
        episodicHits = [];
      }
    }

    const allHits = [...graphHits, ...answerHits, ...episodicHits];
    // ⚠️ need_human 只依据纯图证据分数（LLM 生成的 answerHits 不参与，防幻觉）
    const bestScore = graphHits.reduce((m, h) => Math.max(m, h.score), 0);

    // ── need_human 判定（防幻觉硬逻辑）─────────────────────────────
    let needHuman = true;
    let reason: NeedHumanReason | undefined;
    if (!available) {
      reason = 'QueryMiss'; // 引擎离线 = 无法验证权威事实
    } else if (graphHits.length === 0) {
      // 图优先：公司知识域必须 graph 命中；episodic 命中不消解 need_human
      reason = 'QueryMiss';
    } else if (bestScore < (req.minConfidence ?? CONFIDENCE_HUMAN_THRESHOLD)) {
      reason = 'LowConfidence';
    } else {
      needHuman = false;
    }

    // 通用域（'general'）：图命中即可放行，未命中不强拦（可选增强）
    if (!isCompanyKnowledgeDomain(req.domain)) {
      needHuman = false;
    }

    const source: MemoryQuerySource =
      graphHits.length > 0 && episodicHits.length > 0
        ? 'mixed'
        : graphHits.length > 0
          ? 'graph'
          : episodicHits.length > 0
            ? 'episodic'
            : 'none';

    const hits = allHits
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      hits,
      need_human: needHuman,
      reason,
      source,
      confidence: Math.round(bestScore * 1000) / 1000,
      promptContext: buildEvidenceContext(hits),
      engineAvailable: available,
    };
  }
}

/**
 * buildEvidenceContext — L2 上下文隔离
 * 只把命中的实体/关系/有效时间转成"证据"，禁止夹带任何模型知识。
 */
export function buildEvidenceContext(hits: MemoryHit[]): string {
  if (hits.length === 0) return '（记忆中无相关记录）';
  const lines = hits.map((h, i) => {
    const time = h.validFrom || h.validUntil
      ? `[有效时间 ${h.validFrom ?? '?'}~${h.validUntil ?? '至今'}]`
      : '';
    return `${i + 1}. ${h.content}${time} (来源:${h.source}, 置信:${h.score})`;
  });
  return `【证据（仅以下内容可用于回答，禁止补充外部知识）】\n${lines.join('\n')}`;
}
