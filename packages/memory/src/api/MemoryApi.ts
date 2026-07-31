/**
 * api/MemoryApi — 统一 MemoryAPI 实现（唯一入口）
 *
 * 组装：gate(强制检索) + ontology(白名单) + engine(cognee/mock) + confirmation(SQLite)
 * 低耦合：各组件只通过接口/类型交互。
 *
 * 写入分流：
 *   upsert → validateUpsert(白名单) → engine 可用且高置信 → 写权威图
 *                                   → 低置信 / 冲突 / 引擎离线 → 确认队列
 */

import { ConfirmationQueue } from '../confirmation/queue.js';
import { ForceRetriever } from '../gate/ForceRetrieve.js';
import { validateUpsert } from '../ontology/validate.js';
import type {
  ConfirmDecision,
  ConfirmTicket,
  MemoryAPI,
  MemoryEngine,
  MemoryQueryRequest,
  MemoryQueryResult,
  ReflectResult,
  UpsertEntityInput,
  UpsertResult,
} from '../memory-types.js';

export const DEFAULT_CONFIRMATION_DB = 'data/memory/confirmation.sqlite';
export const AUTO_WRITE_CONFIDENCE = 0.8;

export interface MemoryApiOptions {
  engine: MemoryEngine;
  confirmationDbPath?: string;
  /** 高置信自动写入阈值 */
  autoWriteConfidence?: number;
  dataset?: string;
  scope?: string;
}

export class MemoryApi implements MemoryAPI {
  private readonly engine: MemoryEngine;
  private readonly queue: ConfirmationQueue;
  private readonly retriever: ForceRetriever;
  private readonly autoWrite: number;
  private readonly defaultDataset: string;
  private readonly defaultScope: string;

  constructor(opts: MemoryApiOptions) {
    this.engine = opts.engine;
    this.queue = new ConfirmationQueue(opts.confirmationDbPath ?? DEFAULT_CONFIRMATION_DB);
    this.retriever = new ForceRetriever(opts.engine);
    this.autoWrite = opts.autoWriteConfidence ?? AUTO_WRITE_CONFIDENCE;
    this.defaultDataset = opts.dataset ?? 'company';
    this.defaultScope = opts.scope ?? 'company';
  }

  // ── 强制检索入口 ───────────────────────────────────────────────────

  async query(req: MemoryQueryRequest): Promise<MemoryQueryResult> {
    const r = await this.retriever.retrieve({
      ...req,
      dataset: req.dataset ?? this.defaultDataset,
      scope: req.scope ?? this.defaultScope,
    });
    return {
      hits: r.hits,
      need_human: r.need_human,
      reason: r.reason,
      source: r.source,
      confidence: r.confidence,
    };
  }

  /** 供 Gate 接线：返回含 L2 证据上下文的完整结果 */
  async queryForGate(req: MemoryQueryRequest): Promise<MemoryQueryResult & { promptContext: string }> {
    const r = await this.retriever.retrieve({
      ...req,
      dataset: req.dataset ?? this.defaultDataset,
      scope: req.scope ?? this.defaultScope,
    });
    return {
      hits: r.hits,
      need_human: r.need_human,
      reason: r.reason,
      source: r.source,
      confidence: r.confidence,
      promptContext: r.promptContext,
    };
  }

  // ── 写入 ───────────────────────────────────────────────────────────

