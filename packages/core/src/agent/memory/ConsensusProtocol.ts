/**
 * ConsensusProtocol — 共享内存共识协议
 *
 * 简化版共识（多数决）：Agent 提议写入共享内存，其他 Agent 投票。
 * 多数通过则写入。适用于 team_shared 和 org_shared 范围。
 */

import type { MemoryScope } from './SharedMemoryManager.js'

export interface ConsensusProposal {
  id: string
  key: string
  value: unknown
  proposerAgentId: string
  scope: MemoryScope
  proposedAt: number
  status: 'pending' | 'accepted' | 'rejected' | 'conflicted'
  votes: { agentId: string; approve: boolean; reason?: string }[]
  acceptedAt?: number
}

export class ConsensusProtocol {
  private proposals = new Map<string, ConsensusProposal>()
  private counter = 0
  private knownAgents: string[] = []

  /**
   * setKnownAgents — 设置已知 Agent 列表（用于计算多数）
   */
  setKnownAgents(agentIds: string[]): void {
    this.knownAgents = [...agentIds]
  }

  /**
   * propose — 发起写入提议
   */
  propose(key: string, value: unknown, agentId: string, scope: MemoryScope): ConsensusProposal {
    const proposal: ConsensusProposal = {
      id: `consensus_${Date.now()}_${++this.counter}`,
      key,
      value,
      proposerAgentId: agentId,
      scope,
      proposedAt: Date.now(),
      status: 'pending',
      votes: [],
    }

    this.proposals.set(proposal.id, proposal)
    return proposal
  }

  /**
   * vote — 对提议投票
   */
  vote(proposalId: string, agentId: string, approve: boolean, reason?: string): void {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return

    proposal.votes.push({ agentId, approve, reason })
  }

  /**
   * tally — 统计投票结果
   *
   * 多数决：赞成票 > 50% 已知 Agent 则通过
   */
  tally(proposalId: string): ConsensusProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`)

    const totalVoters = Math.max(1, this.knownAgents.length)
    const approveCount = proposal.votes.filter(v => v.approve).length
    const rejectCount = proposal.votes.filter(v => !v.approve).length
    const majority = Math.ceil(totalVoters / 2)

    if (approveCount >= majority) {
      proposal.status = 'accepted'
      proposal.acceptedAt = Date.now()
    } else if (rejectCount >= majority) {
      proposal.status = 'rejected'
    } else if (approveCount > 0 && rejectCount > 0) {
      proposal.status = 'conflicted'
    } else {
      proposal.status = 'pending' // 票数不足
    }

    return proposal
  }

  /**
   * resolve — 解析提议结果，返回是否接受及值
   */
  resolve(proposalId: string): { accepted: boolean; value?: unknown } {
    const proposal = this.tally(proposalId)
    return {
      accepted: proposal.status === 'accepted',
      value: proposal.status === 'accepted' ? proposal.value : undefined,
    }
  }

  /**
   * getProposal — 获取提议
   */
  getProposal(id: string): ConsensusProposal | undefined {
    return this.proposals.get(id)
  }

  /**
   * getPendingProposals — 获取所有待处理提议
   */
  getPendingProposals(): ConsensusProposal[] {
    return [...this.proposals.values()].filter(p => p.status === 'pending')
  }
}
