/**
 * Cross-Agent Learning — 类型定义 (v9.2)
 *
 * Agent 间经验共享的类型系统。
 */

export type ExperienceCategory = 'task_execution' | 'collaboration' | 'error_handling' | 'optimization' | 'communication'

export interface GeneralizedExperience {
  id: string
  category: ExperienceCategory
  /** 抽象化的问题模式（不包含具体数据） */
  problemPattern: string
  /** 抽象化的解决方案 */
  solution: string
  /** 有效性指标 */
  effectiveness: { successRate: number; avgLatency: number; costSavings: number }
  /** 来源 Agent 类型（匿名化：'agent-type' 而非 'agent-id'） */
  sourceAgentType: string
  /** 来源 Mission ID（可追溯） */
  sourceMissionIds: string[]
  /** 正/负反馈 */
  feedback: { positive: number; negative: number; weight: number }
  /** 创建时间 */
  createdAt: number
  /** 最后验证时间 */
  lastValidatedAt: number
  /** 匹配标签 */
  tags: string[]
  /** 可见性：哪些 Agent 类型可以访问 */
  visibleTo: string[]
}

export interface ExperienceQuery {
  category?: ExperienceCategory
  tags?: string[]
  minWeight?: number
  limit?: number
}