  async upsert(input: UpsertEntityInput): Promise<UpsertResult> {
    // 1) 本体白名单校验
    const v = validateUpsert(input);
    if (!v.ok) {
      if (v.needConfirmReason === 'new_entity') {
        const ticketId = this.queue.enqueue({
          content: `${input.name}（实体类型 "${input.entityType}" 不在白名单）`,
          confidence: input.confidence ?? 0.5,
          reason: 'new_entity',
          scope: input.scope ?? this.defaultScope,
          metadata: { input, reason: v.rejectReason },
        });
        return { status: 'pending_confirm', ticketId };
      }
      return { status: 'rejected', reason: v.rejectReason ?? '校验失败' };
    }

    // 2) 组合事实文本（name + facts + relations）
    const factText = buildFactText(input);
    const conf = input.confidence ?? 0.5;

    // 3) 引擎可用 + 高置信 → 写权威图
    const available = await this.engine.available();
    if (available && conf >= this.autoWrite) {
      const w = await this.engine.remember(factText, {
        dataset: input.dataset ?? this.defaultDataset,
        scope: input.scope ?? this.defaultScope,
        validFrom: input.validFrom,
      });
      if (w.ok) {
        return { status: 'written', id: w.id ?? factText };
      }
      // 写入失败 → 转确认
      const ticketId = this.queue.enqueue({
        content: factText,
        confidence: conf,
        reason: 'graph_unavailable',
        scope: input.scope ?? this.defaultScope,
        metadata: { source: input.source ?? 'user', reason: w.reason },
      });
      return { status: 'pending_confirm', ticketId };
    }

    // 4) 低置信 / 引擎离线 → 确认队列
    const ticketId = this.queue.enqueue({
      content: factText,
      confidence: conf,
      reason: available ? 'low_confidence' : 'graph_unavailable',
      scope: input.scope ?? this.defaultScope,
      metadata: { source: input.source ?? 'user', entityType: input.entityType },
    });
    return { status: 'pending_confirm', ticketId };
  }

  // ── 人工确认 ───────────────────────────────────────────────────────

  async confirm(ticketId: string, decision: ConfirmDecision, meta?: Record<string, unknown>): Promise<void> {
    const ticket = this.queue.get(ticketId);
    if (!ticket) return;
    if (decision === 'accept') {
      const factText = meta?.content ? String(meta.content) : ticket.content;
      await this.engine.remember(factText, { dataset: this.defaultDataset, scope: ticket.scope });
    }
    this.queue.resolve(ticketId, decision);
  }

  async listPendingConfirmations(limit = 20): Promise<ConfirmTicket[]> {
    return this.queue.listPending(limit);
  }

  // ── 双时间失效：登记失效日志（图历史保留，cognee TEMPORAL 承接 asOf 查询）──

  async invalidate(name: string, validUntil?: string): Promise<void> {
    this.queue.logInvalidate(name, validUntil, 'user');
  }

  /** 失效登记列表（审计/一致性检查用） */
  listInvalidations(limit = 50): Array<{ id: string; entityName: string; validUntil: string | null; reason: string; createdAt: string }> {
    return this.queue.listInvalidations(limit);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async reflect(): Promise<ReflectResult> {
    // 巩固：从图证据召回经验/模式相关内容 → 提炼 ExperiencePattern 候选（进确认队列）
    const engineHits = await this.engine.searchGraph('经验 模式 解决方案 教训 最佳实践', {
      dataset: this.defaultDataset,
      scope: this.defaultScope,
      limit: 10,
    });
    const scanned = engineHits.length;
    const candidates: string[] = [];
    const pending = new Set(this.queue.listPending(100).map((t) => t.content));
    for (const h of engineHits.slice(0, 5)) {
      const content = h.content.trim();
      if (!content || pending.has(content)) continue; // 去重：已有待确认/已写入不重复生成
      const id = this.queue.enqueue({
        content: `[经验模式候选] ${content}`,
        confidence: 0.6,
        reason: 'new_entity',
        scope: this.defaultScope,
        metadata: { source: 'consolidation', engineHit: h.metadata },
      });
      candidates.push(id);
    }
    return {
      scanned,
      consolidated: 0,
      promoted: 0,
      candidates,
      details: [`扫描图证据 ${scanned} 条，生成 ${candidates.length} 个经验模式候选（已去重）`],
    };
  }

  async decayTick(): Promise<void> {
    // 软遗忘：确认队列超期（30 天未处理）归档为 rejected；图侧由 cognee 内建自动遗忘
    this.queue.expirePending(30);
  }

  close(): void {
    this.queue.close();
  }
}

/** 组合原子事实文本（name + facts + relations → 图事实） */
function buildFactText(input: UpsertEntityInput): string {
  const parts = [`实体：${input.name}`];
  for (const f of input.facts ?? []) parts.push(`- ${f}`);
  for (const r of input.relations ?? []) {
    parts.push(`- 关系：${input.name} ${r.relationType} ${r.toName}${r.fact ? `（${r.fact}）` : ''}`);
  }
  return parts.join('\n');
}
