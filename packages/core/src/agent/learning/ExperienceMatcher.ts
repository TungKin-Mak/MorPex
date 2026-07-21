/**
 * ExperienceMatcher — 经验匹配器
 *
 * 根据问题描述从仓库中检索最相关的经验。
 * 使用标签匹配 + 关键词 Jaccard 相似度 + 可见性过滤。
 */

import type { GeneralizedExperience } from './types.js'
import { ExperienceRepository } from './ExperienceRepository.js'

export class ExperienceMatcher {
  /**
   * match — 匹配与问题最相关的经验
   *
   * 流程:
   *   1. 将问题 tokenize 为关键词
   *   2. 从仓库中筛选匹配标签或 problemPattern 的经验
   *   3. 过滤可见性（agentType）
   *   4. 按 matchScore × weight 排序
   *   5. 返回 Top N
   */
  match(
    problem: string,
    repository: ExperienceRepository,
    agentType: string,
    limit: number = 5
  ): GeneralizedExperience[] {
    const tokens = this.tokenize(problem)
    const all = repository.query({}) // 获取所有

    const scored = all
      .filter(exp => this.isAccessible(exp, agentType))
      .map(exp => ({
        exp,
        score: this.computeMatchScore(tokens, exp),
      }))
      .filter(item => item.score > 0)

    // 按 matchScore × weight 降序
    scored.sort((a, b) => (b.score * b.exp.feedback.weight) - (a.score * a.exp.feedback.weight))

    return scored.slice(0, limit).map(item => item.exp)
  }

  /**
   * matchScore — 计算问题与经验的匹配分数 (0-1)
   *
   * 基于 Jaccard 相似的 token 匹配。
   */
  matchScore(query: string, experience: GeneralizedExperience): number {
    const queryTokens = this.tokenize(query)
    const expTokens = this.tokenize(experience.problemPattern)
    return this.jaccardSimilarity(queryTokens, expTokens)
  }

  // ── 内部方法 ──

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2) // 忽略短词
  }

  private jaccardSimilarity(a: string[], b: string[]): number {
    const setA = new Set(a)
    const setB = new Set(b)
    const intersection = new Set([...setA].filter(x => setB.has(x)))
    const union = new Set([...setA, ...setB])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  private computeMatchScore(tokens: string[], exp: GeneralizedExperience): number {
    // 标签匹配分 (0-0.5)
    const tagMatch = exp.tags.length > 0
      ? tokens.filter(t => exp.tags.some(tag => tag.includes(t))).length / tokens.length * 0.5
      : 0

    // 问题模式文本匹配分 (0-0.5)
    const textMatch = this.jaccardSimilarity(tokens, this.tokenize(exp.problemPattern)) * 0.5

    return tagMatch + textMatch
  }

  private isAccessible(exp: GeneralizedExperience, agentType: string): boolean {
    if (exp.visibleTo.includes('*')) return true
    return exp.visibleTo.includes(agentType)
  }
}
