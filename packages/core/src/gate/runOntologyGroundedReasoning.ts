/**
 * runOntologyGroundedReasoning — 共享的 Ontology Grounded Reasoning 方法
 *
 * 迭代2+补丁：
 *   Phase 1 - 强制查询：LLM 输出查询计划 → 执行 → 记录
 *     - JSON 解析失败时执行默认安全查询兜底
 *     - 空结果自动标记 missing_info
 *   Phase 2 - 基于事实推理：LLM 基于检索到的事实输出 proposal
 *     - 引用校验失败 → emit ReferenceValidationFailed 事件
 *
 * 可被 DeliveryPlanner、HierarchicalPlanner、SubAgentFork 等多处调用。
 */

import type { OntologyService } from '../knowledge/ontology/OntologyService.js';
import type { ForcedQueryGuard } from './ForcedQueryGuard.js';
import type { OntologyProposal, RiskTier } from './types.js';
import {
  ontologyToolDefinitions,
  createOntologyToolExecutor,
} from '../infrastructure/tools/ontologyTools.js';
import {
  FORCED_QUERY_SYSTEM_PROMPT,
  buildReasoningUserPrompt,
} from '../knowledge/ontology/prompts/forced-query-system.js';
import type { IEventStore } from '../infrastructure/protocol/events/store/IEventStore.js';
import {
  createReferenceValidationFailedEvent,
  createQueryMissEvent,
} from './ontologyEvents.js';

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
  /** EventStore 引用（可选，用于 emit 引用失败/缺失事件） */
  eventStore?: IEventStore;
  /** EventBus 引用（可选，vNext+：QueryMiss 经总线实时通知演化监听器） */
  eventBus?: {
    emit(event: {
      id: string;
      type: string;
      timestamp: number;
      executionId: string;
      source: string;
      payload: Record<string, unknown>;
    }): void;
  };
  /** 执行场景标签（用于日志和事件） */
  scenario?: string;
  /**
   * 风险分级（vNext+ Graded Ontology Gate）
   *   tier-0 Critical：强制两阶段 + 引用校验 + 同步 Verification，禁止缓存
   *   tier-1 Standard（默认）：两阶段；允许短 TTL 缓存
   *   tier-2 Draft/Internal：尽力查询；无结果 → ControlledExploration + QueryMiss 事件
   */
  riskTier?: RiskTier;
}

