/**
 * AgentScheduler — v9 Agent 调度器
 *
 * 职责: Task → Agent 分配
 *
 * 流程:
 *   Mission → DAG Task → AgentScheduler → Agent Assignment → Execution
 *
 * AgentScore = CapabilityScore × ReliabilityScore × (1 - Cost)
 */

import { AssignmentStrategy, type AssignmentStrategyType, type TaskRequirement, type AgentAssignment } from './AssignmentStrategy.js'

export class AgentScheduler {
  private registry: any
  private capabilityGraph: any
  private strategy: AssignmentStrategy
  private assignments: Map<string, AgentAssignment> = new Map()
  private agentLoad: Map<string, number> = new Map()
  private stats = { totalAssignments: 0, totalReplacements: 0 }

  constructor(registry: any, capabilityGraph: any, strategy?: AssignmentStrategyType) {
    this.registry = registry
    this.capabilityGraph = capabilityGraph
    this.strategy = new AssignmentStrategy(strategy)
  }

  /**
   * selectAgent — 为任务选择最佳 Agent
   */
  selectAgent(task: TaskRequirement): AgentAssignment | null {
    if (!this.registry) return null

    // 找到所有匹配能力的 Agent
    const candidates = this.registry.findByCapabilities(task.requiredCapabilities)
    if (candidates.length === 0) return null

    // 按策略选择
    const selected = this.strategy.select(candidates, task)
    if (!selected) return null

    const agentId = selected.identity?.id ?? selected.id
    const score = this.strategy.computeScore(selected, task)

    const assignment: AgentAssignment = {
      taskId: task.taskId,
      agentId,
      score,
      reason: `score=${score.toFixed(3)}, strategy=${this.strategy.strategy}`,
      assignedAt: Date.now(),
    }

    this.assignments.set(task.taskId, assignment)
    this.agentLoad.set(agentId, (this.agentLoad.get(agentId) ?? 0) + 1)
    this.stats.totalAssignments++

    return assignment
  }

  /**
   * batchAssign — 批量分配任务到 Agent
   */
  batchAssign(tasks: TaskRequirement[]): AgentAssignment[] {
    const sorted = [...tasks].sort((a, b) => a.priority - b.priority)
    return sorted.map(t => this.selectAgent(t)).filter((a): a is AgentAssignment => a !== null)
  }

  /**
   * release — 任务完成后释放 Agent
   */
  release(taskId: string): void {
    const assignment = this.assignments.get(taskId)
    if (assignment) {
      const currentLoad = this.agentLoad.get(assignment.agentId) ?? 1
      this.agentLoad.set(assignment.agentId, Math.max(0, currentLoad - 1))
      this.assignments.delete(taskId)
    }
  }

  /**
   * getAssignment — 获取任务的 Agent 分配
   */
  getAssignment(taskId: string): AgentAssignment | undefined {
    return this.assignments.get(taskId)
  }

  /**
   * getAgentLoad — 获取 Agent 当前活跃任务数
   */
  getAgentLoad(agentId: string): number {
    return this.agentLoad.get(agentId) ?? 0
  }

  /**
   * replaceAgent — 替换失败的 Agent
   */
  replaceAgent(taskId: string, failedAgentId: string): AgentAssignment | null {
    const current = this.assignments.get(taskId)
    if (!current) return null

    // 释放失败的Agent
    const failedLoad = this.agentLoad.get(failedAgentId) ?? 1
    this.agentLoad.set(failedAgentId, Math.max(0, failedLoad - 1))
    this.assignments.delete(taskId)

    // 查找替代
    this.stats.totalReplacements++
    return this.selectAgent({
      taskId,
      requiredCapabilities: current.reason.includes('required')
        ? [current.reason]  // fallback
        : [],
      priority: 1,
      estimatedDuration: 300000,
      budgetConstraint: 100,
    })
  }

  /**
   * getStats — 获取调度统计
   */
  getStats(): { totalAssignments: number; activeAssignments: number; avgLoad: number; totalReplacements: number } {
    const loads = [...this.agentLoad.values()]
    return {
      totalAssignments: this.stats.totalAssignments,
      activeAssignments: this.assignments.size,
      avgLoad: loads.length > 0 ? loads.reduce((a, b) => a + b, 0) / loads.length : 0,
      totalReplacements: this.stats.totalReplacements,
    }
  }
}
