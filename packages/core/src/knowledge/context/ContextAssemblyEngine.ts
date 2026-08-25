/**
 * ContextAssemblyEngine — 上下文组装引擎（核心）
 *
 * v9.1 Context Assembly Layer: 统一上下文构建入口。
 *
 * 流程：
 *   1. 选择模板（按 templateId 或标签匹配）
 *   2. 从注册中心收集必需 + 可选片段
 *   3. 将片段注入 Builder
 *   4. 应用模板基础数据
 *   5. 构建 ExecutionContext
 *   6. 运行增强流水线（可选）
 *   7. 版本快照（可选）
 *   8. 返回最终上下文
 */

import type { FragmentSource, ContextAssemblyInput, ContextFragment } from './ContextFragmentRegistry.js'
import type { ExecutionContext, RecentSummaryReader, RiskGrader, RiskLevel } from './ContextBuilder.js'
import { ContextFragmentRegistry } from './ContextFragmentRegistry.js'
import { ContextBuilder } from './ContextBuilder.js'
import { ContextVersioner } from './ContextVersioner.js'
import { ContextTemplateRepository } from './ContextTemplateRepository.js'
import { ContextEnricherPipeline } from './ContextEnricher.js'
import type { ContextPersistence } from './ContextPersistence.js'
import { createHash } from 'node:crypto';
import { withInflight } from '../../infrastructure/common/cache/inflight.js';
import type { EventBus } from '../../infrastructure/common/EventBus.js'
// ═══ 去黑盒化（黑盒③ 检索决策记录）═══
import { getSharedDeblackboxRecorder } from '../../infrastructure/observability/deblackbox/DeblackboxRecorder.js';
// ═══ Model-Visible 宣言（v18 新建）：装配输出必须可从持久化点重建 ═══
import {
  assertModelVisibleLogged,
  createContextPackageEntry,
  createDeblackboxEntry,
  contextPersistenceResolver,
  deblackboxResolver,
} from '../../gate/modelVisibleLog.js';

// ── ContextAssemblyConfig — 组装配置 ──

export interface ContextAssemblyConfig {
  /** 模板 ID（若不指定则按标签匹配） */
  templateId?: string
  /** 是否启用版本快照 */
  enableVersioning: boolean
  /** 是否启用增强流水线 */
  enableEnrichment: boolean
  /** 最大片段数量（超过则截断） */
  maxFragments: number
  /** 每个片段采集的超时时间（ms） */
  fragmentTimeoutMs: number
  /** Schema 版本 */
  schemaVersion: string
  /** 功能③：聚焦模式（只装当前任务材料：goal/mission/artifact + custom，生成 focusedSummary，按 token 截断） */
  focusMode?: boolean
  /** 功能③：聚焦模式 token 估算上限（超出从低优先级片段截断；默认 8000） */
  maxTokens?: number
  /** 功能③ 遗留项：近期摘要读取器（消费端拼接；装配时召回 ≤N 条归档摘要注入工作上下文） */
  recentSummaryReader?: RecentSummaryReader
  /** 功能③ 遗留项：近期摘要召回条数上限（默认 5） */
  recentSummaryLimit?: number
  /** 功能③ 遗留项：风险分级器（默认 defaultRiskGrader 确定性分级；可自定义覆写） */
  riskGrader?: RiskGrader
  /** 会话 16c（3+4）：装配成本监控开关（默认 true） */
  enableTelemetry?: boolean
  /** 会话 16c（3+4）：EventBus（可选）——发射 context.assembly.telemetry 供观测聚合 */
  eventBus?: EventBus
  /**
   * 会话 16d（P2）：任务间经验主动注入器——按 goal/domain 返回相似任务规避提示，
   * 注入聚焦上下文（预防性）。未配置/返回 null → 不注入。
   */
  experienceInjector?: { inject(goal: string, domain?: string): string | null | Promise<string | null> }
  /**
   * 会话 16i（RAG-lazy 装配）：相关性检索器——按 goal 语义检索 Top-K 任务上下文/经验/策略，
   * 替代"最近 N 条按时间全量注入"（省 token + 语义相关保质量）。未配置 → 回退 recentSummaryReader。
   */
  retriever?: {
    retrieveRelevant(goal: string, domain?: string, topK?: number): Promise<Array<{ ref: string; summary: string; score: number }>> | Array<{ ref: string; summary: string; score: number }>
  }
  /** 会话 16i：4 层装配每层字符预算（working 受保护永驻；超预算截断） */
  layerBudgets?: { working?: number; episodic?: number; semantic?: number; procedural?: number }
}

const DEFAULT_CONFIG: ContextAssemblyConfig = {
  enableVersioning: true,
  enableEnrichment: true,
  maxFragments: 50,
  fragmentTimeoutMs: 5000,
  schemaVersion: '1.0',
  focusMode: false,
  maxTokens: 8000,
  recentSummaryLimit: 5,
}

