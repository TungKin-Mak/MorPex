/**
 * runOntologyGroundedReasoning — 共享的 Ontology Grounded Reasoning 方法
 *
 * 迭代2：从 DeliveryPlanner.planWithOntology 抽取核心逻辑，
 * 供多条执行路径统一调用。
 *
 * 两阶段：
 *   Phase 1 - 强制查询：LLM 输出查询计划 → 执行 → 记录
 *   Phase 2 - 基于事实推理：LLM 基于检索到的事实输出 proposal
 */

import type { OntologyService } from './OntologyService.js';
import type { ForcedQueryGuard } from './ForcedQueryGuard.js';
import type { OntologyProposal } from './types.js';
import {
  ontologyToolDefinitions,
  createOntologyToolExecutor,
} from '../tools/ontologyTools.js';
import {
  FORCED_QUERY_SYSTEM_PROMPT,
  buildReasoningUserPrompt,
} from '../prompts/forced-query-system.js';

export interface GroundedReasoningOptions {
  goal: string;
  missionId?: string;
  ontology: OntologyService;
  guard: ForcedQueryGuard;
  piBridge: {
    generateText: (params: {
      system?: string;
      prompt: string;
      temperature?: number;
      maxTokens?: number;
    }) => Promise<{ text: string }>;
  };
  /** 额外的系统提示上下文 */
  extraContext?: string;
}

export interface GroundedReasoningResult {
  executionId: string;
  proposal: OntologyProposal;
  queryTrace: {
    callCount: number;
    retrievedIds: string[];
    referenceCheck: { valid: boolean; missing: string[]; knownCount: number };
  };
}

/**
 * runOntologyGroundedReasoning — 执行两阶段强制查询推理
 *
 * Phase 1: 强制 LLM 输出查询计划 → 执行 ontology 工具 → 记录到 Guard
 * Phase 2: 基于检索到的事实推理 → 输出 proposal
 *
 * 可被 DeliveryPlanner、LeadAgentOrchestrator 等多处调用。
 */
export async function runOntologyGroundedReasoning(
  options: GroundedReasoningOptions,
): Promise<GroundedReasoningResult> {
  const { goal, missionId, ontology, guard, piBridge, extraContext } = options;
  const executionId = missionId ?? `exec_${Date.now()}`;

  // 关联 missionId
  guard.setMissionId(executionId, missionId ?? executionId);

  // ---------- Phase 1: 强制查询 ----------
  console.log(`[GroundedReasoning] 🏁 Phase 1 - 强制查询 (executionId=${executionId})`);

  const toolExecutor = createOntologyToolExecutor(ontology, guard, executionId);

  const queryPrompt = [
    `目标：${goal}`,
    `MissionId=${missionId ?? '无'}`,
    extraContext ? `\n额外上下文：${extraContext}` : '',
    `\n请先调用 ontology 工具查询相关事实。输出 JSON 格式的查询计划：`,
    JSON.stringify({
      queries: [
        {
          tool: 'ontology_queryObjects',
          args: { type: '...', filters: {}, relations: [] },
        },
      ],
      reasoning: '为什么要查询这些',
    }, null, 2),
    `\n可用工具：`,
    `- ontology_queryObjects(type, filters?, relations?, limit?)`,
    `- ontology_getObject(id)`,
    `- ontology_getRelated(id, relationType)`,
    `- ontology_getCurrentState(missionId)`,
  ].join('\n');

  const queryResponse = await piBridge.generateText({
    system: FORCED_QUERY_SYSTEM_PROMPT,
    prompt: queryPrompt,
    temperature: 0.2,
  });

  // 解析查询计划并执行
  const queryPlan = parseQueryPlan(queryResponse.text);

  for (const q of queryPlan.queries) {
    try {
      const result = await toolExecutor(q.tool, q.args);
      console.log(`  ├─ 已执行 ${q.tool} → 获取 ${Array.isArray(result) ? result.length : '1'} 条结果`);
    } catch (err) {
      console.warn(`  ├─ ⚠️ ${q.tool} 执行失败:`, (err as Error).message);
    }
  }

  // 代码兜底：没查就失败
  guard.assertQueried(executionId, 1);
  console.log(`  └─ ✅ 强制查询通过 (${guard.getTrace(executionId)?.toolCalls.length ?? 0} 次调用)`);

  // ---------- Phase 2: 基于事实推理 ----------
  console.log(`[GroundedReasoning] 🏁 Phase 2 - 基于事实推理`);

  const trace = guard.getTrace(executionId);
  const factsSummary =
    trace?.toolCalls.map((c) => `工具 ${c.name}: ${c.resultSummary}`).join('\n\n') ??
    '（无事实）';

  const reasoningUser = buildReasoningUserPrompt(goal, factsSummary, missionId);

  const reasoningResponse = await piBridge.generateText({
    system: FORCED_QUERY_SYSTEM_PROMPT,
    prompt: reasoningUser,
    temperature: 0.3,
  });

  const proposal = normalizeProposal(reasoningResponse.text);

  // 引用校验
  const check = guard.validateReferences(
    executionId,
    proposal.referenced_object_ids ?? [],
  );

  if (!check.valid) {
    proposal.needs_human_review = true;
    proposal.missing_info = [
      ...(proposal.missing_info ?? []),
      `引用了未查询到的 ID: ${check.missing.join(', ')}`,
    ];
  }

  console.log(`  └─ ✅ 推理完成, 引用 ${proposal.referenced_object_ids.length} 个 ID, 有效=${check.valid}`);

  // 刷出 Trace 事件
  await guard.flushTrace(executionId, missionId);

  return {
    executionId,
    proposal,
    queryTrace: {
      callCount: trace?.toolCalls.length ?? 0,
      retrievedIds: guard.getRetrievedIds(executionId),
      referenceCheck: check,
    },
  };
}

/**
 * parseQueryPlan — 解析 LLM 返回的 JSON 查询计划
 */
function parseQueryPlan(raw: string): { queries: Array<{ tool: string; args: Record<string, unknown> }> } {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      console.warn('[GroundedReasoning] ⚠️ 未找到 JSON 查询计划，使用默认查询');
      return { queries: [] };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
    return {
      queries: queries.map((q: any) => ({
        tool: String(q.tool ?? q.name ?? 'ontology_queryObjects'),
        args: (q.args ?? q.arguments ?? {}) as Record<string, unknown>,
      })),
    };
  } catch {
    console.warn('[GroundedReasoning] ⚠️ 解析查询计划失败，使用空查询');
    return { queries: [] };
  }
}

/**
 * normalizeProposal — 标准化 LLM 输出的 proposal
 */
function normalizeProposal(raw: string): OntologyProposal {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
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
    }
  } catch {
    // 解析失败
  }

  return {
    referenced_object_ids: [],
    proposal: raw,
    needs_human_review: true,
    missing_info: ['无法解析为 JSON'],
    raw,
  };
}
