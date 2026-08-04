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
  async assemble(input: ContextAssemblyInput): Promise<ExecutionContext> {
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
    if (focusMode) {
      context.focusedSummary = buildFocusedSummary(input, trimmedFragments)

      // ═══════ 功能③ 遗留项：近期摘要消费端拼接 ═══════
      // 设计哲学：工作上下文 = 系统约束 + Goal/Plan/Task + ontologyRefs + ≤N 条近期摘要。
      // 抽离侧（Mission 完成 → EventStore context.snapshot / ContextPersistence 装配快照）已归档，
      // 装配侧在此召回 ≤N 条最近任务摘要注入工作上下文（reader 异常/空 → 不阻断不注入）。
      if (this.config.recentSummaryReader) {
        try {
          const recent = await this.config.recentSummaryReader.loadRecent(this.config.recentSummaryLimit ?? 5)
          if (Array.isArray(recent) && recent.length > 0) {
            context.recentSummaries = recent
            const lines = recent.map(r => `- [${r.taskRef}] ${r.summary}`)
            context.focusedSummary = `${context.focusedSummary ?? ''}\n\n【近期任务摘要（≤${recent.length} 条）】\n${lines.join('\n')}`.trim()
          }
        } catch (err) {
          console.warn(`[ContextAssemblyEngine] ⚠️ 近期摘要召回失败（不阻断）: ${(err as Error).message}`)
        }
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

    return enrichedContext
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
 * buildFocusedSummary — 生成聚焦摘要（功能③ 聚焦模式产物）
 *
 * 内容：系统级材料（用户画像/既定规则/系统约束）+ 当前任务身份（goal/domain/taskRefs）
 *      + 已收集片段精简摘要（任务级片段标注归属）。
 * 不含历史对话/中间推理（原则①聚焦；历史抽离需则召回）。
 */
function buildFocusedSummary(input: ContextAssemblyInput, fragments: ContextFragment[]): string {
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
  for (const f of fragments) {
    try {
      const data = JSON.stringify(f.data ?? {})
      const snippet = data.length > 200 ? `${data.slice(0, 200)}…` : data
      const ref = f.taskRef ? `（归属:${f.taskRef}）` : ''
      lines.push(`【${f.source}】${ref}${snippet}`)
    } catch {
      // 片段序列化失败 → 跳过该片段摘要（不阻断）
    }
  }
  return lines.join('\n')
}
