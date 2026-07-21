/**
 * CrossAgentLearningEngine — 跨 Agent 学习引擎
 *
 * v9.2: Agent 间共享学习经验的核心编排器。
 *
 * 流程:
 *   1. learnFromOutcome: 从输出中提炼 → 存储 → 传播 → 返回经验
 *   2. queryRelevant: 匹配相关经验 → 返回
 *   3. feedback: 记录经验有用性反馈
 */

import type { GeneralizedExperience } from './types.js'
import { ExperienceRepository } from './ExperienceRepository.js'
import { KnowledgeDistiller } from './KnowledgeDistiller.js'
import { LearningPropagationService } from './LearningPropagationService.js'
import { ExperienceMatcher } from './ExperienceMatcher.js'

export class CrossAgentLearningEngine {
  constructor(
    private repository: ExperienceRepository,
    private distiller: KnowledgeDistiller,
    private propagator: LearningPropagationService,
    private matcher: ExperienceMatcher
  ) {}

  /**
   * learnFromOutcome — 从执行结果中学习
   *
   * 完整流程: 提炼 → 去重 → 存储 → 传播 → 返回
   *
   * @param missionId - Mission ID
   * @param outcome - 执行结果（可以是 DecisionEvent、MissionResult 或 CollaborationResult）
   * @param sourceAgentType - 来源 Agent 类型
   * @returns 提炼并存储的经验列表
   */
  learnFromOutcome(
    missionId: string,
    outcome: any,
    sourceAgentType: string
  ): GeneralizedExperience[] {
    let rawExperiences: GeneralizedExperience[] = []

    // 1. 根据 outcome 类型选择提炼策略
    if (outcome.reasoning && outcome.decision) {
      rawExperiences = this.distiller.distillFromDecision(outcome)
    } else if (outcome.success !== undefined) {
      rawExperiences = this.distiller.distillFromMission(outcome, 0)
    } else if (outcome.completedTasks || outcome.failedTasks) {
      rawExperiences = this.distiller.distillFromCollaboration(outcome)
    }

    if (rawExperiences.length === 0) return []

    // 2. 合并重复经验
    const merged = this.distiller.mergeDuplicate(rawExperiences)

    // 3. 设置来源
    const experiences = merged.map(exp => ({
      ...exp,
      sourceAgentType,
      sourceMissionIds: [missionId, ...exp.sourceMissionIds],
      lastValidatedAt: Date.now(),
    }))

    // 4. 存储并传播
    for (const exp of experiences) {
      this.repository.store(exp)
      this.propagator.propagateToAll(exp)
    }

    return experiences
  }

  /**
   * queryRelevant — 查询与问题相关的经验
   *
   * 在注入 PlanningStage / TwinStage 时使用，提供上下文参考。
   *
   * @param problem - 当前面临的问题描述
   * @param agentType - 查询的 Agent 类型
   * @returns 相关经验列表
   */
  queryRelevant(problem: string, agentType: string): GeneralizedExperience[] {
    return this.matcher.match(problem, this.repository, agentType)
  }

  /**
   * feedback — 记录经验反馈
   *
   * @param id - 经验 ID
   * @param wasHelpful - 是否有效
   */
  feedback(id: string, wasHelpful: boolean): void {
    this.repository.recordFeedback(id, wasHelpful)
  }

  /**
   * getStats — 获取学习引擎统计
   */
  getStats(): {
    repository: { total: number; byCategory: Record<string, number>; avgWeight: number }
    propagation: { totalPropagations: number; uniqueExperiences: number }
  } {
    return {
      repository: this.repository.getStats(),
      propagation: this.propagator.getStats(),
    }
  }
}
