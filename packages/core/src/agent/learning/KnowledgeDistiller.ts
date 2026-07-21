/**
 * KnowledgeDistiller — 知识提炼器
 *
 * 从 DecisionEvent、Mission 结果、协作结果中提取泛化经验。
 * 支持合并相似经验（相同 problemPattern）。
 */

import type { GeneralizedExperience, ExperienceCategory } from './types.js'

export class KnowledgeDistiller {
  private counter = 0

  /**
   * distillFromDecision — 从决策事件中提炼经验
   *
   * 将 decisionEvent 中的 reasoning + decision 映射为 problem→solution 模式。
   */
  distillFromDecision(decisionEvent: any): GeneralizedExperience[] {
    if (!decisionEvent || !decisionEvent.reasoning || !decisionEvent.decision) {
      console.log(`   [KnowledgeDistiller] distillFromDecision: 跳过 (无 reasoning/decision)`)
      return []
    }

    const experiences: GeneralizedExperience[] = []

    // 从 reasoning 中提取问题模式
    const problemPattern = this.extractProblemPattern(decisionEvent.reasoning)
    if (!problemPattern) return []

    const exp: GeneralizedExperience = {
      id: `exp_decision_${Date.now()}_${++this.counter}`,
      category: this.inferCategory(decisionEvent),
      problemPattern,
      solution: decisionEvent.decision,
      effectiveness: {
        successRate: decisionEvent.confidence || 0.5,
        avgLatency: 0,
        costSavings: 0,
      },
      sourceAgentType: decisionEvent.source || 'unknown',
      sourceMissionIds: decisionEvent.missionId ? [decisionEvent.missionId] : [],
      feedback: { positive: 0, negative: 0, weight: 0.5 },
      createdAt: Date.now(),
      lastValidatedAt: Date.now(),
      tags: this.extractTags(decisionEvent),
      visibleTo: ['*'],
    }

    experiences.push(exp)
    console.log(`   [KnowledgeDistiller] distillFromDecision → 1 条经验 (category: ${exp.category}, confidence: ${exp.effectiveness.successRate})`)
    return experiences
  }

  /**
   * distillFromMission — 从 Mission 结果中提炼经验
   */
  distillFromMission(missionResult: any, twinVersion: number): GeneralizedExperience[] {
    if (!missionResult) return []

    const experiences: GeneralizedExperience[] = []
    const success = missionResult.success ?? true
    const errors = missionResult.errors || []

    if (errors.length > 0) {
      const exp: GeneralizedExperience = {
        id: `exp_mission_${Date.now()}_${++this.counter}`,
        category: 'error_handling',
        problemPattern: `Mission failed with errors: ${errors.slice(0, 3).join('; ')}`,
        solution: success ? 'Recovered automatically' : 'Requires manual intervention',
        effectiveness: {
          successRate: success ? 0.8 : 0.2,
          avgLatency: missionResult.duration || 0,
          costSavings: 0,
        },
        sourceAgentType: missionResult.agentType || 'unknown',
        sourceMissionIds: missionResult.missionId ? [missionResult.missionId] : [],
        feedback: { positive: 0, negative: 0, weight: 0.3 },
        createdAt: Date.now(),
        lastValidatedAt: Date.now(),
        tags: ['error', 'mission'],
        visibleTo: ['*'],
      }
      experiences.push(exp)
    }

    return experiences
  }

  /**
   * distillFromCollaboration — 从协作结果中提炼经验
   */
  distillFromCollaboration(collabResult: any): GeneralizedExperience[] {
    if (!collabResult) return []

    const experiences: GeneralizedExperience[] = []
    const success = collabResult.success ?? true
    const failedTasks = collabResult.failedTasks || []

    if (failedTasks.length > 0) {
      const failedReasons = failedTasks.map((t: any) => t.error).join('; ')
      const exp: GeneralizedExperience = {
        id: `exp_collab_${Date.now()}_${++this.counter}`,
        category: 'collaboration',
        problemPattern: `Collaboration failure: ${failedReasons}`,
        solution: success ? 'Fallback handled' : 'Requires coordination improvement',
        effectiveness: {
          successRate: success ? 0.7 : 0.3,
          avgLatency: collabResult.totalDuration || 0,
          costSavings: 0,
        },
        sourceAgentType: 'collaboration',
        sourceMissionIds: collabResult.missionId ? [collabResult.missionId] : [],
        feedback: { positive: 0, negative: 0, weight: 0.4 },
        createdAt: Date.now(),
        lastValidatedAt: Date.now(),
        tags: ['collaboration', 'failure'],
        visibleTo: ['*'],
      }
      experiences.push(exp)
    }

    return experiences
  }