export interface GroundedReasoningResult {
  executionId: string;
  proposal: OntologyProposal;
  queryTrace: {
    callCount: number;
    retrievedIds: string[];
    referenceCheck: { valid: boolean; missing: string[]; knownCount: number };
  };
  /** 是否有可用的事实（非空结果） */
  hasUsefulFacts: boolean;
  /** 本次推理的风险分级 */
  riskTier: RiskTier;
  /**
   * 知识缺失信号（QueryMiss is Signal）
   * 无结果时必填，用于驱动 Feedback / Evolution。
   */
  queryMiss?: {
    tier: RiskTier;
    goal: string;
    reason: 'no_results' | 'reference_validation_failed' | 'parse_failed';
    /** tier-2 是否已进入受控探索（ControlledExploration） */
    controlledExploration: boolean;
    timestamp: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// ⭐ P2.7: Ontology grounding 缓存（避免重复两阶段 LLM 调用）
// ═══════════════════════════════════════════════════════════════

/**
 * 简单 LRU 缓存：key = goal_hash, value = GroundedReasoningResult
 * 只缓存简单目标（goal < 80 字符），缓存时间 5 分钟
 */
const groundingCache = new Map<string, { result: GroundedReasoningResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const CACHE_MAX_SIZE = 50;

function getCacheKey(goal: string, scenario?: string, riskTier?: RiskTier): string {
  // 只对短目标启用缓存
  if (goal.length > 80) return '';
  // tier-0 禁止缓存：资金/对外发布/架构变更必须强制两阶段 + 同步验证
  if (riskTier === 'tier-0') return '';
  return `${riskTier || 'tier-1'}::${scenario || ''}::${goal}`;
}

function getCachedResult(key: string): GroundedReasoningResult | null {
  const entry = groundingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    groundingCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedResult(key: string, result: GroundedReasoningResult): void {
  if (!key) return;
  // LRU 淘汰
  if (groundingCache.size >= CACHE_MAX_SIZE) {
    const oldest = [...groundingCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) groundingCache.delete(oldest[0]);
  }
  groundingCache.set(key, { result, timestamp: Date.now() });
}

// ═══════════════════════════════════════════════════════════════

/**
 * runOntologyGroundedReasoning — 执行两阶段强制查询推理
 *
 * Phase 1: 强制 LLM 输出查询计划 → 执行 ontology 工具 → 记录到 Guard
 *   解析失败时执行默认安全查询（查询 Mission 类型），保证不空跑
 * Phase 2: 基于检索到的事实推理 → 输出 proposal
 *   引用校验失败时 emit ReferenceValidationFailed 事件
 *
 * ⭐ P2.7: 对简单目标启用缓存，避免重复两阶段 LLM 调用
 */
export async function runOntologyGroundedReasoning(
  options: GroundedReasoningOptions,
): Promise<GroundedReasoningResult> {
  const { goal, missionId, ontology, guard, piBridge, extraContext, eventStore, scenario } = options;
  const eventBus = options.eventBus;
  // vNext+: Graded Ontology Gate — 默认 Standard（tier-1）
  const riskTier: RiskTier = options.riskTier ?? 'tier-1';

  // ⭐ P2.7: 检查缓存（仅 tier-1/tier-2；tier-0 强制完整两阶段）
  const cacheKey = getCacheKey(goal, scenario, riskTier);
  if (cacheKey) {
    const cached = getCachedResult(cacheKey);
    if (cached) {
      console.log(`[GroundedReasoning] 🎯 命中缓存 (tier=${riskTier}, goal=${goal.substring(0, 40)}...)`);
      return cached;
    }
  }
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

  // 解析查询计划（改进：平衡括号匹配 + 失败默认查询）
  const queryPlan = parseQueryPlanRobust(queryResponse.text);

  if (queryPlan.queries.length === 0) {
    // ═══════════════════════════════════════════════════════════
    // 降级策略：JSON 解析失败 → 执行默认安全查询
    // 保证 assertQueried 有真实事实，不硬崩
    // ═══════════════════════════════════════════════════════════
    console.warn('[GroundedReasoning] ⚠️ 查询计划解析为空，执行默认安全查询');
    const defaultQueries = [
      { tool: 'ontology_queryObjects', args: { type: 'Mission', limit: 10 } },
      { tool: 'ontology_queryObjects', args: { type: 'Artifact', limit: 10 } },
      { tool: 'ontology_queryObjects', args: { type: 'Agent', limit: 10 } },
    ];
    for (const q of defaultQueries) {
      try {
        const result = await toolExecutor(q.tool, q.args);
        console.log(`  ├─ [默认] 已执行 ${q.tool} → 获取 ${Array.isArray(result) ? result.length : '1'} 条结果`);
      } catch (err) {
        console.warn(`  ├─ ⚠️ [默认] ${q.tool} 执行失败:`, (err as Error).message);
      }
    }
  } else {
    // 正常执行 LLM 指定的查询计划
    for (const q of queryPlan.queries) {
      try {
        const result = await toolExecutor(q.tool, q.args);
        console.log(`  ├─ 已执行 ${q.tool} → 获取 ${Array.isArray(result) ? result.length : '1'} 条结果`);
      } catch (err) {
        console.warn(`  ├─ ⚠️ ${q.tool} 执行失败:`, (err as Error).message);
      }
    }
  }

  // 代码兜底：没查就失败
  guard.assertQueried(executionId, 1);

  // P1-1: 检查是否有可用事实
  const trace = guard.getTrace(executionId);
  const retrievedIds = guard.getRetrievedIds(executionId);
  const hasUsefulFacts = retrievedIds.length > 0;

  // ═══════════════════════════════════════════════════════════
  // vNext+: QueryMiss is Signal — 知识缺失必须可观测
  //   无结果不能静默失败，必须产生 QueryMiss 事件 + 分级行为：
  //     tier-0 → needsHumanReview（强制人工介入）
  //     tier-1 → 记录缺失并提示补充知识
  //     tier-2 → ControlledExploration（受控探索，允许尽力而为）
  // ═══════════════════════════════════════════════════════════
  let queryMiss: GroundedReasoningResult['queryMiss'];
  if (!hasUsefulFacts) {
    console.warn(`[GroundedReasoning] ⚠️ 查询完成但未获取到任何对象 ID（QueryMiss, tier=${riskTier}）`);

    const controlledExploration = riskTier === 'tier-2';
    queryMiss = {
      tier: riskTier,
      goal,
      reason: 'no_results',
      controlledExploration,
      timestamp: Date.now(),
    };

    if (eventStore) {
      try {
        await eventStore.append(createQueryMissEvent(executionId, {
          missionId,
          tier: riskTier,
          goal,
          reason: 'no_results',
          controlledExploration,
          retrievedObjectIds: retrievedIds,
        }));
        console.log(`  ├─ 📝 已记录 QueryMiss 事件 (tier=${riskTier}, controlledExploration=${controlledExploration})`);
      } catch (err) {
        console.warn(`[GroundedReasoning] ⚠️ 写入 QueryMiss 事件失败:`, (err as Error).message);
      }
    }

    // vNext+: 经 EventBus 实时广播，驱动 KnowledgeGapListener / Evolution
    eventBus?.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ontology.query.miss',
      timestamp: Date.now(),
      executionId,
      source: 'ontology',
      payload: {
        missionId,
        tier: riskTier,
        goal,
        reason: 'no_results',
        controlledExploration,
        retrievedObjectIds: retrievedIds,
      },
    });
  }

  console.log(`  └─ ✅ 强制查询通过 (${trace?.toolCalls.length ?? 0} 次调用, ${retrievedIds.length} 个对象, tier=${riskTier})`);

  // ---------- Phase 2: 基于事实推理 ----------
  console.log(`[GroundedReasoning] 🏁 Phase 2 - 基于事实推理`);

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

  // 空结果处理：分级行为 + QueryMiss 标记（vNext+）
  if (!hasUsefulFacts) {
    proposal.missing_info = [
      ...(proposal.missing_info ?? []),
      'Ontology 查询未返回任何对象，请考虑放宽查询条件或人工确认数据是否存在',
    ];
    // tier-0：强制人工介入；tier-2：允许受控探索继续；tier-1：记录并提示
    if (riskTier === 'tier-0') {
      proposal.needs_human_review = true;
    } else if (riskTier === 'tier-2') {
      // ControlledExploration：不硬性要求人工审批，但缺失信号已发出
      proposal.needs_human_review = proposal.needs_human_review ?? false;
      proposal.missing_info = [
        ...(proposal.missing_info ?? []),
        '[ControlledExploration] tier-2 允许在无事实情况下尽力而为，缺失已记录为 QueryMiss 信号',
      ];
    } else {
      proposal.needs_human_review = true;
    }
  }

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

    // ═══════════════════════════════════════════════════════════
    // P0-4: 引用校验失败 → emit ReferenceValidationFailed 事件
    // ═══════════════════════════════════════════════════════════
    if (eventStore) {
      try {
        const refEvent = createReferenceValidationFailedEvent(
          executionId,
          check.missing,
          proposal.referenced_object_ids ?? [],
          proposal,
          missionId,
        );
        await eventStore.append(refEvent);
        console.log(`  ├─ 📝 已记录引用失败事件 (缺失 ${check.missing.length} 个 ID)`);
      } catch (err) {
        console.warn(`[GroundedReasoning] ⚠️ 写入引用失败事件失败:`, (err as Error).message);
      }
    }

    // vNext+: 引用校验失败也是 QueryMiss 信号（tier-2 允许受控探索继续）
    if (!queryMiss) {
      const refControlled = riskTier === 'tier-2';
      queryMiss = {
        tier: riskTier,
        goal,
        reason: 'reference_validation_failed',
        controlledExploration: refControlled,
        timestamp: Date.now(),
      };
      if (eventStore) {
        try {
          await eventStore.append(createQueryMissEvent(executionId, {
            missionId,
            tier: riskTier,
            goal,
            reason: 'reference_validation_failed',
            controlledExploration: refControlled,
            retrievedObjectIds: retrievedIds,
          }));
        } catch {
          // 事件写入失败不阻断主流程
        }
      }
    }
  }

  console.log(`  └─ ✅ 推理完成, 引用 ${proposal.referenced_object_ids.length} 个 ID, 有效=${check.valid}`);

  // S34 可观测：gate 成功时也发事件（否则观测面无法确认 L2 是否执行、是否有绕过）
  eventBus?.emit({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ontology.grounded',
    timestamp: Date.now(),
    executionId,
    source: 'ontology',
    payload: {
      missionId,
      riskTier,
      hasUsefulFacts,
      callCount: trace?.toolCalls.length ?? 0,
      referencedIds: proposal.referenced_object_ids?.length ?? 0,
      valid: check.valid,
      goal,
    },
  });

  // 刷出 Trace 事件
  await guard.flushTrace(executionId, missionId);

  const result: GroundedReasoningResult = {
    executionId,
    proposal,
    queryTrace: {
      callCount: trace?.toolCalls.length ?? 0,
      retrievedIds,
      referenceCheck: check,
    },
    hasUsefulFacts,
    riskTier,
    queryMiss,
  };

  // ⭐ P2.7: 写入缓存
  setCachedResult(cacheKey, result);

  return result;
}

/**
 * parseQueryPlanRobust — 健壮的 JSON 查询计划解析
 *
 * 改进：
 *   - 用平衡括号匹配替代非贪婪正则，避免截断嵌套 JSON
 *   - 尝试多层 fallback（完整解析 → 首段 JSON → 无效）
 */
function parseQueryPlanRobust(raw: string): { queries: Array<{ tool: string; args: Record<string, unknown> }> } {
  // 策略 1: 尝试完整 JSON 解析
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

/**
 * extractBalancedJSON — 从文本中提取最外层的平衡 JSON 块
 *
 * 从第一个 { 开始，跟踪括号深度，到最外层 } 结束。
 * 比 /{[\s\S]*?}/ 更准确，不会截断嵌套对象。
 */
function extractBalancedJSON(text: string): string | null {
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
function normalizeProposal(raw: string): OntologyProposal {
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
