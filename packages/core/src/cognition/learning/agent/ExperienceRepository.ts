/**
 * ExperienceRepository — 经验仓库
 *
 * 存储、查询、管理 GeneralizedExperience。
 * 支持按类别/标签/权重过滤，按权重排序。
 */

import type { GeneralizedExperience, ExperienceQuery } from './types.js'

export class ExperienceRepository {
  private _store = new Map<string, GeneralizedExperience>()

  /**
   * store — 存储一条经验
   */
  store(exp: GeneralizedExperience): void {
    this._store.set(exp.id, { ...exp })
  }

  /**
   * query — 按条件查询经验
   *
   * 支持按 category / tags / minWeight 过滤，按 weight 降序排列。
   */
  query(q: ExperienceQuery): GeneralizedExperience[] {
    let results = [...this._store.values()]

    if (q.category) {
      results = results.filter(e => e.category === q.category)
    }
    if (q.tags && q.tags.length > 0) {
      results = results.filter(e => q.tags!.some(t => e.tags.includes(t)))
    }
    if (q.minWeight !== undefined) {
      results = results.filter(e => e.feedback.weight >= q.minWeight!)
    }

    results.sort((a, b) => b.feedback.weight - a.feedback.weight)

    if (q.limit && q.limit > 0) {
      results = results.slice(0, q.limit)
    }

    return results
  }

  /**
   * get — 按 ID 获取经验
   */
  get(id: string): GeneralizedExperience | undefined {
    return this._store.get(id)
  }

  /**
   * getBySourceAgentType — 按来源 Agent 类型获取经验
   */
  getBySourceAgentType(type: string): GeneralizedExperience[] {
    return [...this._store.values()].filter(e => e.sourceAgentType === type)
  }

  /**
   * recordFeedback — 记录反馈，重新计算权重
   *
   * 权重公式: weight = (positive - negative * 0.5) / (positive + negative + 1)
   */
  recordFeedback(id: string, positive: boolean): void {
    const exp = this._store.get(id)
    if (!exp) return

    if (positive) {
      exp.feedback.positive++
    } else {
      exp.feedback.negative++
    }

    const { positive: p, negative: n } = exp.feedback
    exp.feedback.weight = Math.max(0, Math.min(1, (p - n * 0.5) / (p + n + 1)))
    exp.lastValidatedAt = Date.now()
  }

  /**
   * cleanupExpired — 清理超过指定时间的经验
   */
  cleanupExpired(maxAgeMs: number): number {
    const now = Date.now()
    let cleaned = 0
    for (const [id, exp] of this._store) {
      if (now - exp.lastValidatedAt > maxAgeMs) {
        this._store.delete(id)
        cleaned++
      }
    }
    return cleaned
  }

  /**
   * getStats — 获取仓库统计
   */
  getStats(): { total: number; byCategory: Record<string, number>; avgWeight: number } {
    const byCategory: Record<string, number> = {}
    let totalWeight = 0

    for (const exp of this._store.values()) {
      byCategory[exp.category] = (byCategory[exp.category] || 0) + 1
      totalWeight += exp.feedback.weight
    }

    return {
      total: this._store.size,
      byCategory,
      avgWeight: this._store.size > 0 ? totalWeight / this._store.size : 0,
    }
  }

  /**
   * toJSON — 导出所有经验
   */
  toJSON(): GeneralizedExperience[] {
    return [...this._store.values()]
  }

  /**
   * fromJSON — 导入经验
   */
  fromJSON(data: GeneralizedExperience[]): void {
    for (const exp of data) {
      this._store.set(exp.id, exp)
    }
  }
}
