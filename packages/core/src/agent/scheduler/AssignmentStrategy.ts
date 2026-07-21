/**
 * AssignmentStrategy — v9 Agent 分配策略
 *
 * 计算 Agent 对任务的评分。
 * AgentScore = CapabilityScore × ReliabilityScore × (1 - Cost)
 *
 * 策略类型:
 *   - best_fit:      最优匹配 (默认)
 *   - round_robin:   轮询
 *   - cost_optimized: 成本优先
 *   - load_balanced:  负载均衡
 */

export interface TaskRequirement {
  taskId: string
  requiredCapabilities: string[]
  priority: number              // 1=highest, 5=lowest
  estimatedDuration: number     // ms
  budgetConstraint: number      // max cost
  preferAgent?: string          // sticky assignment
}

export interface AgentAssignment {
  taskId: string
  agentId: string
  score: number
  reason: string
  assignedAt: number
}

export type AssignmentStrategyType = 'best_fit' | 'round_robin' | 'cost_optimized' | 'load_balanced'

export class AssignmentStrategy {
  strategy: AssignmentStrategyType
  private roundRobinIndex: Map<string, number> = new Map()

  constructor(strategy: AssignmentStrategyType = 'best_fit') {
    this.strategy = strategy
  }

  /**
   * computeScore — 计算 Agent 对任务的匹配评分
   *
   * 公式: AgentScore = CapabilityScore × ReliabilityScore × (1 - Cost)
   *
   * CapabilityScore: Agent 拥有的匹配能力 / 任务所需能力数
   * ReliabilityScore: Agent 历史可靠性
   * Cost: Agent 的相对成本
   */
  computeScore(agent: any, task: TaskRequirement): number {
    const agentCaps: string[] = agent?.identity?.capabilities ?? agent?.capabilities ?? []
    const reliability: number = agent?.reliabilityScore ?? agent?.score ?? 0.5
    const cost: number = agent?.costPerTask ?? agent?.cost ?? 0.5

    // CapabilityScore: 匹配能力比例
    const matchedCaps = task.requiredCapabilities.filter(
      (req: string) => agentCaps.some((ac: string) => ac === req || ac.includes(req))
    )
    const capabilityScore = task.requiredCapabilities.length > 0
      ? matchedCaps.length / task.requiredCapabilities.length
      : 0.5

    return capabilityScore * reliability * (1 - cost)
  }

  /**
   * select — 按策略从候选 Agent 中选择
   */
  select(candidates: any[], task: TaskRequirement): any | undefined {
    if (candidates.length === 0) return undefined

    switch (this.strategy) {
      case 'best_fit':
        return candidates.sort((a, b) => this.computeScore(b, task) - this.computeScore(a, task))[0]

      case 'round_robin': {
        const key = task.requiredCapabilities.join(',')
        const idx = this.roundRobinIndex.get(key) ?? 0
        const selected = candidates[idx % candidates.length]
        this.roundRobinIndex.set(key, idx + 1)
        return selected
      }

      case 'cost_optimized':
        return candidates.sort((a, b) => (a.costPerTask ?? 1) - (b.costPerTask ?? 1))[0]

      case 'load_balanced':
        // 选择当前负载最低的
        return candidates.sort((a, b) => (a.activeTasks ?? 0) - (b.activeTasks ?? 0))[0]

      default:
        return candidates[0]
    }
  }
}
