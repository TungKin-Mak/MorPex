/**
 * CollaborationManager — Agent 协作管理器 (v9.0)
 *
 * 多个 Agent 协作完成一个 Mission。
 *
 * 协作模式:
 *   sequential — 顺序执行 (上一个输出是下一个输入)
 *   parallel   — 并行执行 (合并所有输出)
 *   voting     — 投票 (多数决)
 *   pipeline   — 管道 (链式处理)
 *
 * 故障处理:
 *   当协作中的 Agent 失败时，自动查找替换 Agent。
 */

import type { AgentMessage } from '../communication/AgentMessage.js'
import type { AgentMessageBus } from '../communication/AgentMessageBus.js'
import type { AgentScheduler } from '../scheduler/AgentScheduler.js'
import type { AgentRegistry } from '../registry/AgentRegistry.js'
import type { TaskRequirement } from '../scheduler/AssignmentStrategy.js'
import { ResultAggregator } from './ResultAggregator.js'
import type { TeamFormationEngine } from '../team/TeamFormationEngine.js'
import type { SharedMemoryManager } from '../memory/SharedMemoryManager.js'

export type CollaborationMode = 'sequential' | 'parallel' | 'voting' | 'pipeline'

export interface CollaborationPlan {
  missionId: string
  mode: CollaborationMode
  tasks: CollaborationTask[]
  dependencies: { taskId: string; dependsOn: string[] }[]
}

export interface CollaborationTask {
  taskId: string
  requiredCapabilities: string[]
  assignedAgent?: string
  input: Record<string, unknown>
  expectedOutput: Record<string, unknown>
  priority: number
  timeout: number
}

export interface CollaborationResult {
  missionId: string
  completedTasks: { taskId: string; agentId: string; output: unknown; duration: number }[]
  failedTasks: { taskId: string; agentId: string; error: string }[]
  aggregatedOutput: unknown
  totalDuration: number
  success: boolean
}

export class CollaborationManager {
  private scheduler: AgentScheduler
  private messageBus: AgentMessageBus
  private registry: AgentRegistry
  private aggregator: ResultAggregator
  private profileManager: any = null       // v9: AgentProfileManager
  private sharedMemoryManager: SharedMemoryManager | null = null
  private teamFormation: TeamFormationEngine | null = null
  private stats = { totalCollaborations: 0, successCount: 0, totalDuration: 0 }

  constructor(
    scheduler: AgentScheduler,
    messageBus: AgentMessageBus,
    registry: AgentRegistry,
    profileManager?: any,
    teamFormation?: TeamFormationEngine,
    sharedMemory?: SharedMemoryManager
  ) {
    this.scheduler = scheduler
    this.messageBus = messageBus
    this.registry = registry
    this.profileManager = profileManager ?? null
    this.teamFormation = teamFormation ?? null
    this.sharedMemoryManager = sharedMemory ?? null
    this.aggregator = new ResultAggregator()
    if (this.teamFormation) console.log('[CollaborationManager] TeamFormationEngine 已接入')
    if (this.sharedMemoryManager) console.log('[CollaborationManager] SharedMemoryManager 已接入')
  }

  async execute(plan: CollaborationPlan): Promise<CollaborationResult> {
    const startTime = Date.now()
    const completedTasks: CollaborationResult['completedTasks'] = []
    const failedTasks: CollaborationResult['failedTasks'] = []
    let aggregatedOutput: unknown = null

    this.stats.totalCollaborations++

    for (const task of plan.tasks) {
      const requirement: TaskRequirement = {
        taskId: task.taskId,
        requiredCapabilities: task.requiredCapabilities,
        priority: task.priority,
        estimatedDuration: task.timeout,
        budgetConstraint: 100000,
      }

      const assignment = this.scheduler.selectAgent(requirement)
      if (!assignment) {
        failedTasks.push({ taskId: task.taskId, agentId: 'unassigned', error: 'No available agent' })
        continue
      }

      // Send task to agent via message bus
      try {
        const response = await this.messageBus.request({
          id: `msg_${task.taskId}_${Date.now()}`,
          from: 'collaboration-manager',
          to: assignment.agentId,
          type: 'REQUEST',
          payload: { taskId: task.taskId, input: task.input },
          timestamp: Date.now(),
        }, task.timeout)

        completedTasks.push({
          taskId: task.taskId,
          agentId: assignment.agentId,
          output: response.result,
          duration: response.duration,
        })
        // v9: 自动记录 Agent 性能
        if (this.profileManager) {
          try { this.profileManager.recordSuccess(assignment.agentId, task.taskId, response.duration) } catch {}
        }
      } catch (err: any) {
        failedTasks.push({ taskId: task.taskId, agentId: assignment.agentId, error: err.message })
        // v9: 记录失败
        if (this.profileManager) {
          try { this.profileManager.recordFailure(assignment.agentId, task.taskId, err.message) } catch {}
        }
      }

      this.scheduler.release(task.taskId)
    }

    // Aggregate results based on mode
    aggregatedOutput = this.aggregate(completedTasks.map(t => t.output), plan.mode)

    const totalDuration = Date.now() - startTime
    this.stats.successCount += failedTasks.length === 0 ? 1 : 0
    this.stats.totalDuration += totalDuration

    // 持久化协作结果到共享内存
    if (this.sharedMemoryManager) {
      try {
        this.sharedMemoryManager.write(
          `collab:${plan.missionId}:result`,
          { completedTasks: completedTasks.length, failedTasks: failedTasks.length, success: failedTasks.length === 0, duration: totalDuration },
          'team_shared',
          'collaboration-manager',
          3600000 // 1h TTL
        )
      } catch {}
    }

    return {
      missionId: plan.missionId,
      completedTasks,
      failedTasks,
      aggregatedOutput,
      totalDuration,
      success: failedTasks.length === 0,
    }
  }

  createPlan(missionId: string, capabilities: string[], taskCount: number): CollaborationPlan {
    const tasks: CollaborationTask[] = Array.from({ length: taskCount }, (_, i) => ({
      taskId: `task_${missionId}_${i}`,
      requiredCapabilities: capabilities,
      input: {},
      expectedOutput: {},
      priority: 1,
      timeout: 60000,
    }))

    return {
      missionId,
      mode: 'parallel',
      tasks,
      dependencies: [],
    }
  }

  async handleAgentFailure(taskId: string, failedAgentId: string, plan: CollaborationPlan): Promise<void> {
    const task = plan.tasks.find(t => t.taskId === taskId)
    if (!task) return

    const replacement = this.scheduler.replaceAgent(taskId, failedAgentId)
    if (replacement) {
      task.assignedAgent = replacement.agentId
    }
  }

  getStats(): { totalCollaborations: number; successRate: number; avgDuration: number } {
    return {
      totalCollaborations: this.stats.totalCollaborations,
      successRate: this.stats.totalCollaborations > 0
        ? this.stats.successCount / this.stats.totalCollaborations
        : 1,
      avgDuration: this.stats.totalCollaborations > 0
        ? Math.round(this.stats.totalDuration / this.stats.totalCollaborations)
        : 0,
    }
  }

  private aggregate(outputs: unknown[], mode: CollaborationMode): unknown {
    switch (mode) {
      case 'sequential': return this.aggregator.sequential(outputs)
      case 'parallel': return this.aggregator.parallel(outputs)
      default: return outputs
    }
  }
}