// ═══════════════════════════════════════════════════════════════
// 风险分级（功能③ 遗留项）——默认确定性分级器（不依赖 LLM）
// ═══════════════════════════════════════════════════════════════

/**
 * defaultRiskGrader — 默认风险分级（确定性关键词命中，零 LLM 成本）
 *
 * high   ：破坏性/不可逆操作（删除/清空/销毁/格式化/关机等）
 * medium ：有副作用但可回退（写/创建/部署/提交/发送/安装等）
 * low    ：只读/查询/生成类（默认）
 *
 * 领域/团队可经 config.riskGrader 覆写（输入含 fragments 可看实际材料）。
 */
export function defaultRiskGrader(goal: string, _departmentId?: string): RiskLevel {
  const text = goal ?? ''
  if (/\b(delete|remove|drop|purge|destroy|rm|wipe|format|truncate|shutdown|kill)\b/i.test(text)) return 'high'
  if (/\b(write|create|modify|update|deploy|build|push|commit|send|post|publish|install|upgrade|start|stop)\b/i.test(text)) return 'medium'
  return 'low'
}

// ── ContextAssemblyEngine — 核心引擎 ──

export class ContextAssemblyEngine {
  private registry: ContextFragmentRegistry
  private builder: ContextBuilder
  private versioner: ContextVersioner
  private templates: ContextTemplateRepository
  private enricherPipeline: ContextEnricherPipeline
  private config: ContextAssemblyConfig
  /** 惰性持久化 provider（bootstrap 注入；assemble/loadContext 运行时解析存储，时序安全） */
  private persistenceProvider: (() => ContextPersistence | null | undefined) | null
  /** P1 #2：在飞去重——同 missionId+goal 并发共享单次装配 */
  private assembleInflight: Map<string, Promise<ExecutionContext>> = new Map()

