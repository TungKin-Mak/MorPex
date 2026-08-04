/**
 * ContextBuilder — 上下文构建器
 *
 * v9.1 Context Assembly Layer: 将多个上下文片段组装为统一的分层 ExecutionContext。
 *
 * 三层结构：
 *   - base: 基础层（不变的会话常量，如 schemaVersion、用户身份）
 *   - session: 会话层（当前会话数据，如 missionId、当前意图）
 *   - ephemeral: 临时层（瞬态计算结果，如风险评分、推荐）
 */

import type { ContextFragment } from './ContextFragmentRegistry.js'

// ── 上下文层类型 ──

export type ContextLayer = 'base' | 'session' | 'ephemeral'

// ── 近期摘要消费端 + 风险分级类型（功能③ 遗留项；装配层消费端拼接）──

/** 风险等级（确定性分级：goal 关键词命中；可选自定义分级器覆写） */
export type RiskLevel = 'low' | 'medium' | 'high'

/** 近期任务摘要（消费端拼接产物：抽离侧已归档，装配侧召回 ≤N 条注入工作上下文） */
export interface RecentSummary {
  /** 任务归属 ID（goalId/planId/taskId） */
  taskRef: string
  /** 任务摘要文本 */
  summary: string
  /** 关键引用 ID（可选） */
  keyRefs?: string[]
  /** 归档时间戳 */
  archivedAt: number
  /** 来源存储：EventStore 权威快照 / ContextPersistence 装配快照 */
  source: 'event-store' | 'persistence'
}

/** 近期摘要读取器（装配引擎消费端；实现方聚合 EventStore + ContextPersistence） */
export interface RecentSummaryReader {
  loadRecent(limit: number): Promise<RecentSummary[]>
}

/** 风险分级器（输入 goal + domain，输出风险等级；默认 defaultRiskGrader 确定性关键词分级） */
export type RiskGrader = (goal: string, departmentId?: string) => RiskLevel

// ── ExecutionContext — 统一执行上下文 ──

export interface ExecutionContext {
  /** 上下文唯一 ID */
  contextId: string
  /** 版本号（从 1 开始，每次重建递增） */
  version: number
  /** 关联 Mission ID */
  missionId: string
  /** 三层数据 */
  layers: Record<ContextLayer, Record<string, unknown>>
  /** 功能③：聚焦摘要（聚焦模式产物：系统约束 + goal + domain + taskRefs + 片段精简摘要） */
  focusedSummary?: string
  /** 使用的片段列表 */
  fragments: ContextFragment[]
  /**
   * Provider 归属汇总（任务 ④）：每个片段来源的提供者类型（registered=真实 Provider / fallback=默认兜底）。
   * 装配层暴露来源归属，消费端可据信任分级处理（真实数据优先，占位数据标注）。
   */
  providerAttribution?: Array<{ source: string; providerType: 'registered' | 'fallback'; collectedAt: number }>
  /** 功能③ 遗留项：近期任务摘要（消费端拼接，≤N 条；装配时从归档存储召回注入） */
  recentSummaries?: RecentSummary[]
  /** 功能③ 遗留项：风险分级（low/medium/high；默认确定性分级，可自定义覆写） */
  riskLevel?: RiskLevel
  /** 组装时间 */
  assembledAt: number
  /** 过期时间（可选） */
  expiresAt?: number
  /** Schema 版本 */
  schemaVersion: string
}

// ── ContextBuilder — 构建器 ──

export class ContextBuilder {
  private fragments: ContextFragment[] = []
  private baseData: Record<string, unknown> = {}
  private sessionData: Record<string, unknown> = {}
  private ephemeralData: Record<string, unknown> = {}
  private versionCounter = 0
  private lastContextId = ''

  /**
   * addFragment — 添加上下文片段
   */
  addFragment(fragment: ContextFragment): this {
    this.fragments.push(fragment)
    return this
  }

  /**
   * addFragments — 批量添加上下文片段
   */
  addFragments(fragments: ContextFragment[]): this {
    this.fragments.push(...fragments)
    return this
  }

  /**
   * setBaseData — 设置基础层数据
   */
  setBaseData(data: Record<string, unknown>): this {
    this.baseData = { ...data }
    return this
  }

  /**
   * setSessionData — 设置会话层数据
   */
  setSessionData(data: Record<string, unknown>): this {
    this.sessionData = { ...data }
    return this
  }

  /**
   * setEphemeralData — 设置临时层数据
   */
  setEphemeralData(data: Record<string, unknown>): this {
    this.ephemeralData = { ...data }
    return this
  }

  /**
   * build — 构建 ExecutionContext
   *
   * 生成唯一 contextId，递增版本号。
   * 调用后可通过 reset() 重置状态。
   *
   * @param missionId - 关联的任务 ID
   * @returns 完整的 ExecutionContext
   */
  build(missionId: string): ExecutionContext {
    this.versionCounter++
    const now = Date.now()
    const contextId = this.generateContextId(missionId, now)

    this.lastContextId = contextId

    const ctx: ExecutionContext = {
      contextId,
      version: this.versionCounter,
      missionId,
      layers: {
        base: { ...this.baseData },
        session: { ...this.sessionData },
        ephemeral: { ...this.ephemeralData },
      },
      fragments: [...this.fragments],
      assembledAt: now,
      schemaVersion: '1.0',
    }

    // 如果有 baseData.fragment 或 sessionData 中有 source 字段，计算过期时间
    if (this.fragments.some(f => f.ttl != null)) {
      const maxTtl = Math.max(
        ...this.fragments.filter(f => f.ttl != null).map(f => f.ttl!)
      )
      ctx.expiresAt = now + maxTtl
    }

    return ctx
  }

  /**
   * reset — 重置构建器状态（保留版本计数器）
   */
  reset(): void {
    this.fragments = []
    this.baseData = {}
    this.sessionData = {}
    this.ephemeralData = {}
  }

  /**
   * getCurrentVersion — 获取当前版本号
   */
  getCurrentVersion(): number {
    return this.versionCounter
  }

  /**
   * getLastContextId — 获取最后一次构建的 contextId
   */
  getLastContextId(): string {
    return this.lastContextId
  }

  // ── 内部方法 ──

  /**
   * generateContextId — 生成确定性 contextId
   *
   * 格式: ctx_{missionId}_{timestamp}_{shortHash}
   * shortHash 取 missionId + timestamp 的简单哈希后 8 位
   */
  private generateContextId(missionId: string, timestamp: number): string {
    const hash = this.simpleHash(`${missionId}_${timestamp}`)
    return `ctx_${missionId}_${timestamp}_${hash}`
  }

  /**
   * simpleHash — 简单的字符串哈希（djb2 变体）
   */
  private simpleHash(str: string): string {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    }
    return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8)
  }
}
