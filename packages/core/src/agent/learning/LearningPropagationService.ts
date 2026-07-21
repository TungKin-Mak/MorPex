/**
 * LearningPropagationService — 学习传播服务
 *
 * 控制经验的可见性与传播范围。
 * 支持按 Agent 类型传播、匿名化。
 */

import type { GeneralizedExperience } from './types.js'

export class LearningPropagationService {
  private propagationLog: { expId: string; targetTypes: string[]; timestamp: number }[] = []

  /**
   * propagate — 将经验传播到指定的 Agent 类型
   */
  propagate(experience: GeneralizedExperience, agentTypes: string[]): void {
    experience.visibleTo = [...new Set([...experience.visibleTo, ...agentTypes])]
    this.propagationLog.push({
      expId: experience.id,
      targetTypes: [...agentTypes],
      timestamp: Date.now(),
    })
  }

  /**
   * propagateToAll — 传播到所有 Agent 类型
   */
  propagateToAll(experience: GeneralizedExperience): void {
    experience.visibleTo = ['*']
    this.propagationLog.push({
      expId: experience.id,
      targetTypes: ['*'],
      timestamp: Date.now(),
    })
  }

  /**
   * checkAccess — 检查 Agent 类型是否有权访问该经验
   */
  checkAccess(experience: GeneralizedExperience, agentType: string): boolean {
    if (experience.visibleTo.includes('*')) return true
    return experience.visibleTo.includes(agentType)
  }

  /**
   * anonymize — 匿名化经验（移除来源标识）
   *
   * 将 sourceAgentType 替换为 'anonymous'，并清空 sourceMissionIds。
   */
  anonymize(experience: GeneralizedExperience): GeneralizedExperience {
    return {
      ...experience,
      sourceAgentType: 'anonymous',
      sourceMissionIds: [],
    }
  }

  /**
   * getPropagationLog — 获取传播日志
   */
  getPropagationLog(): { expId: string; targetTypes: string[]; timestamp: number }[] {
    return [...this.propagationLog]
  }

  /**
   * getStats — 获取传播统计
   */
  getStats(): { totalPropagations: number; uniqueExperiences: number } {
    const uniqueExps = new Set(this.propagationLog.map(p => p.expId))
    return {
      totalPropagations: this.propagationLog.length,
      uniqueExperiences: uniqueExps.size,
    }
  }
}
