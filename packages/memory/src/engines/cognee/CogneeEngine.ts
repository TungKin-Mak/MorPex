/**
 * engines/cognee/CogneeEngine — MemoryEngine 适配器（cognee 实现）
 *
 * 把 cognee 的 remember/recall/search 映射到统一 EngineHit 契约。
 * 图优先：searchGraph 走 GRAPH_COMPLETION；混合/双时间分别走 RAG/TEMPORAL。
 */

import type {
  EngineHit,
  EngineSearchOptions,
  EngineWriteOptions,
  MemoryEngine,
} from '../../memory-types.js';
import { CogneeClient } from './client.js';

function toEngineHit(r: Record<string, unknown>): EngineHit | null {
  const content = (r.search_result as string[] | undefined)?.join(' ') ?? (r.content as string | undefined);
  if (!content) return null;
  return {
    id: (r.id as string) ?? `cg_${r.dataset_name ?? ''}_${Date.now()}`,
    content,
    score: typeof r.score === 'number' ? r.score : 0.8,
    validFrom: (r.valid_from as string | undefined) ?? (r.validFrom as string | undefined),
    validUntil: (r.valid_until as string | undefined) ?? (r.validUntil as string | undefined),
    metadata: {
      dataset: r.dataset_name,
      source: 'cognee',
      raw: r,
    },
  };
}

export class CogneeEngine implements MemoryEngine {
  readonly kind = 'cognee';

  constructor(private readonly client: CogneeClient) {}

  async remember(content: string, opts: EngineWriteOptions = {}): Promise<{ ok: boolean; id?: string; reason?: string }> {
    return this.client.remember(content, {
      dataset: opts.dataset ?? 'company',
      sessionId: opts.sessionId,
    });
  }

  async recall(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    const rows = await this.client.recall(query, {
      dataset: opts.dataset,
      scope: opts.scope,
    });
    return rows.map((r) => toEngineHit(r as unknown as Record<string, unknown>)).filter(Boolean) as EngineHit[];
  }

  async searchGraph(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    // 图优先：纯图节点证据匹配（无 LLM 生成）→ 决定 need_human
    return this.searchGraphEvidence(query, opts);
  }

  /** 纯图证据检索：节点 label 与 query n-gram 共享匹配 */
  async searchGraphEvidence(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    const dataset = opts.dataset ?? 'company';
    const { nodes, links } = await this.client.getGraph(dataset);
    const qNgrams = new Set(ngrams(query.toLowerCase(), 2));
    const byId = new Map<string, string>();
    for (const n of nodes) {
      byId.set(n.id ?? '', n.label ?? n.name ?? '');
    }
    const hits: EngineHit[] = [];
    for (const n of nodes) {
      const label = (n.label ?? n.name ?? '').toString();
      if (!label) continue;
      const shared = [...qNgrams].filter((g) => label.includes(g));
      if (shared.length === 0) continue;
      const maxLen = Math.max(...shared.map((g) => g.length));
      const score = Math.min(0.98, maxLen / Math.max(query.length, 2) + 0.15);
      // 关联该节点的出边关系
      const rels = links
        .filter((l) => l.source === n.id || l.target === n.id)
        .slice(0, 4)
        .map((l) => {
          const other = l.source === n.id ? l.target : l.source;
          const dir = l.source === n.id ? '→' : '←';
          return `${byId.get(other ?? '') ?? other}${dir}${l.type ?? l.label ?? ''}`;
        });
      hits.push({
        id: n.id ?? `cg_node_${hits.length}`,
        content: label + (rels.length ? `（${rels.join('，')}）` : ''),
        score,
        metadata: { dataset, source: 'cognee', kind: 'graph_evidence', relations: rels },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.limit ?? 8);
  }

  /** 图补全回答（LLM 生成，仅作增强展示，不参与 need_human 判定） */
  async searchAnswer(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    const rows = await this.client.search(query, 'GRAPH_COMPLETION', { dataset: opts.dataset });
    return this.mapStrings(rows, 'graph_answer');
  }

  async searchHybrid(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    const rows = await this.client.search(query, 'RAG_COMPLETION', { dataset: opts.dataset });
    return this.mapStrings(rows, 'hybrid');
  }

  async searchTemporal(query: string, opts: EngineSearchOptions = {}): Promise<EngineHit[]> {
    const rows = await this.client.search(query, 'TEMPORAL', { dataset: opts.dataset });
    return this.mapStrings(rows, 'temporal');
  }

  async forget(dataset: string): Promise<void> {
    await this.client.forget(dataset);
  }

  async available(): Promise<boolean> {
    return this.client.available();
  }

  /** 答案文本数组 → EngineHit（图检索主路径） */
  private mapStrings(rows: string[], source: string): EngineHit[] {
    return rows.map((s, i) => ({
      id: `cg_${source}_${Date.now()}_${i}`,
      content: s,
      score: Math.max(0.6, 0.9 - i * 0.05),
      metadata: { dataset: undefined, source: 'cognee', kind: source },
    }));
  }
}

/** n-gram 子串集合 */
function ngrams(s: string, minLen: number): string[] {
  const out = new Set<string>();
  for (let i = 0; i < s.length; i++) {
    for (let j = i + minLen; j <= s.length && j - i <= 10; j++) {
      out.add(s.slice(i, j));
    }
  }
  return [...out];
}
