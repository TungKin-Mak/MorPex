/**
 * KnowledgeQueryPrimitive — 知识查询原语
 *
 * 核心设计原则：**所有生成/创建操作前，必须先查询知识系统。**
 *
 * 此原语是 MorPex 知识优先架构的基石。
 * - 任何工作流启动时，首先执行 KnowledgeQueryPrimitive
 * - 查询 MemoryWiki、KnowledgeGraph、ArtifactRegistry 获取已有知识
 * - 只有当知识不足时才返回 suggestedActions（如"需要搜索"、"需要验证"）
 * - 永远不猜测、不捏造
 *
 * 部门隔离：所有查询携带 departmentId，自动分区
 *
 * @packageDocumentation
 */

import type { ActionPrimitive, ActionResult, KnowledgeQuery, KnowledgeQueryResult } from './types.js';
import type { ForcedQueryGuard } from '../../../gate/ForcedQueryGuard.js';
import { runOntologyGroundedReasoning } from '../../../gate/runOntologyGroundedReasoning.js';
import { OntologyService } from '../../../knowledge/ontology/OntologyService.js';
import { systemMetadataGraph } from '../../../knowledge/graph/SystemMetadataGraph.js';
import { ObjectTypeRegistry } from '../../../knowledge/ontology/ObjectTypeRegistry.js';
import type { IEventStore } from '../../../infrastructure/protocol/events/store/IEventStore.js';

// —— Ontology Gate Integration ——

let ontologyGuard: ForcedQueryGuard | null = null;
let ontologyService: OntologyService | null = null;
let eventStoreRef: IEventStore | null = null;
/** vNext+: EventBus 引用（QueryMiss 实时广播 → KnowledgeGapListener） */
let eventBusRef: { emit(event: { id: string; type: string; timestamp: number; executionId: string; source: string; payload: Record<string, unknown> }): void } | null = null;
/** 架构全功能实现：真实 piBridge（两阶段 Gate 的 LLM 推理由 bootstrap 注入） */
let piBridgeRef: ((params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }>) | null = null;

/**
 * setPiBridge — 注入真实 piBridge（bootstrap 时调用；缺省回退到空文本占位）
 */
export function setPiBridge(
  fn: (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }>,
): void {
  piBridgeRef = fn;
  console.log('[KnowledgeQueryPrimitive] ✅ 真实 PiBridge 已注入（Gate 两阶段推理启用）');
}

/** 内部获取 piBridge（未注入时回退占位，保证不硬崩） */
function getPiBridge() {
  return piBridgeRef ?? (async () => ({ text: '' }));
}

/**
 * initializeOntologyGate — 必须在 bootstrap 时调用，注入 Ontology 强制守卫
 */
export function initializeOntologyGate(
  guard: ForcedQueryGuard,
  service: OntologyService,
  store?: IEventStore,
  eventBus?: { emit(event: { id: string; type: string; timestamp: number; executionId: string; source: string; payload: Record<string, unknown> }): void },
): void {
  ontologyGuard = guard;
  ontologyService = service;
  eventStoreRef = store ?? null;
  eventBusRef = eventBus ?? null;
  console.log('[KnowledgeQueryPrimitive] ✅ Ontology Gate 已注入');
}

/**
 * getOntologyGuard — 内部获取守卫实例
 */
function getOntologyGuard(): ForcedQueryGuard {
  if (!ontologyGuard) {
    throw new Error('[KnowledgeQueryPrimitive] Ontology Gate 未初始化，请在 bootstrap 中调用 initializeOntologyGate()');
  }
  return ontologyGuard;
}

// ── 查询源映射 ──

interface KnowledgeSource {
  name: string;
  priority: number;
  query: (q: string, deptId: string, limit: number) => Promise<Array<{ content: string; confidence: number; metadata?: Record<string, unknown> }>>;
}

// ── KnowledgeQueryPrimitive ──

