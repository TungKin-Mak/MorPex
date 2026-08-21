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
// 功能② Phase 1：规则中断更正（RuleEnforcementGuard）
import { RuleRegistry } from './rules/RuleRegistry.js';
import { check as ruleEnforcementCheck } from './rules/RuleEnforcementGuard.js';
import { extractTargetText } from './rules/detectors.js';
import { lexicalCorrect } from './rules/lexicalCorrection.js';
import { applyStructuralCorrection } from './rules/structuralCorrection.js';
import {
  createRuleViolationEvent,
  createRuleDowngradedEvent,
} from './rules/ruleEvents.js';
import type { RuleDowngradedEvent } from './rules/ruleEvents.js';
import { RetryPolicy } from '../infrastructure/common/resilience/RetryPolicy.js';
// ═══ 去黑盒化（黑盒④ 门禁判定留痕）：统一记录入口 ═══
import { getSharedDeblackboxRecorder } from '../infrastructure/observability/deblackbox/DeblackboxRecorder.js';

/**
 * ═══ 会话 16l·2（P1-6）：Gate 内部 LLM 限流退避——复用已有 RetryPolicy
 * 仅重试 RateLimitError（显式限流/过载信号），指数退避；非限流错误直接上抛（fail loud）。
 * 最大 3 次（含首次），1s base 指数退避（与 batch 的 429/5xx 退避一致）。
 */
const gateRetryPolicy = new RetryPolicy({
  maxAttempts: 5,          // ═══ 16m·2：3→5（GLM 密集限流需更长恢复窗口）═══
  baseDelayMs: 3000,       // ═══ 16m·2：1s→3s ═══
  strategy: 'exponential',
  maxDelayMs: 60000,       // ═══ 16m·2：30s→60s ═══
  retryableErrors: ['RateLimitError'],
});

async function withGateRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < gateRetryPolicy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const e = err as Error;
      if (!gateRetryPolicy.shouldRetry(e) || attempt >= gateRetryPolicy.maxAttempts - 1) {
        if (gateRetryPolicy.shouldRetry(e)) {
          console.warn(`[GroundedReasoning] ⚠️ ${label} 限流重试耗尽（${gateRetryPolicy.maxAttempts} 次）`);
        }
        throw err;
      }
      const wait = gateRetryPolicy.getDelay(attempt);
      console.warn(`[GroundedReasoning] ⚠️ ${label} 限流（第 ${attempt + 1} 次失败）→ 等待 ${(wait / 1000).toFixed(1)}s 退避重试`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}
import type { RuleEntity, RuleViolation } from './rules/types.js';

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
    }) => Promise<{
      text: string;
      /** 真实 token 用量（PiBridge.generateText 返回；缺失时回退估算） */
      usage?: { input?: number; output?: number; total?: number };
    }>;
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
   * 领域路由（功能② Phase 1 + Phase 2 F）：传入则规则只匹配该 domain 的 active 规则；
   * 不传则按全局匹配。Phase 2 F 已由 MorPexRuntime 从 context.goal.domain 打通；
   * 其余调用方暂无可靠信号（见 docs/FEATURE_RULE_ENFORCEMENT.md §7）。
   */
  domain?: string;
  /**
   * 风险分级（vNext+ Graded Ontology Gate）
   *   tier-0 Critical：强制两阶段 + 引用校验 + 同步 Verification，禁止缓存
   *   tier-1 Standard（默认）：两阶段；允许短 TTL 缓存
   *   tier-2 Draft/Internal：尽力查询；无结果 → ControlledExploration + QueryMiss 事件
   */
  riskTier?: RiskTier;
  /**
   * Token 用量回调（Phase 2 E — L5 预算接线）：Gate 内每次 LLM 调用（Phase 1 查询 +
   * Phase 2 推理 + 每次规则重试）后估算 tokens 并回调，供上层累计成本。
   * 估算 = ceil((prompt.length + text.length) / 4)（粗略；精确计费留后续）。可选，未传无副作用。
   */
  onTokenUsage?: (tokens: number) => void;
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
  /** Wave 3b：运行时 Gate 凭证（供 Artifact 注册/晋升等入口硬校验） */
  knowledgeContextPackage?: {
    executionId: string;
    riskTier: RiskTier;
    queryCallCount: number;
    retrievedIds: string[];
    referenceCheck: { valid: boolean; missing: string[]; knownCount: number };
    issuedAt: number;
  };
  /** 功能②：规则中断结果（无违规/无规则时为空数组；供审计与演化队列） */
  ruleViolations?: RuleViolation[];
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
  // Phase 2（D）：规则指纹并入 key —— 规则变更 → fingerprint 变 → 旧缓存天然失效，
  // 避免"命中旧缓存跳过新规则检查"（规则更新后旧缓存可能携带违规结果）
  const ruleFingerprint = RuleRegistry.fingerprint();
  const fpPart = ruleFingerprint ? `::rules:${ruleFingerprint}` : '';
  return `${riskTier || 'tier-1'}::${scenario || ''}::${goal}${fpPart}`;
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

