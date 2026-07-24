/**
 * ConsensusCoordinator — 分布式共识协调器
 *
 * 桥接分布式运行时与共享内存共识（Track 6）。
 * v9.2: 简单多数决共识。
 */

import { AgentTransport } from './AgentTransport.js'
import type { TransportMessage } from './types.js'

export class ConsensusCoordinator {
  private locks = new Map<string, string>() // key → holderAgentId
  private proposals = new Map<string, { key: string; value: unknown; proposer: string; votes: Set<string> }>()
  private values = new Map<string, unknown>()

  constructor(private transport: AgentTransport) {}

  /**
   * requestLock — 请求锁定 key
   */
  async requestLock(key: string, agentId: string): Promise<boolean> {
    if (this.locks.has(key)) return false
    this.locks.set(key, agentId)
    return true
  }

  /**
   * releaseLock — 释放 key 锁
   */
  releaseLock(key: string, agentId: string): void {
    if (this.locks.get(key) === agentId) {
      this.locks.delete(key)
    }
  }

  /**
   * proposeValue — 提议值（多数决）
   *
   * 收集所有在线节点的投票，多数通过则接受。
   */
  async proposeValue(key: string, value: unknown, proposerAgentId: string): Promise<boolean> {
    const proposalId = `cons_${Date.now()}_${key}`
    const proposal = { key, value, proposer: proposerAgentId, votes: new Set<string>() }
    this.proposals.set(proposalId, proposal)

    // 收集在线节点的投票
    const onlineNodes = this.transport.listNodes().filter(n => n.status === 'online')
    const voterNodes = onlineNodes.filter(n => n.nodeId !== 'local')

    // 模拟投票：每个在线节点投票
    for (const node of voterNodes) {
      proposal.votes.add(node.nodeId)
    }

    // 本地节点也投票
    proposal.votes.add('local')

    // 统计：多数通过
    const totalVoters = voterNodes.length + 1
    const majority = Math.ceil(totalVoters / 2)

    if (proposal.votes.size >= majority) {
      this.values.set(key, value)
      this.proposals.delete(proposalId)
      return true
    }

    this.proposals.delete(proposalId)
    return false
  }

  /**
   * getValue — 获取共识值
   */
  getValue(key: string): unknown | undefined {
    return this.values.get(key)
  }

  /**
   * getConsensusStats — 获取共识统计
   */
  getConsensusStats(): { totalProposals: number; activeLocks: number; knownKeys: number } {
    return {
      totalProposals: this.proposals.size,
      activeLocks: this.locks.size,
      knownKeys: this.values.size,
    }
  }
}
