/**
 * AgentExecutionContext — Agent 执行上下文 (v9.0)
 *
 * Task 与 Agent 绑定时创建，包含执行环境的所有约束。
 */

export interface AgentExecutionContext {
  missionId: string
  taskId: string
  agentId: string
  agentRole: string
  permissions: string[]
  memoryScope: string
  sharedMemoryAccess: string[]
  budget: number
  sandboxContext?: {
    cpuLimit: number
    memoryLimit: number
    network: boolean
    filesystem: string
    timeout: number
  }
  parentContext?: string
  createdAt: number
}

export interface AgentMemoryScope {
  agentId: string
  privateMemory: string
  sharedAccess: string[]
  maxPrivateEntries: number
  currentEntries: number
}

export class AgentContextFactory {
  private counter = 0

  createContext(missionId: string, taskId: string, agentId: string, agentRole: string): AgentExecutionContext {
    return {
      missionId,
      taskId,
      agentId,
      agentRole,
      permissions: [],
      memoryScope: `agent_private_${agentId}`,
      sharedMemoryAccess: [],
      budget: 50000,
      createdAt: Date.now(),
    }
  }

  createChildContext(parent: AgentExecutionContext, taskId: string, agentId: string): AgentExecutionContext {
    return {
      ...parent,
      taskId,
      agentId,
      agentRole: '',
      parentContext: parent.taskId,
      createdAt: Date.now(),
    }
  }
}