/**
 * countTokens — LLM 调用 token 计数（Phase 2 第二批：精确计费）
 * 真实 usage.total 优先；缺失时回退估算 ceil((prompt+text)/4)（兼容旧 piBridge 结构）。
 */
function countTokens(
  res: { text: string; usage?: { input?: number; output?: number; total?: number } } | null | undefined,
  promptText: string,
): number {
  if (typeof res?.usage?.total === 'number' && res.usage.total > 0) return res.usage.total;
  return Math.ceil((promptText.length + (res?.text?.length ?? 0)) / 4);
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

  const queryResponse = await withGateRetry(
    () => piBridge.generateText({
      system: FORCED_QUERY_SYSTEM_PROMPT,
      prompt: queryPrompt,
      temperature: 0.2,
    }),
    'Phase 1 强制查询',
  );
  // Phase 2 E：预算接线——Phase 1 查询 token 回调（精确：usage.total 优先，缺失估算）；回调异常不影响主流程
  try {
    options.onTokenUsage?.(countTokens(queryResponse, queryPrompt));
  } catch (err) {
    console.warn('[GroundedReasoning] ⚠️ onTokenUsage 回调异常（不影响主流程）:', (err as Error).message);
  }

  // 解析查询计划（改进：平衡括号匹配 + 消毒器防宽查询 + 失败默认查询）
  let queryPlan = sanitizeQueryPlan(parseQueryPlanRobust(queryResponse.text));

  // ═══ 16m·2：GLM-4-Flash 偶发输出无效 JSON → 重试一次生成查询计划（再失败才降级默认查询）═══
  if (queryPlan.queries.length === 0) {
    console.warn('[GroundedReasoning] ⚠️ 查询计划解析为空，重试一次生成…');
    try {
      const retryResp = await withGateRetry(
        () => piBridge.generateText({ system: FORCED_QUERY_SYSTEM_PROMPT, prompt: queryPrompt, temperature: 0.2 }),
        'Phase 1 强制查询（计划重试）',
      );
      queryPlan = sanitizeQueryPlan(parseQueryPlanRobust(retryResp.text));
    } catch (err) {
      console.warn('[GroundedReasoning] ⚠️ 查询计划重试失败，将降级默认查询:', (err as Error).message);
    }
  }

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

  // ═══════════════════════════════════════════════════════════
  // 功能② Phase 1：规则中断更正（RuleEnforcementGuard）
  //   无 active 规则 → 完全旁路（不引入任何额外 LLM 调用，保持既有行为）
  //   ERROR 违规 → 携带规则约束重试（最多 3 次）→ 仍违规 → needs_human_review
  //   连续命中 2 次 → 临时降级该规则（仅本次执行，防误报卡死）
  //   WARNING 违规 → 不中断，仅记录事件
  // ═══════════════════════════════════════════════════════════
  // 领域路由：options.domain 传入 → 按域匹配；未传 → 全局（Phase 1 默认，
  // 跨域影响已靠"领域示例规则默认 pending 待确认"消除，见 rule-register.ts）
  const activeRules = RuleRegistry.getActiveRules(options.domain);
  const RULE_MAX_ATTEMPTS = 3;
  /** 连续命中降级阈值：同一规则连续命中 N 次仍不过 → 临时降级（疑似误报）+ 转人工 */
  const CONSECUTIVE_HIT_LIMIT = 2;
  const consecutiveHits = new Map<string, number>();
  const downgradedRules = new Set<string>();
  const downgradedEvents: RuleDowngradedEvent[] = [];
  const ruleDomainOf = (ruleId: string): string =>
    activeRules.find((r) => r.id === ruleId)?.domain ?? '';
  let proposal: OntologyProposal | null = null;
  let ruleViolations: RuleViolation[] = [];

  for (let attempt = 0; attempt < RULE_MAX_ATTEMPTS; attempt++) {
    const constraintSuffix =
      attempt === 0 || ruleViolations.length === 0
        ? ''
        : `\n\n【修正要求】你的上一版输出违反以下规则，必须修改输出使其完全合规（不得再出现违规内容）：\n${ruleViolations
            .filter((v) => v.severity === 'ERROR')
            .map((v) =>
              v.semanticTriggered
                ? `- [${v.ruleId}] ${v.description}（关键词「${v.keyword}」；判定：${v.semanticReason ?? ''}${v.semanticSuggestion ? `；建议：${v.semanticSuggestion}` : ''}）`
                : `- [${v.ruleId}] ${v.description}（命中内容：${v.matchedText}）`,
            )
            .join('\n')}`;

    const reasoningResponse = await withGateRetry(
      () => piBridge.generateText({
        system: FORCED_QUERY_SYSTEM_PROMPT,
        prompt: attempt === 0 ? reasoningUser : reasoningUser + constraintSuffix,
        // 重试轮降低温度：携带明确约束时更确定性（方案文档 §5）
        temperature: attempt === 0 ? 0.3 : 0.2,
      }),
      'Phase 2 推理',
    );
    // Phase 2 E：预算接线——Phase 2 推理 + 每次规则重试 token 回调（精确：usage.total 优先）；回调异常不影响主流程
    try {
      options.onTokenUsage?.(countTokens(reasoningResponse, reasoningUser));
    } catch (err) {
      console.warn('[GroundedReasoning] ⚠️ onTokenUsage 回调异常（不影响主流程）:', (err as Error).message);
    }

    proposal = normalizeProposal(reasoningResponse.text);

    // 无规则 → 旁路（no-op，保既有行为）
    if (activeRules.length === 0) break;

    const applicable = activeRules.filter((r) => !downgradedRules.has(r.id));
    const checkResult = ruleEnforcementCheck(proposal, applicable);
    ruleViolations = checkResult.violations;

    // ═══════════════════════════════════════════════════════════
    // ⭐ keyword 第二级语义判断（通用两级模型，全行业通用）：
    //   仅对"关键词命中"的规则调 LLM，确认"触及该词的内容是否满足 description 要求"
    //   - triggered=true  → 计入违规（semanticTriggered=true，进入修正重生成）
    //   - triggered=false → 该规则不算违规，移除放行
    //   成本控制：regex/whitelist 命中不调语义 LLM（仅 keyword 命中才调）
    // ═══════════════════════════════════════════════════════════
    for (const v of [...ruleViolations]) {
      if (!v.keyword) continue;
      // WARNING 不中断：跳过语义 LLM（仅记录事件即可，成本控制）
      if (v.severity !== 'ERROR') continue;
      const rule = applicable.find((r) => r.id === v.ruleId);
      if (!rule) continue;
      const judgement = await semanticJudgement(piBridge, rule, v, proposal, options.onTokenUsage);
      if (judgement.triggered) {
        v.semanticTriggered = true;
        v.semanticReason = judgement.reason;
        v.semanticSuggestion = judgement.suggestion;
      } else {
        // 未触发 → 该规则不算违规，移除（放行）
        ruleViolations = ruleViolations.filter((x) => x !== v);
      }
    }

    let errorViolations = ruleViolations.filter((v) => v.severity === 'ERROR');

    // WARNING 违规：不中断，仅记录事件（eventStore 存在时）
    for (const v of ruleViolations.filter((x) => x.severity === 'WARNING')) {
      if (eventStore) {
        try {
          await eventStore.append(createRuleViolationEvent(executionId, {
            missionId,
            goal,
            ruleId: v.ruleId,
            ruleDomain: ruleDomainOf(v.ruleId),
            severity: 'WARNING',
            matchedText: v.matchedText,
            target: v.target,
            description: v.description,
            retriesExhausted: false,
            keyword: v.keyword,
            semanticReason: v.semanticReason,
            semanticSuggestion: v.semanticSuggestion,
          }));
        } catch (err) {
          console.warn(`[GroundedReasoning] ⚠️ 写入规则 WARNING 事件失败:`, (err as Error).message);
        }
      }
    }

    // 合规 → 放行
    if (errorViolations.length === 0) break;

    // ═══════════════════════════════════════════════════════════
    // Phase 2（A）：词法修正（通用修正管线①）—— 最便宜的快速通道
    //   仅对 allowedAction 明确的规则做保守机械替换；修正后重新 check，
    //   合规则放行（跳过 LLM 重试）；仍违规 → 继续降级/重试逻辑
    // ═══════════════════════════════════════════════════════════
    const corrected = lexicalCorrect(proposal, errorViolations, applicable);
    if (corrected.correctedCount > 0) {
      proposal = corrected.proposal;
      const recheck = ruleEnforcementCheck(proposal, applicable);
      ruleViolations = recheck.violations;
      if (!recheck.hasError) {
        console.log(`[GroundedReasoning] ✅ 词法修正成功（${corrected.correctedCount} 处），合规放行`);
        break;
      }
      // 修正后仍违规 → 用修正后的违规集继续（供降级/重试用尽判断）
      errorViolations = recheck.violations.filter((v) => v.severity === 'ERROR');
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 2（第二批）：结构修正（通用修正管线②）—— eslint --fix 式
    //   领域适配器（software eslint/tsc 等）经 StructuralCorrectionRegistry 注入；
    //   修正后重新 check，合规则放行；仍违规 → 继续降级/LLM 重试路径
    // ═══════════════════════════════════════════════════════════
    if (errorViolations.length > 0) {
      const structural = await applyStructuralCorrection(proposal, errorViolations, applicable);
      if (structural.correctedCount > 0) {
        proposal = structural.proposal;
        const recheck = ruleEnforcementCheck(proposal, applicable);
        ruleViolations = recheck.violations;
        if (!recheck.hasError) {
          console.log(`[GroundedReasoning] ✅ 结构修正成功（${structural.correctedCount} 处，${structural.notes.join('; ')}），合规放行`);
          break;
        }
        errorViolations = recheck.violations.filter((v) => v.severity === 'ERROR');
      }
    }

    // 连续命中降级：同一规则连续 2 次命中仍不过 → 临时跳过（仅本次执行，不改持久状态）
    for (const v of errorViolations) {
      const hits = (consecutiveHits.get(v.ruleId) ?? 0) + 1;
      consecutiveHits.set(v.ruleId, hits);
      if (hits >= CONSECUTIVE_HIT_LIMIT && !downgradedRules.has(v.ruleId)) {
        downgradedRules.add(v.ruleId);
        downgradedEvents.push(createRuleDowngradedEvent(executionId, {
          missionId,
          goal,
          ruleId: v.ruleId,
          ruleDomain: ruleDomainOf(v.ruleId),
          hitCount: hits,
        }));
      }
    }

    // 重试用尽仍违规 → 转人工 + 记录违规事件
    if (attempt === RULE_MAX_ATTEMPTS - 1) {
      proposal.needs_human_review = true;
      proposal.missing_info = [
        ...(proposal.missing_info ?? []),
        `规则中断更正失败（${errorViolations.length} 条 ERROR 违规仍存在）：${errorViolations.map((v) => v.ruleId).join(', ')}`,
      ];
      for (const v of errorViolations) {
        if (eventStore) {
          try {
            await eventStore.append(createRuleViolationEvent(executionId, {
              missionId,
              goal,
              ruleId: v.ruleId,
              ruleDomain: ruleDomainOf(v.ruleId),
              severity: 'ERROR',
              matchedText: v.matchedText,
              target: v.target,
              description: v.description,
              retriesExhausted: true,
              keyword: v.keyword,
              semanticReason: v.semanticReason,
              semanticSuggestion: v.semanticSuggestion,
            }));
          } catch (err) {
            console.warn(`[GroundedReasoning] ⚠️ 写入规则违规事件失败:`, (err as Error).message);
          }
        }
      }
      break;
    }
  }

  // 降级事件统一落库（防误报卡死信号可观测）
  if (downgradedEvents.length > 0 && eventStore) {
    for (const ev of downgradedEvents) {
      try {
        await eventStore.append(ev);
      } catch (err) {
        console.warn(`[GroundedReasoning] ⚠️ 写入规则降级事件失败:`, (err as Error).message);
      }
    }
  }

  // 规则被临时降级（疑似误报）→ 输出仍疑似违规，转人工确认（不静默放行）
  if (downgradedRules.size > 0 && proposal && !proposal.needs_human_review) {
    proposal.needs_human_review = true;
    proposal.missing_info = [
      ...(proposal.missing_info ?? []),
      `规则已因连续命中临时降级（${[...downgradedRules].join(', ')}），输出仍疑似违规，转人工确认`,
    ];
  }

  // 循环保证至少一次赋值；防御性兜底（TS 收窄）
  if (!proposal) proposal = normalizeProposal('');

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
    // 功能②：规则中断结果（审计/演化队列用；无违规时空数组）
    ruleViolations,
    // Wave 3b：签发运行时 Gate 凭证（KnowledgeContextPackage）——
    // Artifact 注册/晋升等入口可凭此包通过 requireKnowledgeContext 硬校验
    knowledgeContextPackage: {
      executionId,
      riskTier,
      queryCallCount: trace?.toolCalls.length ?? 0,
      retrievedIds,
      referenceCheck: check,
      issuedAt: Date.now(),
    },
  };

  // ⭐ P2.7: 写入缓存
  setCachedResult(cacheKey, result);

  // ═══ 去黑盒化（黑盒④）：门禁判定留痕（L1 决策单永久；异常/拦截强制全记）═══
  try {
    const queryCount = trace?.toolCalls.length ?? 0;
    const hits = retrievedIds.length;
    const errorViolations = ruleViolations.filter((v) => v.severity === 'ERROR');
    let verdict = 'allow';
    let verdictReason = '查询到有效依据且引用校验通过，允许有依据生成';
    if (!check.valid) {
      verdict = 'block';
      verdictReason = `引用校验失败（缺失 ${check.missing.length} 个 ID），需人工复核`;
    } else if (errorViolations.length > 0) {
      verdict = 'block-rules';
      verdictReason = `规则强制校验失败（${errorViolations.length} 个 ERROR 违规）`;
    } else if (queryMiss) {
      verdict = 'allow-with-uncertainty';
      verdictReason = `存在 QueryMiss（${queryMiss.reason}），${queryMiss.controlledExploration ? 'tier-2 受控探索放行' : '结果带残余不确定性'}`;
    }
    getSharedDeblackboxRecorder().record({
      category: 'gate.decision',
      source: 'ontology-gate',
      executionId,
      level: 'L1',
      isError: verdict.startsWith('block'),
      summary: {
        goal,
        riskTier,
        scenario: scenario ?? null,
        queryCount,
        hits,
        hasUsefulFacts,
        queryMiss: queryMiss ? { reason: queryMiss.reason, tier: queryMiss.tier, controlledExploration: queryMiss.controlledExploration } : null,
        referenceValid: check.valid,
        missingRefs: check.missing ?? [],
        ruleViolationCount: ruleViolations.length,
        downgradedRuleCount: downgradedEvents.length,
        verdict,
        verdictReason,
        readonly: false,
        decision: verdict,
        reasoning: verdictReason,
      },
    });
  } catch (err) {
    console.warn('[GroundedReasoning] ⚠️ 门禁判定记录失败（忽略）:', (err as Error).message);
  }

  return result;
}