  constructor(
    registry?: ContextFragmentRegistry,
    builder?: ContextBuilder,
    versioner?: ContextVersioner,
    templates?: ContextTemplateRepository,
    enricherPipeline?: ContextEnricherPipeline,
    config?: Partial<ContextAssemblyConfig>,
    private persistence?: ContextPersistence,
    private metrics?: { record: (name: string, value: number, tags?: Record<string, string>) => void }
  ) {
    this.persistenceProvider = null
    // 若构造时传了 persistence，也视为默认 provider（setPersistenceProvider 可覆写）
    if (persistence) this.persistenceProvider = () => persistence
    this.registry = registry ?? new ContextFragmentRegistry()
    this.builder = builder ?? new ContextBuilder()
    this.versioner = versioner ?? new ContextVersioner()
    this.templates = templates ?? new ContextTemplateRepository()
    this.enricherPipeline = enricherPipeline ?? new ContextEnricherPipeline()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * assemble — 执行完整的上下文组装流程
   *
   * @param input - 组装输入（missionId, userId, tags 等）
   * @returns 组装完成的 ExecutionContext
   */
  private assembleKey(input: ContextAssemblyInput): string {
    // 关键区分度：missionId+goal+domain+currentTask；超长 goal 做 hash 防 key 膨胀与分隔符碰撞
    const taskPart = input.currentTask ? `${input.currentTask.goalId ?? ''}:${input.currentTask.planId ?? ''}:${input.currentTask.taskId ?? ''}` : '';
    const raw = `${input.missionId ?? ''}\u0001${input.goal ?? ''}\u0001${input.domain ?? ''}\u0001${taskPart}`;
    if (raw.length <= 512) return raw;
    const h = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `${input.missionId ?? ''}:${h}`;
  }

  async assemble(input: ContextAssemblyInput): Promise<ExecutionContext> {
    const inflightKey = this.assembleKey(input);
    return withInflight(this.assembleInflight, inflightKey, () => this.assembleInternal(input));
  }

  private async assembleInternal(input: ContextAssemblyInput): Promise<ExecutionContext> {
    // ═══ 会话 16c（3+4）：装配成本监控——记录开始时间 ═══
    const assembleStart = this.config.enableTelemetry === false ? 0 : Date.now();
    // ═══ 会话 16i：4 层字符量（focus 块填充，attachAssemblyTelemetry 合并）═══
    const layerSizes = { working: 0, semantic: 0, episodic: 0, procedural: 0 };

    // 1. 选择模板
    const template = this.selectTemplate(input)

    // 功能③ 聚焦模式（三分法，用户主导设计）：
    //   ① 系统级（user_profile/custom：用户画像、既定规则、系统约束）→ 永不省略
    //   ② 当前任务级（goal_graph/mission_state/artifact_lineage）→ 按 taskRef 归属匹配 currentTask
    //   ③ 历史级（decision_history/behavior_twin/agent_status）→ 不采集（需则主动召回）
    // 身份 ID 是上下文生命周期主键：装配按它过滤 → 抽离快照带它入库 → 召回按它检索。
    const focusMode = this.config.focusMode === true
    const SYSTEM_SOURCES: FragmentSource[] = ['user_profile', 'custom']
    const TASK_SOURCES: FragmentSource[] = ['goal_graph', 'mission_state', 'artifact_lineage']
    const HISTORY_SOURCES: FragmentSource[] = ['decision_history', 'behavior_twin', 'agent_status']
    const sourceFilter = (s: FragmentSource): boolean => {
      if (!focusMode) return true
      return SYSTEM_SOURCES.includes(s) || TASK_SOURCES.includes(s)
    }

    // 2. 决定采集哪些片段来源
    const requiredSources = (template?.requiredFragments ?? []).filter(sourceFilter)
    const optionalSources = (template?.optionalFragments ?? []).filter(sourceFilter)
    const allSources = [...new Set([...requiredSources, ...optionalSources])] as FragmentSource[]

    // 3. 从注册中心收集片段（带超时）
    let fragments = await this.collectFragmentsWithTimeout(input, allSources)

    // 功能③ 聚焦模式·身份过滤：任务级片段按 taskRef 归属匹配当前任务（身份 ID 主键）
    //   - 系统级片段永不省略；任务级片段需 taskRef == currentTask.{goalId|planId|taskId}
    //   - 任务级但未挂 taskRef（Provider 未实现归属标记）→ 保守装（防误删当前任务材料）
    //   - 未传 currentTask → 不过滤（向后兼容）
    if (focusMode) {
      const ct = input.currentTask
      fragments = fragments.filter((f) => {
        if (SYSTEM_SOURCES.includes(f.source)) return true
        if (!f.taskRef) return true
        if (!ct) return true
        return f.taskRef === ct.goalId || f.taskRef === ct.planId || f.taskRef === ct.taskId
      })
    }

    // 4. 兜底：为核心片段自动生成默认值（首次使用自动创建）
    const collectedSources = new Set(fragments.map(f => f.source))
    const missingFragments: string[] = []
    for (const required of requiredSources) {
      if (!collectedSources.has(required)) {
        const fallback = this.generateFallbackFragment(required, input)
        if (fallback) {
          fragments.push(fallback)
          collectedSources.add(required)
          missingFragments.push(required)
        }
      }
    }

    // 上报缺失片段（已兜底但说明外部 Provider 未注册）
    if (missingFragments.length > 0) {
      console.warn(
        `[ContextAssemblyEngine] ⚠️  ${missingFragments.length} 个关键片段使用默认值: ${missingFragments.join(', ')}。` +
        `注册对应 Provider 可获取真实数据。`
      )
      this.metrics?.record('context.missing_fragments', missingFragments.length, {
        fragments: missingFragments.join(','),
        missionId: input.missionId,
      })
    }

    // 任务 ④：Provider 归属标记——真实注册 Provider vs 默认兜底（missingFragments = 本次兜底来源）
    // 消费端可据此区分真实数据与默认占位（信任分级/审计）；fragment.attribution 持久化随快照入库
    const fallbackSet = new Set(missingFragments)
    for (const f of fragments) {
      f.attribution = { providerType: fallbackSet.has(f.source) ? 'fallback' : 'registered' }
    }

    // 5. 限制片段数量（功能③ 聚焦模式：不主动截断——选对材料优先（原则①），
    //    maxTokens 仅为异常兜底上限：仅当材料异常超限（> maxTokens×10）才截，防极端失控）
    let trimmedFragments = fragments
    if (focusMode) {
      const maxTokens = this.config.maxTokens ?? 8000
      const totalTokens = fragments.reduce((acc, f) => acc + estimateFragmentTokens(f), 0)
      if (totalTokens > maxTokens * 10) {
        let acc = 0
        trimmedFragments = []
        for (const f of fragments) {
          if (acc + estimateFragmentTokens(f) > maxTokens && trimmedFragments.length > 0) break
          acc += estimateFragmentTokens(f)
          trimmedFragments.push(f)
        }
      }
    } else {
      trimmedFragments = fragments.slice(0, this.config.maxFragments)
    }

    // 6. 注入 Builder
    this.builder.reset()
    this.builder.addFragments(trimmedFragments)

    // 7. 应用模板基础数据
    if (template?.baseData) {
      this.builder.setBaseData(template.baseData)
    }

    // 8. 设置会话数据
    this.builder.setSessionData({
      missionId: input.missionId,
      userId: input.userId,
      agentId: input.agentId,
      parentContextId: input.parentContextId,
      tags: input.tags,
    })

    // 9. 构建 ExecutionContext
    const context = this.builder.build(input.missionId)

    // 功能③ 聚焦模式：生成聚焦摘要（系统约束 + goal + domain + taskRefs + 片段精简摘要）
    // ═══ 会话 16i：重构为 4 层装配（RAG-lazy）═══
    //   工作层 working    = goal/身份/domain/taskRefs（永驻保护）
    //   语义层 semantic   = 当前任务片段（system + task fragments，按预算截断）
    //   情境层 episodic   = ContextRetriever 相关性 Top-K（指针 + 蒸馏摘要）替代"最近 N 条全量"
    //   程序层 procedural = 经验规避 + 已应用策略（按预算截断）
    if (focusMode) {
      const budgets = {
        working: 3000, episodic: 1500, semantic: 6000, procedural: 1200,
        ...(this.config.layerBudgets ?? {}),
      }
      const layers = { working: '', semantic: '', episodic: '', procedural: '' }
      // ═══ 会话 16i·v2（用户批评后）：被裁项指针集合（零丢失兜底）═══
      const droppedRefs: string[] = []

      // ── 工作层（永驻，质量锚点，不截断）──
      layers.working = buildWorkingLayer(input)

      // ── 语义层：item 级优先级选择（每项完整，超预算裁整项留指针，不切片）──
      // 优先级：系统约束（user_profile/custom）> 任务状态（mission_state）> goal_graph > artifact_lineage
      const semanticSel = selectLayerItems(buildSemanticItems(trimmedFragments), budgets.semantic, 200)
      layers.semantic = semanticSel.text
      droppedRefs.push(...semanticSel.droppedRefs)

      // ── 情境层：相关性检索 Top-K（指针 + 蒸馏摘要；item 级按相关度选择）──
      if (this.config.retriever) {
        try {
          const relevant = await this.config.retriever.retrieveRelevant(
            input.goal ?? '', input.domain, this.config.recentSummaryLimit ?? 5,
          )
          if (Array.isArray(relevant) && relevant.length > 0) {
            context.recentSummaries = relevant.map(r => ({ taskRef: r.ref, summary: r.summary, archivedAt: Date.now(), source: 'retriever' as const }))
            const epiItems = relevant.map(r => ({ ref: r.ref, priority: Math.max(1, Math.round(r.score * 20)), text: `- [${r.ref}] ${r.summary}` }))
            const epiSel = selectLayerItems(epiItems, budgets.episodic, 120)
            layers.episodic = epiSel.text ? `【相关任务摘要】\n${epiSel.text}` : ''
            droppedRefs.push(...epiSel.droppedRefs)
          }
        } catch (err) {
          console.warn(`[ContextAssemblyEngine] ⚠️ 相关性检索失败（不阻断）: ${(err as Error).message}`)
        }
      } else if (this.config.recentSummaryReader) {
        try {
          const recent = await this.config.recentSummaryReader.loadRecent(this.config.recentSummaryLimit ?? 5)
          if (Array.isArray(recent) && recent.length > 0) {
            context.recentSummaries = recent
            const epiItems = recent.map(r => ({ ref: r.taskRef, priority: 50, text: `- [${r.taskRef}] ${r.summary}` }))
            const epiSel = selectLayerItems(epiItems, budgets.episodic, 120)
            layers.episodic = epiSel.text ? `【相关任务摘要（≤${recent.length} 条）】\n${epiSel.text}` : ''
            droppedRefs.push(...epiSel.droppedRefs)
          }
        } catch (err) {
          console.warn(`[ContextAssemblyEngine] ⚠️ 近期摘要召回失败（不阻断）: ${(err as Error).message}`)
        }
      }

      // ── 程序层：经验规避 + 策略（item 完整，超预算蒸馏）──
      if (this.config.experienceInjector) {
        try {
          const hint = await this.config.experienceInjector.inject(input.goal ?? '', input.domain)
          if (hint) {
            const procSel = selectLayerItems([{ priority: 50, text: hint }], budgets.procedural, 300)
            layers.procedural = procSel.text ? `【经验规避】\n${procSel.text}` : ''
          }
        } catch (err) {
          console.warn(`[ContextAssemblyEngine] ⚠️ 经验注入失败（不阻断）: ${(err as Error).message}`)
        }
      }

      // ── 被裁项指针（零丢失兜底：只保留 ref，不丢详情）──
      if (droppedRefs.length > 0) {
        const refNote = `【可拉取详情】${droppedRefs.join(', ')}（被预算裁剪，按需经工具拉取，未丢失）`
        layers.procedural = layers.procedural ? `${layers.procedural}\n${refNote}` : refNote
      }

      // ── 组装（层序固定：工作 → 语义 → 情境 → 程序）──
      context.focusedSummary = [layers.working, layers.semantic, layers.episodic, layers.procedural]
        .filter(Boolean)
        .join('\n\n')

      // ── 分节遥测（每层字符量，防膨胀可观测）──
      layerSizes.working = layers.working.length
      layerSizes.semantic = layers.semantic.length
      layerSizes.episodic = layers.episodic.length
      layerSizes.procedural = layers.procedural.length

      // ═══ 会话 16h（4GB 根因修复·安全网）：focusedSummary 硬上限 ═══
      // 各层预算已截断，此兜底防极端失控（如 fragment 数据异常）。
      const FOCUSED_SUMMARY_CAP = 50_000 // 50KB
      if (context.focusedSummary && context.focusedSummary.length > FOCUSED_SUMMARY_CAP) {
        console.warn(`[ContextAssemblyEngine] ⚠️ focusedSummary 超上限 ${context.focusedSummary.length} 字符 → 截断到 ${FOCUSED_SUMMARY_CAP}`)
        context.focusedSummary = context.focusedSummary.slice(0, FOCUSED_SUMMARY_CAP)
      }

      // ═══════ 功能③ 遗留项：风险分级 ═══════
      // 默认确定性分级（goal 关键词）；领域可经 config.riskGrader 覆写。
      try {
        const grader = this.config.riskGrader ?? defaultRiskGrader
        context.riskLevel = grader(input.goal ?? '', input.domain)
      } catch (err) {
        console.warn(`[ContextAssemblyEngine] ⚠️ 风险分级器异常（降级 low）: ${(err as Error).message}`)
        context.riskLevel = 'low'
      }
    }

    // 任务 ④：装配层暴露 Provider 归属汇总（source → registered/fallback），供治理/审计消费
    context.providerAttribution = trimmedFragments.map(f => ({
      source: f.source,
      providerType: f.attribution?.providerType ?? 'registered',
      collectedAt: f.collectedAt,
    }))

    // 10. 运行增强流水线（可选）
    let enrichedContext = context
    if (this.config.enableEnrichment) {
      enrichedContext = await this.enricherPipeline.enrich(context)
      // 确保 contextId 不变
      enrichedContext.contextId = context.contextId
    }

    // ═══ 会话 16c（3+4）：装配成本遥测（耗时/片段/字符/信息密度 + 事件）═══
    this.attachAssemblyTelemetry(enrichedContext, trimmedFragments, assembleStart, layerSizes)

    // 11. 版本快照（可选）
    if (this.config.enableVersioning) {
      this.versioner.snapshot(enrichedContext, `Assembly from template "${template?.templateId ?? 'none'}"`)
    }

    // ★ P0: 持久化到 SQLite（如果配置了）——功能③：装配快照透传任务身份 ID（taskRef），
    //    与任务完成快照（EventStore context.snapshot）同索引，召回按 taskRef 统一检索。
    //    持久化实例经构造注入或 setPersistenceProvider 惰性解析（bootstrap 在 EventStore 就绪后
    //    注入 provider，assemble 运行时才解析——时序安全；无 provider/解析失败 → 跳过不阻断）。
    const persistence = this.resolvePersistence()
    if (persistence) {
      try {
        const taskRef = input.currentTask?.goalId ?? input.currentTask?.planId ?? input.currentTask?.taskId
        persistence.save(enrichedContext, undefined, taskRef)
      } catch (err) {
        console.warn('[ContextAssemblyEngine] Persistence save failed:', err)
      }
    }

    // ═══ 去黑盒化（黑盒③）：检索决策留痕（为什么是这些材料）═══
    this.recordRetrievalDecision(input, enrichedContext, trimmedFragments, layerSizes, assembleStart, template?.templateId ?? '')

    // ═══ Model-Visible 宣言：装配输出必须可从持久化点重建；失败抛错（宪法级不变量）═══
    this.assertModelVisibleReconstructable(enrichedContext)

    return enrichedContext
  }

  /**
   * ═══ Model-Visible 宣言（v18 新建）：assembly 输出可重建断言 ═══
   *
   * 凡 focusedSummary 非空（= 确实有模型可见材料）：
   *   ① ContextPersistence 快照（SQLite 持久，优先）
   *   ② 快照未配置/保存失败 → 降级 DeblackboxRecorder 的 context.retrieval 决策单
   *      （由上方 recordRetrievalDecision 刚记录；contentKey 定位 executionId）
   *   ③ 两者都取不回 → 抛 ModelVisibleNotLoggedError（宪法级，不做 WARN 降级）
   * 无 focusedSummary（非 focusMode）→ 无模型可见材料，跳过（不破坏既有流程）。
   */
  private assertModelVisibleReconstructable(context: ExecutionContext): void {
    if (!context.focusedSummary) return
    const persistence = this.resolvePersistence()
    const recorder = getSharedDeblackboxRecorder()
    const executionId = context.missionId ?? 'kernel'

    // ① 持久优先：内容键指向 SQLite 快照（context_id + version 定位，可重建）
    const snapshotEntry = createContextPackageEntry({
      contextId: context.contextId,
      version: context.version,
      executionId,
    })
    if (persistence) {
      const resolved = contextPersistenceResolver(persistence)(snapshotEntry)
      if (resolved.found && resolved.content) return // 已可从持久快照重建 → 断言通过
      // 快照未取回（未配置/保存失败/查询异常属真实存在的降级路径）→ 落 ②
      console.warn(
        `[Model-Visible] ⚠️ 快照未取回（${snapshotEntry.contentKey}）→ 降级 deblackbox 定位`,
      )
    }

    // ② 降级：DeblackboxRecorder 的 context.retrieval 决策单（取不回 → 抛错）
    const fallbackEntry = createDeblackboxEntry({
      category: 'context.retrieval',
      executionId,
    })
    assertModelVisibleLogged(fallbackEntry, deblackboxResolver(recorder))
  }

  /** ═══ 去黑盒化（黑盒③）：检索决策记录（L1 决策单永久）——回答"工作台里为什么是这些材料" */
  private recordRetrievalDecision(
    input: ContextAssemblyInput,
    enrichedContext: ExecutionContext,
    trimmedFragments: Array<{ source: string }>,
    layerSizes: Record<string, number>,
    assembleStart: number,
    templateId: string,
  ): void {
    try {
      // 各源命中数（最终入选的片段按来源汇总）
      const sourceHits: Record<string, number> = {}
      for (const f of trimmedFragments) {
        sourceHits[f.source] = (sourceHits[f.source] ?? 0) + 1
      }
      getSharedDeblackboxRecorder().record({
        category: 'context.retrieval',
        source: 'context-assembly-engine',
        executionId: input.missionId ?? 'kernel',
        level: 'L1',
        summary: {
          goal: input.goal ?? '',
          missionId: input.missionId,
          template: templateId,
          focusMode: this.config.focusMode === true,
          totalCandidates: enrichedContext.fragments?.length ?? trimmedFragments.length,
          selectedFragments: trimmedFragments.length,
          sourceHits,
          layerSizes,
          durationMs: Date.now() - assembleStart,
          domain: input.domain ?? '',
          decision: '装配完成',
          reasoning: '按模板/聚焦模式选定片段并分层入工作台，来源命中数见 sourceHits',
        },
      })
    } catch (err) {
      console.warn('[ContextAssemblyEngine] ⚠️ 检索决策记录失败（忽略）:', err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * ═══ 会话 16c（3+4）：装配成本遥测 ═══
   * 在上下文构建完成、增强前调用：记录耗时/片段数/字符数/信息密度 + 发射 context.assembly.telemetry。
   */
  private attachAssemblyTelemetry(
    context: ExecutionContext,
    trimmedFragments: ContextFragment[],
    assembleStart: number,
    layerSizes?: { working: number; semantic: number; episodic: number; procedural: number },
  ): void {
    if (this.config.enableTelemetry === false || assembleStart === 0) return;
    const durationMs = Date.now() - assembleStart;
    const totalChars = trimmedFragments.reduce((acc, f) => {
      const text = typeof f.data === 'string' ? f.data : JSON.stringify(f.data ?? '');
      return acc + (text?.length ?? 0);
    }, 0);
    const focusedSummaryChars = context.focusedSummary?.length ?? 0;
    // 信息密度 = 聚焦摘要字符 / 原始片段总字符（0-1；高 = 精简有效，低 = 上下文膨胀风险）
    const infoDensity = totalChars > 0 ? Number((focusedSummaryChars / totalChars).toFixed(4)) : 0;
    context.assemblyTelemetry = {
      durationMs,
      fragmentCount: trimmedFragments.length,
      totalChars,
      focusedSummaryChars,
      infoDensity,
      // ═══ 会话 16i：4 层字符量 ═══
      ...(layerSizes ? { layers: layerSizes } : {}),
    };
    // 发射事件（观测聚合端点数据源）
    this.config.eventBus?.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'context.assembly.telemetry',
      timestamp: Date.now(),
      executionId: context.contextId ?? context.missionId,
      source: 'context-assembly-engine',
      payload: {
        missionId: context.missionId,
        durationMs,
        fragmentCount: trimmedFragments.length,
        totalChars,
        focusedSummaryChars,
        infoDensity,
      },
    });
  }

  /**
   * getContext — 获取已构建的上下文（快捷方法）
   *
   * @param contextId - 上下文 ID
   * @returns 最近版本的快照
   */
  getContext(contextId: string): ExecutionContext | undefined {
    const snap = this.versioner.getCurrent(contextId)
    return snap?.context
  }

  /**
   * loadContext — 从持久化存储加载上下文
   */
  loadContext(contextId: string): ExecutionContext | undefined {
    return this.resolvePersistence()?.loadLatest(contextId)
  }

  /**
   * resolvePersistence — 解析当前持久化实例（provider 优先；构造注入兜底）
   *
   * setPersistenceProvider 注入的惰性 provider 在调用时（assemble/loadContext 运行时）
   * 才解析存储——EventStore 初始化时序无关；provider 返回 null/undefined → 视为未配置。
   */
  private resolvePersistence(): ContextPersistence | null | undefined {
    try {
      return this.persistenceProvider ? this.persistenceProvider() : this.persistence
    } catch {
      return this.persistence ?? null
    }
  }

  /**
   * setPersistenceProvider — 注入惰性持久化 provider（bootstrap 用）
   *
   * 覆写构造注入的 persistence：装配快照在 assemble 时经此 provider 解析存储写入
   * （EventStore 的 SQLite db 共享），使 ContextPersistence 在真实装配路径真正落库。
   */
  setPersistenceProvider(provider: (() => ContextPersistence | null | undefined) | null | undefined): void {
    this.persistenceProvider = provider ?? null
  }

  /**
   * getConfig — 获取当前配置
   */
  getConfig(): ContextAssemblyConfig {
    return { ...this.config }
  }

  /**
   * updateConfig — 更新配置
   */
  updateConfig(partial: Partial<ContextAssemblyConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  /**
   * setRecentSummaryReader — 注入近期摘要读取器（功能③ 遗留项：消费端拼接）
   *
   * 供 bootstrap 在归档存储（EventStore/ContextPersistence）就绪后注入；
   * 覆写 config.recentSummaryReader。
   */
  setRecentSummaryReader(reader: RecentSummaryReader | undefined): void {
    this.config.recentSummaryReader = reader
  }

  /**
   * setRetriever — 注入相关性检索器（会话 16i RAG-lazy：情境层语义 Top-K，替代最近 N 全量）
   * 覆写 config.retriever；不注入 → 回退 recentSummaryReader。
   */
  setRetriever(retriever: NonNullable<ContextAssemblyConfig['retriever']> | undefined): void {
    this.config.retriever = retriever
  }

  /**
   * setRiskGrader — 注入自定义风险分级器（覆写 config.riskGrader；缺省用 defaultRiskGrader）
   */
  setRiskGrader(grader: RiskGrader | undefined): void {
    this.config.riskGrader = grader
  }

  /**
   * getRegistry — 获取片段注册中心（用于动态注册提供者）
   */
  getRegistry(): ContextFragmentRegistry {
    return this.registry
  }

  /**
   * getVersioner — 获取版本管理器
   */
  getVersioner(): ContextVersioner {
    return this.versioner
  }

  /**
   * getTemplateRepository — 获取模板仓库
   */
  getTemplateRepository(): ContextTemplateRepository {
    return this.templates
  }

  /**
   * getEnricherPipeline — 获取增强器流水线
   */
  getEnricherPipeline(): ContextEnricherPipeline {
    return this.enricherPipeline
  }

  // ── 内部方法 ──

  /**
   * generateFallbackFragment — 为核心片段生成默认兜底数据
   *
   * 当外部未注册对应 Provider 时，自动创建初始版本的片段。
   * 支持首次使用即自动初始化，消除 "必需片段未采集到" 警告。
   */
  private generateFallbackFragment(
    source: FragmentSource,
    input: ContextAssemblyInput
  ): ContextFragment | null {
    const now = Date.now()

    switch (source) {
      case 'user_profile':
        return {
          source: 'user_profile',
          version: 1,
          collectedAt: now,
          data: {
            id: input.userId || 'default',
            name: 'Default User',
            preferences: {
              responseStyle: 'practical',
              language: 'zh-CN',
            },
            createdAt: now,
            lastActive: now,
          },
        }

      case 'mission_state':
        return {
          source: 'mission_state',
          version: 1,
          collectedAt: now,
          data: {
            id: input.missionId,
            status: 'CREATED',
            currentStage: 'ContextStage',
            createdAt: now,
            input: input.tags ? input.tags.join(', ') : undefined,
          },
        }

      case 'behavior_twin':
        return {
          source: 'behavior_twin',
          version: 1,
          collectedAt: now,
          data: {
            version: 1,
            profile: {
              planningStyle: 'top-down',
              riskTolerance: 'medium',
              executionPreference: 'sequential',
            },
            confidence: 0.5,
          },
        }

      case 'goal_graph':
        return {
          source: 'goal_graph',
          version: 1,
          collectedAt: now,
          data: {
            goals: [],
            activeCount: 0,
          },
        }

      case 'agent_status':
        return {
          source: 'agent_status',
          version: 1,
          collectedAt: now,
          data: {
            agents: [],
            activeCount: 0,
            idleCount: 0,
          },
        }

      case 'decision_history':
        return {
          source: 'decision_history',
          version: 1,
          collectedAt: now,
          data: {
            recentDecisions: [],
            totalCount: 0,
          },
        }

      case 'artifact_lineage':
        return {
          source: 'artifact_lineage',
          version: 1,
          collectedAt: now,
          data: {
            recentArtifacts: [],
            totalCount: 0,
          },
        }

      default:
        return null
    }
  }

  /**
   * selectTemplate — 选择上下文模板
   */
  private selectTemplate(input: ContextAssemblyInput): import('./ContextTemplateRepository.js').ContextTemplate | undefined {
    // 优先使用指定的 templateId
    if (this.config.templateId) {
      const tpl = this.templates.get(this.config.templateId)
      if (tpl) return tpl
    }

    // 按标签匹配
    if (input.tags && input.tags.length > 0) {
      const matched = this.templates.match(input.tags)
      if (matched.length > 0) return matched[0]
    }

    // 兜底：default 模板
    return this.templates.get('default')
  }

  /**
   * collectFragmentsWithTimeout — 收集片段（带超时）
   */
  private async collectFragmentsWithTimeout(
    input: ContextAssemblyInput,
    sources: FragmentSource[]
  ): Promise<ContextFragment[]> {
    const collectPromises = sources.map(async (source) => {
      const provider = this.registry.getProvider(source)
      if (!provider) return null as ContextFragment | null

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error(`Provider "${source}" 超时`)), this.config.fragmentTimeoutMs)
      )

      try {
        const fragment = await Promise.race([
          provider.collect(input),
          timeoutPromise,
        ])
        return fragment
      } catch (err) {
        console.warn(`[ContextAssemblyEngine] 采集片段 "${source}" 失败:`, err)
        return null
      }
    })

    const results = await Promise.all(collectPromises)
    return results.filter((f): f is ContextFragment => f !== null)
  }
}

