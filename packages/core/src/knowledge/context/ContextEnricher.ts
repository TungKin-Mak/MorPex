/**
 * ContextEnricher — 上下文增强器
 *
 * v9.1 Context Assembly Layer: 插件式扩展，在上下文组装后添加计算字段。
 *
 * 增强器示例：
 *   - RiskScorer: 基于上下文内容计算风险评分
 *   - CapabilityMatcher: 匹配可用 Agent 能力
 *   - CollaboratorSuggestor: 建议协作 Agent
 *   - PriorityCalculator: 计算任务优先级
 */

import type { ExecutionContext } from './ContextBuilder.js'

// ── ContextEnricher — 增强器接口 ──

export interface ContextEnricher {
  /** 增强器名称 */
  readonly name: string
  /** 优先级（数值越小越先执行） */
  readonly priority: number
  /** 增强方法 */
  enrich(context: ExecutionContext): Promise<ExecutionContext>
}

// ── ContextEnricherPipeline — 增强器流水线 ──

export class ContextEnricherPipeline {
  private enrichers: ContextEnricher[] = []

  /**
   * register — 注册增强器
   *
   * 按 priority 排序插入。
   */
  register(enricher: ContextEnricher): void {
    this.enrichers.push(enricher)
    this.enrichers.sort((a, b) => a.priority - b.priority)
  }

  /**
   * unregister — 注销增强器
   *
   * @param name - 增强器名称
   * @returns 是否存在并注销
   */
  unregister(name: string): boolean {
    const index = this.enrichers.findIndex(e => e.name === name)
    if (index === -1) return false
    this.enrichers.splice(index, 1)
    return true
  }

  /**
   * enrich — 按优先级顺序执行所有增强器
   *
   * 每个增强器接收上一个增强器的输出。
   * 单个增强器失败不影响后续增强器。
   *
   * @param context - 原始 ExecutionContext
   * @returns 增强后的 ExecutionContext
   */
  async enrich(context: ExecutionContext): Promise<ExecutionContext> {
    let current = context

    for (const enricher of this.enrichers) {
      try {
        current = await enricher.enrich(current)
      } catch (err) {
        console.warn(`[ContextEnricherPipeline] Enricher "${enricher.name}" 失败:`, err)
      }
    }

    return current
  }

  /**
   * listEnrichers — 列出所有已注册增强器
   */
  listEnrichers(): ReadonlyArray<ContextEnricher> {
    return [...this.enrichers]
  }

  /**
   * count — 增强器数量
   */
  count(): number {
    return this.enrichers.length
  }

  /**
   * clear — 清空所有增强器
   */
  clear(): void {
    this.enrichers = []
  }
}
