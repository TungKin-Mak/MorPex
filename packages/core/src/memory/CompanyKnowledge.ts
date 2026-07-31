/**
 * memory/CompanyKnowledge — 公司知识记忆（Gate 接线注册表）
 *
 * 低耦合：模块级注册表 + 可选注入。
 * - bootstrap 装配时注入 memoryApi（cognee 引擎）；未注入时工具调用返回 QueryMiss，不硬崩。
 * - ontologyTools 的第 5 个工具 ontology_queryCompanyKnowledge 经此查询。
 * - QueryMiss → 复用现有事件链（ontology.query.miss / needs_human）。
 */

import type {
  MemoryApi,
  MemoryQueryRequest,
  MemoryQueryResult,
} from '../adapters/memory/index.js';

let memoryApiRef: MemoryApi | null = null;

/** bootstrap 时调用：注入统一记忆层实例 */
export function initializeCompanyMemory(api: MemoryApi): void {
  memoryApiRef = api;
}

export function isCompanyMemoryInitialized(): boolean {
  return memoryApiRef !== null;
}

export interface CompanyKnowledgeQueryResult extends MemoryQueryResult {
  /** L2 证据上下文（仅命中内容） */
  promptContext: string;
  /** 引擎未接入 */
  notConnected: boolean;
}

/**
 * queryCompanyKnowledge — 公司知识域强制检索
 *
 * 规则：
 * - 未接入 memory → notConnected=true, need_human=true（不伪造）
 * - 图检索空 / 低置信 → need_human=true（QueryMiss/LowConfidence）
 * - 命中 → 返回证据 + need_human=false
 */
export async function queryCompanyKnowledge(req: MemoryQueryRequest): Promise<CompanyKnowledgeQueryResult> {
  if (!memoryApiRef) {
    return {
      hits: [],
      need_human: true,
      reason: 'QueryMiss',
      source: 'none',
      confidence: 0,
      promptContext: '（公司记忆未接入）',
      notConnected: true,
    };
  }
  const r = await memoryApiRef.queryForGate(req);
  return { ...r, notConnected: false };
}