/**
 * estimateFragmentTokens — 片段 token 估算（功能③ 聚焦模式截断用）
 * 粗略：按 JSON 序列化长度 / 4 估算（与 gate/rules onTokenUsage 同口径）
 */
function estimateFragmentTokens(fragment: ContextFragment): number {
  try {
    const raw = JSON.stringify(fragment.data ?? {})
    return Math.ceil(raw.length / 4)
  } catch {
    return 0
  }
}

/**
 * buildWorkingLayer — 工作层（4 层装配·永驻质量锚点）
 *
 * 内容：当前任务身份（goal/domain/taskRefs）+ 任务身份 ID。
 * 永驻保护（预算截断保底），不随历史增长。
 */
function buildWorkingLayer(input: ContextAssemblyInput): string {
  const lines: string[] = []
  lines.push(`【当前任务】${input.goal ?? input.missionId}`)
  if (input.currentTask) {
    const parts = [
      input.currentTask.goalId && `goal=${input.currentTask.goalId}`,
      input.currentTask.planId && `plan=${input.currentTask.planId}`,
      input.currentTask.taskId && `task=${input.currentTask.taskId}`,
    ].filter(Boolean)
    if (parts.length) lines.push(`【任务身份】${parts.join(' / ')}`)
  }
  if (input.domain) lines.push(`【领域】${input.domain}`)
  if (input.taskRefs && input.taskRefs.length > 0) {
    lines.push(`【必需知识引用】${input.taskRefs.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * buildSemanticItems — 语义层 item 集（4 层装配·当前任务材料）
 *
 * 每片段 = 一个完整 item（可被单独选择/裁剪），带优先级：
 *   系统约束（user_profile/custom）100 > 任务状态（mission_state）80 > goal_graph 70 > artifact_lineage 60
 * 片段内容 ≤200 字符（片段级防膨胀）。
 */
function buildSemanticItems(fragments: ContextFragment[]): Array<{ ref?: string; priority: number; text: string }> {
  const PRIORITY: Record<string, number> = {
    user_profile: 100, custom: 100, mission_state: 80, goal_graph: 70, artifact_lineage: 60,
  }
  return fragments.map(f => {
    let text = ''
    try {
      const data = JSON.stringify(f.data ?? {})
      text = data.length > 200 ? `${data.slice(0, 200)}…` : data
    } catch {
      text = '{}'
    }
    const ref = f.taskRef ? `（归属:${f.taskRef}）` : ''
    return { ref: f.taskRef ?? undefined, priority: PRIORITY[f.source] ?? 50, text: `【${f.source}】${ref}${text}` }
  })
}

/**
 * selectLayerItems — 预算内 item 级选择（v2，用户批评后替代字符切片）
 *
 * 原则：**宁可少装但每项完整，绝不让每项被切一半**。
 *   1. 按优先级降序（高优先先装）
 *   2. 逐项装完整文本，直到预算用尽
 *   3. 单项超 maxItemLen → 蒸馏（截短保留开头，仍完整可读）
 *   4. 装不下的项 → 裁整项，ref 收集进 droppedRefs（由装配层拼【可拉取详情】指针，零丢失）
 *
 * @returns kept 完整文本 + 被裁项的 ref 列表
 */
function selectLayerItems(
  items: Array<{ ref?: string; priority: number; text: string }>,
  budget: number,
  maxItemLen = Infinity,
): { text: string; droppedRefs: string[] } {
  const ordered = [...items].sort((a, b) => b.priority - a.priority)
  const kept: string[] = []
  const droppedRefs: string[] = []
  let used = 0
  for (const item of ordered) {
    let t = item.text
    if (t.length > maxItemLen) t = `${t.slice(0, maxItemLen)}…`
    const add = used === 0 ? t.length : t.length + 1
    if (used + add <= budget) {
      kept.push(t)
      used += add
    } else if (item.ref) {
      droppedRefs.push(item.ref)
    }
  }
  return { text: kept.join('\n'), droppedRefs }
}
