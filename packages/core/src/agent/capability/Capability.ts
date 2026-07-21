/**
 * Capability — v9 Agent 能力定义
 *
 * 能力是 Agent 调度的最小单位。
 * Agent 不根据名字选择，根据能力匹配。
 *
 * 能力层次:
 *   coding
 *     ├── debug
 *     ├── review
 *     └── refactor
 */

export interface Capability {
  /** 能力名称 */
  name: string
  /** 熟练程度 1-5 */
  level: number
  /** 相对成本 0-1 */
  cost: number
  /** 历史成功率 0-1 */
  successRate: number
  /** 父能力列表 (coding 是 debug/review/refactor 的父) */
  parentCapabilities: string[]
}

export interface CapabilityMatchResult {
  agentId: string
  capabilityName: string
  matchScore: number            // 0-1
  levelMatch: number            // 0-1 能力级别匹配度
  costMatch: number             // 0-1 成本匹配度
}
