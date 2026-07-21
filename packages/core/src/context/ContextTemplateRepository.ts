/**
 * ContextTemplateRepository — 上下文模板仓库
 *
 * v9.1 Context Assembly Layer: 预定义的上下文模板，用于快速匹配任务类型。
 *
 * 每个模板定义：
 *   - 需要哪些片段来源（requiredFragments）
 *   - 可选哪些片段来源（optionalFragments）
 *   - 默认基础层数据（baseData）
 *   - JSON Schema（可选，用于校验完整性）
 *   - 标签（用于按场景匹配）
 */

import type { FragmentSource } from './ContextFragmentRegistry.js'

// ── ContextTemplate — 上下文模板 ──

export interface ContextTemplate {
  /** 模板 ID */
  templateId: string
  /** 模板名称 */
  name: string
  /** 描述 */
  description: string
  /** 必需的片段来源（必须全部成功采集） */
  requiredFragments: FragmentSource[]
  /** 可选的片段来源（失败不影响） */
  optionalFragments: FragmentSource[]
  /** 默认基础层数据 */
  baseData: Record<string, unknown>
  /** JSON Schema（可选，用于校验上下文完整性） */
  schema?: Record<string, unknown>
  /** 标签，用于场景匹配 */
  tags: string[]
}

// ── 预定义模板 ──

const DEFAULT_TEMPLATE: ContextTemplate = {
  templateId: 'default',
  name: '默认模板',
  description: '通用上下文，包含所有常见片段来源',
  requiredFragments: ['user_profile', 'mission_state'],
  optionalFragments: ['behavior_twin', 'goal_graph', 'decision_history', 'artifact_lineage', 'agent_status'],
  baseData: {
    source: 'cognitive_pipeline',
    priority: 'normal',
  },
  tags: ['general', 'default'],
}

const QUICK_TASK_TEMPLATE: ContextTemplate = {
  templateId: 'quick-task',
  name: '快速任务模板',
  description: '轻量上下文，仅包含最小必需片段',
  requiredFragments: ['mission_state'],
  optionalFragments: ['user_profile'],
  baseData: {
    source: 'cognitive_pipeline',
    priority: 'quick',
    skipEnrichment: true,
  },
  tags: ['quick', 'lightweight'],
}

const DEEP_RESEARCH_TEMPLATE: ContextTemplate = {
  templateId: 'deep-research',
  name: '深度研究模板',
  description: '完整上下文，包含所有历史数据和血缘信息',
  requiredFragments: ['user_profile', 'behavior_twin', 'goal_graph', 'mission_state'],
  optionalFragments: ['decision_history', 'artifact_lineage', 'agent_status'],
  baseData: {
    source: 'cognitive_pipeline',
    priority: 'research',
    deepAnalysis: true,
  },
  tags: ['research', 'deep', 'analysis'],
}

// ── ContextTemplateRepository ──

export class ContextTemplateRepository {
  private templates = new Map<string, ContextTemplate>()

  constructor() {
    // 注册预定义模板
    this.register(DEFAULT_TEMPLATE)
    this.register(QUICK_TASK_TEMPLATE)
    this.register(DEEP_RESEARCH_TEMPLATE)
  }

  /**
   * register — 注册模板
   */
  register(template: ContextTemplate): void {
    this.templates.set(template.templateId, template)
  }

  /**
   * get — 获取模板
   */
  get(templateId: string): ContextTemplate | undefined {
    return this.templates.get(templateId)
  }

  /**
   * remove — 移除模板
   *
   * @returns 是否存在并移除
   */
  remove(templateId: string): boolean {
    return this.templates.delete(templateId)
  }

  /**
   * match — 根据标签匹配模板
   *
   * 按匹配标签数量排序（最多匹配优先）。
   * 若无任何匹配，返回 [default]。
   *
   * @param tags - 输入标签
   * @returns 按匹配度降序排列的模板列表
   */
  match(tags: string[]): ContextTemplate[] {
    if (tags.length === 0) {
      const def = this.templates.get('default')
      return def ? [def] : []
    }

    const scored: Array<{ template: ContextTemplate; score: number }> = []
    for (const template of this.templates.values()) {
      const matchCount = template.tags.filter(t => tags.includes(t)).length
      if (matchCount > 0) {
        scored.push({ template, score: matchCount })
      }
    }

    scored.sort((a, b) => b.score - a.score)

    // 如果有匹配，返回匹配结果；否则返回 default
    if (scored.length > 0) {
      return scored.map(s => s.template)
    }

    const def = this.templates.get('default')
    return def ? [def] : []
  }

  /**
   * listAll — 列出所有模板
   */
  listAll(): ContextTemplate[] {
    return [...this.templates.values()]
  }

  /**
   * count — 模板数量
   */
  count(): number {
    return this.templates.size
  }

  /**
   * clear — 清空所有模板（仅用于测试）
   */
  clear(): void {
    this.templates.clear()
  }
}
