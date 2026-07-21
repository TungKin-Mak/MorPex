/**
 * TrustVerifier — 信任验证器
 *
 * 验证市场 Agent 的可信度。支持内部 Agent 和外部第三方 Agent。
 */

import type { MarketplaceListing } from './types.js'
import { MarketplaceRegistry } from './MarketplaceRegistry.js'

export interface TrustResult {
  trusted: boolean
  score: number
  reasons: string[]
}

export class TrustVerifier {
  /**
   * verify — 验证市场中的 Agent
   *
   * 检查: successRate >= 0.5, totalTasks >= 5, lastSeenAt within 24h
   * 评分: successRate * 0.5 + min(1, totalTasks/100) * 0.3 + (available ? 0.2 : 0)
   */
  verify(agentId: string, marketplace: MarketplaceRegistry): TrustResult {
    const listings = marketplace.query({})
    const listing = listings.find(l => l.agentId === agentId)

    if (!listing) {
      return { trusted: false, score: 0, reasons: ['Agent not found in marketplace'] }
    }

    const reasons: string[] = []
    let score = 0

    // successRate check
    if (listing.successRate >= 0.5) {
      score += listing.successRate * 0.5
    } else {
      reasons.push(`Low success rate: ${listing.successRate.toFixed(2)}`)
    }

    // totalTasks check
    const taskScore = Math.min(1, listing.totalTasks / 100)
    score += taskScore * 0.3
    if (listing.totalTasks < 5) {
      reasons.push(`Insufficient task history: ${listing.totalTasks} tasks`)
    }

    // availability check
    if (listing.available) {
      score += 0.2
    } else {
      reasons.push('Agent currently unavailable')
    }

    // recency check
    const hoursSinceLastSeen = (Date.now() - listing.lastSeenAt) / 3600000
    if (hoursSinceLastSeen > 24) {
      reasons.push(`Agent not seen for ${Math.round(hoursSinceLastSeen)} hours`)
      score *= 0.5
    }

    const trusted = score >= 0.4
    return { trusted, score: Math.round(score * 1000) / 1000, reasons }
  }

  /**
   * verifyExternalAgent — 验证外部第三方 Agent
   *
   * 外部 Agent 初始信任度较低，需要额外检查。
   */
  verifyExternalAgent(agentData: any): TrustResult {
    const reasons: string[] = ['External agent: reduced trust']
    let score = 0.3 // 默认外部 Agent 信任度

    if (agentData.reputation !== undefined) {
      score += agentData.reputation * 0.3
    } else {
      reasons.push('No reputation data available')
    }

    if (agentData.verifiedByThirdParty) {
      score += 0.2
      reasons.push('Verified by third party')
    }

    const trusted = score >= 0.4
    return { trusted, score: Math.round(score * 1000) / 1000, reasons }
  }
}
