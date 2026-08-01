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
import { ContextFragmentRegistry } from './ContextFragmentRegistry.js'
import type { ExecutionContext } from './ContextBuilder.js'
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
}

const DEFAULT_CONFIG: ContextAssemblyConfig = {
  enableVersioning: true,
  enableEnrichment: true,
  maxFragments: 50,
  fragmentTimeoutMs: 5000,
  schemaVersion: '1.0',
}

// ── ContextAssemblyEngine — 核心引擎 ──

export class ContextAssemblyEngine {
  private registry: ContextFragmentRegistry
  private builder: ContextBuilder
  private versioner: ContextVersioner
  private templates: ContextTemplateRepository
  private enricherPipeline: ContextEnricherPipeline
  private config: ContextAssemblyConfig

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

    // 2. 决定采集哪些片段来源
    const requiredSources = template?.requiredFragments ?? []
    const optionalSources = template?.optionalFragments ?? []
    const allSources = [...new Set([...requiredSources, ...optionalSources])] as FragmentSource[]

    // 3. 从注册中心收集片段（带超时）
    const fragments = await this.collectFragmentsWithTimeout(input, allSources)

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

    // 5. 限制片段数量
    const trimmedFragments = fragments.slice(0, this.config.maxFragments)

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

    // ★ P0: 持久化到 SQLite（如果配置了）
    if (this.persistence) {
      try {
        this.persistence.save(enrichedContext)
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
    return this.persistence?.loadLatest(contextId)
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