  /**
   * mergeDuplicate — 合并相似经验（按 problemPattern 子串匹配）
   *
   * 将具有相似 problemPattern 的经验合并，平均 effectiveness，合并 sourceMissionIds。
   */
  mergeDuplicate(experiences: GeneralizedExperience[]): GeneralizedExperience[] {
    const inputCount = experiences.length
    const merged = this.doMerge(experiences)
    if (inputCount > merged.length) {
      console.log(`   [KnowledgeDistiller] mergeDuplicate: ${inputCount} → ${merged.length} (合并了 ${inputCount - merged.length} 条相似经验)`)
    }
    return merged
  }

  private doMerge(experiences: GeneralizedExperience[]): GeneralizedExperience[] {
    const merged: GeneralizedExperience[] = []
    const used = new Set<number>()

    for (let i = 0; i < experiences.length; i++) {
      if (used.has(i)) continue
      const group: GeneralizedExperience[] = [experiences[i]]
      used.add(i)

      for (let j = i + 1; j < experiences.length; j++) {
        if (used.has(j)) continue
        if (this.isSimilarPattern(experiences[i].problemPattern, experiences[j].problemPattern)) {
          group.push(experiences[j])
          used.add(j)
        }
      }

      if (group.length === 1) {
        merged.push(group[0])
      } else {
        merged.push(this.mergeGroup(group))
      }
    }

    return merged
  }

  // ── 内部方法 ──

  private extractProblemPattern(reasoning: string): string {
    if (!reasoning || reasoning.length < 10) return ''
    // 截取前 200 字符作为问题模式摘要
    return reasoning.slice(0, 200).replace(/\s+/g, ' ').trim()
  }

  private inferCategory(event: any): ExperienceCategory {
    const type = (event.type || '').toLowerCase()
    if (type.includes('collab') || type.includes('negotiat')) return 'collaboration'
    if (type.includes('error') || type.includes('fail')) return 'error_handling'
    if (type.includes('optim')) return 'optimization'
    if (type.includes('comm') || type.includes('message')) return 'communication'
    return 'task_execution'
  }

  private extractTags(event: any): string[] {
    const tags: string[] = []
    const type = (event.type || '').toLowerCase()
    if (type.includes('mission')) tags.push('mission')
    if (type.includes('agent')) tags.push('agent')
    if (type.includes('tool')) tags.push('tool')
    if (tags.length === 0) tags.push('general')
    return tags
  }

  private isSimilarPattern(a: string, b: string): boolean {
    const shorter = a.length < b.length ? a : b
    const longer = a.length < b.length ? b : a
    return longer.includes(shorter) || shorter.includes(longer)
  }

  private mergeGroup(group: GeneralizedExperience[]): GeneralizedExperience {
    const base = { ...group[0] }
    const allIds: string[] = []

    let totalSR = 0
    let totalLat = 0
    let totalCost = 0

    for (const exp of group) {
      allIds.push(...exp.sourceMissionIds)
      totalSR += exp.effectiveness.successRate
      totalLat += exp.effectiveness.avgLatency
      totalCost += exp.effectiveness.costSavings
    }

    const n = group.length
    base.effectiveness = {
      successRate: totalSR / n,
      avgLatency: totalLat / n,
      costSavings: totalCost / n,
    }
    base.sourceMissionIds = [...new Set(allIds)]
    base.feedback = {
      positive: group.reduce((s, e) => s + e.feedback.positive, 0),
      negative: group.reduce((s, e) => s + e.feedback.negative, 0),
      weight: group.reduce((s, e) => s + e.feedback.weight, 0) / n,
    }

    return base
  }
}
