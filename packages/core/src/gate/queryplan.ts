/**
 * queryplan — Ontology 查询计划解析/消毒（自 runOntologyGroundedReasoning 拆分）
 *
 * 弱模型兜底解析（完整 JSON → 平衡括号提取）+ 白名单消毒（防上下文爆炸）+ proposal 标准化。
 */
import type { OntologyProposal } from './types.js';

/**
 * parseQueryPlanRobust — 健壮的 JSON 查询计划解析
 *
 * 改进：
 *   - 用平衡括号匹配替代非贪婪正则，避免截断嵌套 JSON
 *   - 尝试多层 fallback（完整解析 → 首段 JSON → 无效）
 */
export function parseQueryPlanRobust(raw: string): { queries: Array<{ tool: string; args: Record<string, unknown> }> } {  // 策略 1: 尝试完整 JSON 解析
  const jsonBlock = extractBalancedJSON(raw);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(jsonBlock);
      const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
      if (queries.length > 0) {
        return {
          queries: queries.map((q: any) => ({
            tool: String(q.tool ?? q.name ?? 'ontology_queryObjects'),
            args: (q.args ?? q.arguments ?? {}) as Record<string, unknown>,
          })),
        };
      }
    } catch {
      // 继续 fallback
    }
  }

  console.warn('[GroundedReasoning] ⚠️ 无法解析查询计划 JSON，返回空列表（将触发默认查询）');
  return { queries: [] };
}

/** ontology 工具白名单（与 ontologyTools.ts 对齐） */
const ONTOLOGY_TOOL_WHITELIST = new Set([
  'ontology_queryObjects',
  'ontology_getObject',
  'ontology_getRelated',
  'ontology_getCurrentState',
  'ontology_queryCompanyKnowledge',
]);

/**
 * sanitizeQueryPlan — 查询计划消毒（模型无关，防上下文爆炸）
 *
 * 1B 等弱模型即使产出合法 JSON，也可能给出过宽查询（无 type / 无 limit）→
 * ontology_queryObjects 返回数千对象 → Phase 2 prompt 上下文爆炸 → 超时。
 * 规则：
 *   - 工具必须在白名单内，否则丢弃该查询
 *   - ontology_queryObjects 必须带非空 type，否则丢弃（防全量查询）
 *   - limit 钳到 [1, 50]（防一次取回数千对象）
 *   - filters/relations 归一化为合法类型
 */
export function sanitizeQueryPlan(
  plan: { queries: Array<{ tool: string; args: Record<string, unknown> }> },
): { queries: Array<{ tool: string; args: Record<string, unknown> }> } {
  if (!plan || !Array.isArray(plan.queries)) return { queries: [] };
  const queries = plan.queries
    .filter((q) => q && typeof q === 'object')
    .map((q) => {
      const tool = String(q.tool ?? '');
      const args = (q.args && typeof q.args === 'object' ? q.args : {}) as Record<string, unknown>;
      if (!ONTOLOGY_TOOL_WHITELIST.has(tool)) return null;
      if (tool === 'ontology_queryObjects') {
        const type = typeof args.type === 'string' && args.type.trim() ? args.type.trim() : '';
        if (!type) return null; // 无 type 的宽查询直接丢弃
        args.type = type;
        const rawLimit = typeof args.limit === 'number' ? args.limit : Number(args.limit ?? 10);
        args.limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 10;
        if (typeof args.filters !== 'object' || args.filters === null) args.filters = {};
        if (!Array.isArray(args.relations)) args.relations = [];
      }
      return { tool, args };
    })
    .filter((q): q is { tool: string; args: Record<string, unknown> } => q !== null);
  return { queries };
}

/**
 * extractBalancedJSON — 从文本中提取最外层的平衡 JSON 块
 *
 * 从第一个 { 开始，跟踪括号深度，到最外层 } 结束。
 * 比 /{[\s\S]*?}/ 更准确，不会截断嵌套对象。
 */
export function extractBalancedJSON(text: string): string | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.substring(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * normalizeProposal — 标准化 LLM 输出的 proposal
 *
 * 改进：使用 extractBalancedJSON 替代非贪婪正则
 */
export function normalizeProposal(raw: string): OntologyProposal {
  const jsonBlock = extractBalancedJSON(raw);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(jsonBlock);
      return {
        referenced_object_ids: parsed.referenced_object_ids ?? [],
        reasoning: parsed.reasoning,
        action_type: parsed.action_type ?? parsed.proposal?.action_type,
        payload: parsed.proposal ?? parsed.payload,
        proposal: parsed.proposal ?? parsed.payload,
        confidence: parsed.confidence,
        missing_info: parsed.missing_info ?? [],
        needs_human_review: parsed.needs_human_review ?? false,
        raw,
      };
    } catch {
      // 解析失败，返回兜底
    }
  }

  return {
    referenced_object_ids: [],
    proposal: raw,
    needs_human_review: true,
    missing_info: ['无法解析为 JSON'],
    raw,
  };
}

