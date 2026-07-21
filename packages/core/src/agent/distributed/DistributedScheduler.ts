/**
 * DistributedScheduler — 分布式调度器
 *
 * 扩展本地调度，感知远程节点。本地 Agent 有 1.2x 评分加成。
 */

import { AgentTransport } from './AgentTransport.js'

export interface RemoteCandidate {
  nodeId: string
  agentId: string
  score: number
}

export class DistributedScheduler {
  constructor(
    private localScheduler: any,
    private transport: AgentTransport
  ) {}

  /**
   * selectAgent — 为任务选择 Agent（本地优先，远程兜底）
   */
  selectAgent(task: any): any {
    // 1. 先尝试本地调度
    const local = this.localScheduler.selectAgent(task)
    if (local) {
      local.score = (local.score || 0) * 1.2 // 本地 Agent 1.2x 加成
      local.reason = `${local.reason || ''} (local 1.2x boost)`
      return local
    }

    // 2. 查询远程候选
    const remoteCandidates = this.getRemoteCandidates(task.requiredCapabilities || [])
    if (remoteCandidates.length === 0) return null

    const best = remoteCandidates.sort((a, b) => b.score - a.score)[0]

    return {
      taskId: task.taskId,
      agentId: best.agentId,
      score: best.score,
      reason: `remote agent on ${best.nodeId}`,
      assignedAt: Date.now(),
    }
  }

  /**
   * getRemoteCandidates — 获取远程节点上匹配的 Agent
   */
  getRemoteCandidates(capabilities: string[]): RemoteCandidate[] {
    const candidates: RemoteCandidate[] = []

    for (const node of this.transport.listNodes()) {
      if (node.status !== 'online') continue

      // 检查远程节点的能力匹配
      const matchingCapabilities = node.capabilities.filter(c => capabilities.includes(c))
      if (matchingCapabilities.length === 0) continue

      // 计算分数: 能力匹配度 × (1 - 延迟惩罚)
      const latencyPenalty = Math.min(0.5, node.latency / 1000) // 1s = 50% penalty
      const score = (matchingCapabilities.length / capabilities.length) * (1 - latencyPenalty)

      for (const agentId of node.connectedAgents) {
        candidates.push({
          nodeId: node.nodeId,
          agentId,
          score,
        })
      }
    }

    return candidates
  }

  /**
   * getStats — 获取调度统计
   */
  getStats(): { localAgentCount: number; remoteNodeCount: number; remoteAgentCandidates: number } {
    let remoteCandidates = 0
    for (const node of this.transport.listNodes()) {
      remoteCandidates += node.connectedAgents.length
    }
    return {
      localAgentCount: 0,
      remoteNodeCount: this.transport.listNodes().length,
      remoteAgentCandidates: remoteCandidates,
    }
  }
}