export class KnowledgeQueryPrimitive implements ActionPrimitive {
  name = 'knowledge_query';
  description = '查询知识/记忆系统（MemoryWiki + KnowledgeGraph + ArtifactRegistry），是一切操作的前提。始终先查询再行动。';
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '自然语言查询内容' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['memory_wiki', 'knowledge_graph', 'artifact_registry', 'personal_brain'] },
        description: '知识来源（默认全部查询）',
      },
      maxResults: { type: 'number', description: '最大返回条数（默认 10）' },
      minConfidence: { type: 'number', description: '最低置信度 0-1（默认 0.3）' },
      riskTier: {
        type: 'string',
        enum: ['tier-0', 'tier-1', 'tier-2'],
        description: '风险分级：tier-0 Critical（强制两阶段+禁止缓存）/ tier-1 Standard（允许缓存，默认）/ tier-2 Draft（允许无结果时受控探索）',
      },
    },
    required: ['query'],
  };

  /** 注册的知识源查询器 */
  private static sources: KnowledgeSource[] = [];

  /**
   * registerSource — 注册知识源查询器
   * 由 bootstrap 或 MemoryWiki 初始化时调用
   */
  static registerSource(source: KnowledgeSource): void {
    KnowledgeQueryPrimitive.sources.push(source);
    KnowledgeQueryPrimitive.sources.sort((a, b) => a.priority - b.priority);
  }

  /** 判断是否能处理该任务：几乎任何任务都需要先查知识 */
  canHandle(task: string): number {
    const lower = task.toLowerCase();

    // 明确的知识查询需求 — 最高匹配（仅当真的是查询/检索类任务）
    if (/查|搜|找|知识|记忆|知道|了解|查询|搜索|find|search|knowledge|memory|recall|remember|history/.test(lower)) {
      return 1.0;
    }

    // 生产性任务降为中等优先级（vNext+ 路由修正）：
    // 创建/生成类任务应由 ArtifactGeneration / FileOperation / 插件原语优先，
    // 避免知识查询原语在 DomainPrimitiveRegistry.matchBest 中误截具体操作。
    if (/生成|创建|写|编译|上架|发布|设计|开发|实现|execute|generate|create|build|compile|deploy|publish/.test(lower)) {
      return 0.4;
    }

    // 一般分析类任务同样降级
    if (/分析|评估|优化|改进|修复|调试|analyze|assess|optimize|improve|fix|debug/.test(lower)) {
      return 0.35;
    }

    // 兜底：非查询任务不强求（避免无谓拦截具体操作）
    return 0.2;
  }

  async execute(
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string; executionId?: string; missionId?: string }
  ): Promise<ActionResult> {
    const deptId = context?.departmentId || 'global';
    const query0 = (params.query as string) || '';
    // ═══ 16m·2 修复：原语快路径空参兜底——query 空时用 goal（任务描述=要查的内容）兜底，
    //     与 agent 层 createPrimitiveBeforeToolCall 的 step-goal 兜底语义一致，模型无关（不依赖 LLM 乖乖填参）。
    //     背景：GLM-4-Flash 提取参数常返回空 query；executeAuto 快路径的 primParams 已携带 goal，此前未消费 → 失败。 ═══
    let query = query0.trim()
      ? query0
      : typeof params.goal === 'string' && params.goal.trim()
        ? params.goal.trim()
        : '';
    if (query0.trim() === '' && query !== '') {
      console.warn(`[KnowledgeQueryPrimitive] 🛡️ 通用保险：query 为空 → 注入 goal 兜底: ${query.slice(0, 60)}…`);
    }
    const maxResults = (params.maxResults as number) || 10;
    const minConfidence = (params.minConfidence as number) || 0.3;
    // vNext+: Graded Ontology Gate — 知识查询默认 Standard（tier-1）
    const riskTier = (params.riskTier as 'tier-0' | 'tier-1' | 'tier-2' | undefined) ?? 'tier-1';
    const requestedSources = params.sources as string[] | undefined;
    const executionId = context?.executionId || `kq_${Date.now()}`;
    const missionId = context?.missionId;

    if (!query.trim()) {
      return {
        success: false,
        error: 'KnowledgeQueryPrimitive: query 参数不能为空',
      };
    }

    // ★★★ Ontology Gate 强制执行 ★★★
    const guard = getOntologyGuard();

    // 记录开始查询
    guard.recordToolCall(executionId, 'knowledge_query_start', { query, deptId }, null);

    // 调用两阶段 Ontology 强制推理
    // 这会自动调用 ontology_* 工具并记录到 guard
    let ontologyResult;
    try {
      ontologyResult = await runOntologyGroundedReasoning({
        goal: query,
        missionId,
        ontology: ontologyService!,
        guard,
        piBridge: {
          generateText: getPiBridge(),
        },
        extraContext: `departmentId=${deptId}`,
        eventStore: eventStoreRef ?? undefined,
        eventBus: eventBusRef ?? undefined,
        scenario: 'knowledge_query_primitive',
        riskTier,
        // Phase 2 第二批（domain 传递补齐）：KnowledgeQueryPrimitive 有 departmentId 信号 → 按域路由规则
        domain: deptId === 'global' ? undefined : deptId,
      });
    } catch (err) {
      return {
        success: false,
        error: `[Ontology Gate] 强制查询失败: ${(err as Error).message}`,
      };
    }

    // 如果 Ontology 推理失败或缺乏知识，直接返回（QueryMiss 信号已发出）
    if (!ontologyResult.hasUsefulFacts) {
      return {
        success: true,
        data: {
          found: false,
          items: [],
          queryMiss: ontologyResult.queryMiss
            ? {
                tier: ontologyResult.queryMiss.tier,
                reason: ontologyResult.queryMiss.reason,
                controlledExploration: ontologyResult.queryMiss.controlledExploration,
              }
            : undefined,
          suggestedActions: [
            '未能从 Ontology 中获取到有效知识',
            ontologyResult.queryMiss?.controlledExploration
              ? '[ControlledExploration] 已进入受控探索：请在输出中标注不确定性，缺失已记录为 QueryMiss 信号' : undefined,
            '建议先通过其他方式补充知识再重试',
          ].filter(Boolean) as string[],
        } satisfies KnowledgeQueryResult,
      };
    }

    // 使用 Ontology 返回的事实组织结果
    const items: KnowledgeQueryResult['items'] = ontologyResult.proposal.referenced_object_ids.map((fact: any) => ({
      source: 'ontology',
      content: JSON.stringify(fact),
      metadata: { objectId: fact.object?.id },
      confidence: 0.95,
    })) || [];

    const result: KnowledgeQueryResult = {
      found: items.length > 0,
      items: items.slice(0, maxResults),
      suggestedActions: ontologyResult.proposal.missing_info,
    };

    guard.recordToolCall(executionId, 'knowledge_query_completed', { query, resultCount: items.length }, result);

    console.log(
      `[KnowledgeQueryPrimitive] 🔍 "${query.substring(0, 60)}" → ` +
      `${items.length} 条结果 (Ontology Gate 通过, 部门: ${deptId})`
    );

    return { success: true, data: result };
  }
}
