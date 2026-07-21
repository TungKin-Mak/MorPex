/**
 * NegotiationEngine — Agent 协商引擎 (v9.0)
 *
 * Contract Net Protocol:
 *   1. Announce: 发布任务需求
 *   2. Bid: 候选 Agent 投标
 *   3. Award: 选择最佳投标
 */

import type { AgentMessageBus } from '../communication/AgentMessageBus.js'

export interface NegotiationRequest {
  id: string
  from: string
  task: { capability: string; input: Record<string, unknown> }
  candidates: string[]
  deadline: number
}

export interface NegotiationResponse {
  requestId: string
  agentId: string
  accepted: boolean
  bid: { estimatedDuration: number; estimatedCost: number; confidence: number }
  reason?: string
}

export class NegotiationEngine {
  private messageBus: AgentMessageBus

  constructor(messageBus: AgentMessageBus) {
    this.messageBus = messageBus
  }

  async requestBids(request: NegotiationRequest): Promise<NegotiationResponse[]> {
    const responses: NegotiationResponse[] = []

    for (const candidateId of request.candidates) {
      try {
        const response = await this.messageBus.request({
          id: `neg_${request.id}_${Date.now()}`,
          from: 'negotiation-engine',
          to: candidateId,
          type: 'REQUEST',
          payload: {
            negotiationId: request.id,
            task: request.task,
          },
          timestamp: Date.now(),
        }, request.deadline)

        responses.push({
          requestId: request.id,
          agentId: candidateId,
          accepted: response.success,
          bid: response.result as any,
        })
      } catch {
        responses.push({
          requestId: request.id,
          agentId: candidateId,
          accepted: false,
          bid: { estimatedDuration: 0, estimatedCost: 0, confidence: 0 },
          reason: 'No response',
        })
      }
    }

    return responses
  }

  selectBest(bids: NegotiationResponse[]): NegotiationResponse | undefined {
    const accepted = bids.filter(b => b.accepted)
    if (accepted.length === 0) return undefined

    return accepted.sort((a, b) => {
      const scoreA = b.bid.confidence / (b.bid.estimatedCost + 0.01)
      const scoreB = a.bid.confidence / (a.bid.estimatedCost + 0.01)
      return scoreA - scoreB
    })[0]
  }

  async contractNet(
    task: { capability: string; input: Record<string, unknown> },
    candidates: string[],
  ): Promise<{ winner: string; bid: NegotiationResponse } | null> {
    const request: NegotiationRequest = {
      id: `neg_${Date.now()}`,
      from: 'negotiation-engine',
      task,
      candidates,
      deadline: 30000,
    }

    const bids = await this.requestBids(request)
    const best = this.selectBest(bids)
    if (!best) return null

    return { winner: best.agentId, bid: best }
  }
}