/**
 * parseQueryPlanRobust — 健壮的 JSON 查询计划解析
 *
 * 改进：
 *   - 用平衡括号匹配替代非贪婪正则，避免截断嵌套 JSON
 *   - 尝试多层 fallback（完整解析 → 首段 JSON → 无效）
 */
function parseQueryPlanRobust(raw: string): { queries: Array<{ tool: string; args: Record<string, unknown> }> } {  // 策略 1: 尝试完整 JSON 解析
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
function sanitizeQueryPlan(
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

/**
 * semanticJudgement — 通用两级模型·第二级：LLM 语义复核（仅关键词命中时调用）
 *
 * 输入：规则 description（自然语言要求）+ 输出中涉及关键词的片段（±80 字符上下文）
 * 输出：{ triggered, reason, suggestion }
 *   - triggered=true  → 触及违规，需修正重生成（reason/suggestion 注入约束）
 *   - triggered=false → 该规则不算违规，放行
 *
 * 保守策略：JSON 解析失败/异常 → triggered=true（防漏检，转人工兑底）
 * 成本控制：仅在 KeywordDetector 第一级命中后调用（管道层持有 piBridge）。
 */
async function semanticJudgement(
  piBridge: GroundedReasoningOptions['piBridge'],
  rule: RuleEntity,
  violation: RuleViolation,
  proposal: OntologyProposal,
  onTokenUsage?: (tokens: number) => void,
): Promise<{ triggered: boolean; reason: string; suggestion: string }> {
  const fullText = extractTargetText(proposal, violation.target) || '';
  const kw = violation.keyword ?? '';
  const idx = fullText.toLowerCase().indexOf(kw.toLowerCase());
  const start = Math.max(0, idx - 80);
  const end = Math.min(fullText.length, idx + kw.length + 80);
  const snippet = (idx >= 0 ? fullText.slice(start, end) : fullText.slice(0, 160)) || '（无法定位片段）';

  const system = '你是规则合规审查员。根据规则要求判断内容是否合规。';
  const prompt = [
    `规则要求：${rule.description}`,
    '',
    `以下输出涉及关键词「${kw}」：`,
    snippet,
    '',
    '请判断这段输出对该关键词相关内容的处理是否满足规则要求。',
    '若可能违规/需修正 → triggered=true，并给出理由与修正建议；否则 triggered=false。',
    '只输出 JSON：{"triggered":boolean,"reason":"...","suggestion":"..."}',
  ].join('\n');

  try {
    const resp = await withGateRetry(
      () => piBridge.generateText({ system, prompt, temperature: 0.2 }),
      '语义判断',
    );
    // 预算可观测性：语义判断的 LLM 调用同样计入 onTokenUsage（精确：usage.total 优先）
    try {
      onTokenUsage?.(countTokens(resp, prompt));
    } catch (err) {
      console.warn('[GroundedReasoning] ⚠️ 语义判断 onTokenUsage 回调异常（不影响主流程）:', (err as Error).message);
    }
    const block = extractBalancedJSON(resp.text);
    if (block) {
      const parsed = JSON.parse(block) as Record<string, unknown>;
      return {
        triggered: parsed.triggered !== false, // 缺省/非 boolean → 保守 true
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
      };
    }
  } catch {
    // 解析失败 → 保守 triggered=true（防漏检）
  }
  return { triggered: true, reason: '语义判断解析失败，保守视为需修正', suggestion: '' };
}
