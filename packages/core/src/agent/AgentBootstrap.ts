/**
 * AgentBootstrap — v9 Agent 系统引导
 *
 * 职责: 创建并注册内置 Agent, 连接到 MessageBus。
 *
 * 内置 Agent:
 *   - PlannerAgent: 任务分解 + 策略生成
 *   - ExecutorAgent: 通用任务执行
 *   - ReviewerAgent: 结果审查
 *   - ResearcherAgent: 信息检索
 *   - CoderAgent: 代码生成
 *   - MemoryAgent: 记忆管理
 *   - EvolutionAgent: 工作流进化
 */

import type { AgentIdentity } from './identity/AgentIdentity.js'
import type { AgentProfile } from './identity/AgentProfile.js'
import type { AgentRegistry } from './registry/AgentRegistry.js'
import type { AgentMessageBus } from './communication/AgentMessageBus.js'
import type { CapabilityGraph } from './capability/CapabilityGraph.js'
import { AgentWorkerPool } from './AgentWorker.js'
import type { AgentMemoryIsolation } from './memory/AgentMemoryIsolation.js'
import { AgentLifecycle } from './lifecycle/AgentLifecycle.js'
import { AgentCapabilityEvolution } from './evolution/AgentCapabilityEvolution.js'

export interface BuiltinAgentConfig {
  id: string
  name: string
  role: AgentIdentity['role']
  capabilities: string[]
  parentCapabilities?: string[]
  status?: AgentIdentity['status']
}

export const BUILTIN_AGENTS: BuiltinAgentConfig[] = [
  {
    id: 'planner-001',
    name: 'PlannerAgent',
    role: 'planner',
    capabilities: ['task_decomposition', 'strategy_generation', 'dependency_analysis', 'risk_assessment'],
  },
  {
    id: 'executor-001',
    name: 'ExecutorAgent',
    role: 'executor',
    capabilities: ['task_execution', 'tool_usage', 'error_handling'],
  },
  {
    id: 'reviewer-001',
    name: 'ReviewerAgent',
    role: 'reviewer',
    capabilities: ['code_review', 'output_validation', 'quality_check'],
  },
  {
    id: 'researcher-001',
    name: 'ResearcherAgent',
    role: 'researcher',
    capabilities: ['information_retrieval', 'data_analysis', 'summarization'],
  },
  {
    id: 'coder-001',
    name: 'CoderAgent',
    role: 'coder',
    capabilities: ['coding', 'debug', 'refactor', 'code_review'],
    parentCapabilities: ['coding'],
  },
  {
    id: 'memory-001',
    name: 'MemoryAgent',
    role: 'memory-agent',
    capabilities: ['memory_store', 'memory_retrieve', 'memory_organize'],
  },
  {
    id: 'evolution-001',
    name: 'EvolutionAgent',
    role: 'evolution-agent',
    capabilities: ['workflow_mining', 'pattern_detection', 'optimization'],
  },
]

export class AgentBootstrap {
  /**
   * bootstrap — 初始化 Agent 系统
   *
   * 1. 注册所有内置 Agent 到 Registry
   * 2. 注册能力到 CapabilityGraph
   * 3. 订阅 Agent 到 MessageBus
   */
  static bootstrap(
    registry: AgentRegistry,
    capabilityGraph: CapabilityGraph,
    messageBus?: AgentMessageBus,
    memoryIsolation?: AgentMemoryIsolation,
  ): { workerPool: AgentWorkerPool; lifecycle: AgentLifecycle; evolution: AgentCapabilityEvolution } {
    const workerPool = new AgentWorkerPool()
    const lifecycle = new AgentLifecycle()
    const evolution = new AgentCapabilityEvolution()

    for (const config of BUILTIN_AGENTS) {
      const identity: AgentIdentity = {
        id: config.id,
        name: config.name,
        role: config.role,
        capabilities: config.capabilities,
        memoryScope: `mem_${config.role}`,
        permissionScope: `perm_${config.role}`,
        status: config.status || 'ACTIVE',
        version: 1,
        createdAt: Date.now(),
      }

      const profile: AgentProfile = {
        identity,
        successRate: 0.95,
        avgLatency: 1000,
        costPerTask: 0.01,
        humanEscalationRate: 0.05,
        reliabilityScore: 0.9,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        lastActiveAt: Date.now(),
        failureHistory: [],
      }

      registry.register(profile)

      // 注册能力到能力图
      if (config.parentCapabilities) {
        for (const parent of config.parentCapabilities) {
          for (const cap of config.capabilities) {
            capabilityGraph.register({
              name: cap,
              level: 3,
              cost: 0.3,
              successRate: 0.9,
              parentCapabilities: [parent],
            })
          }
        }
      } else {
        for (const cap of config.capabilities) {
          capabilityGraph.register({
            name: cap,
            level: 3,
            cost: 0.3,
            successRate: 0.9,
            parentCapabilities: [],
          })
        }
      }

      // 创建 Memory 分区
      if (memoryIsolation) {
        memoryIsolation.createPartition(config.id)
        // 授予 Shared Memory 访问权
        memoryIsolation.grantSharedAccess(config.id, ['mission_context', 'workflow_registry'])
      }

      // 创建并启动 Worker
      if (messageBus) {
        workerPool.createWorker({
          agentId: config.id,
          messageBus,
          registry,
          memoryIsolation,
          onResult: (taskId, success, output, duration) => {
            // 自动进化: 成功/失败影响能力分
            const profile = registry.getAgent(config.id)
            if (profile && config.capabilities.length > 0) {
              const primaryCap = config.capabilities[0]
              if (success) {
                evolution.recordSuccess(profile, primaryCap)
                evolution.upgradeLevel(profile, primaryCap)
              } else {
                evolution.recordFailure(profile, primaryCap)
              }
            }
            // 自动评估生命周期
            if (profile) {
              const newStatus = lifecycle.evaluate(profile)
              if (newStatus) lifecycle.transition(profile, newStatus, 'auto')
            }
          },
        })
      }
    }

    return { workerPool, lifecycle, evolution }
  }

  /**
   * bootstrapMinimal — 最小引导（仅 planner + executor）
   */
  static bootstrapMinimal(
    registry: AgentRegistry,
    capabilityGraph: CapabilityGraph,
    messageBus?: AgentMessageBus,
  ): void {
    const minimal = BUILTIN_AGENTS.filter(a => ['planner-001', 'executor-001', 'reviewer-001'].includes(a.id))
    // 临时替换 BUILTIN_AGENTS
    const saved = BUILTIN_AGENTS.slice()
    ;(BUILTIN_AGENTS as any).length = 0
    BUILTIN_AGENTS.push(...minimal)
    AgentBootstrap.bootstrap(registry, capabilityGraph, messageBus)
    BUILTIN_AGENTS.length = 0
    BUILTIN_AGENTS.push(...saved)
  }
}
