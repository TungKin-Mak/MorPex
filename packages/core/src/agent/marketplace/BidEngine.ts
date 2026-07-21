/**
 * BidEngine — 竞价引擎
 *
 * Contract Net Protocol 的投标阶段：
 *   1. 发布 BidRequest
 *   2. 候选 Agent 投标
 *   3. 按策略选择最佳标
 */

import type { BidRequest, Bid, MarketplaceListing } from './types.js'

export type BidStrategy = 'cheapest' | 'fastest' | 'most_reliable' | 'balanced'

export class BidEngine {
  /**
   * requestBids — 向匹配的列表发出投标请求
   *
   * 遍历候选列表，每个 Agent 根据其 profile 生成标书。
   */
  requestBids(request: BidRequest, listings: MarketplaceListing[]): Bid[] {
    const bids: Bid[] = []

    for (const listing of listings) {
      if (!listing.available) continue

      const complexity = Math.min(3, Math.ceil(request.requiredCapabilities.length / 2))
      const price = listing.pricePerTask * complexity

      const bid: Bid = {
        requestId: request.id,
        agentId: listing.agentId,
        price,
        estimatedDuration: listing.avgLatency > 0 ? listing.avgLatency * complexity : 5000,
        confidence: listing.successRate,
        submittedAt: Date.now(),
      }

      bids.push(bid)
    }

    return bids
  }

  /**
   * selectBestBid — 按策略选择最佳标书
   */
  selectBestBid(bids: Bid[], strategy: BidStrategy = 'balanced'): Bid | null {
    if (bids.length === 0) return null

    switch (strategy) {
      case 'cheapest':
        return bids.reduce((best, b) => b.price < best.price ? b : best)

      case 'fastest':
        return bids.reduce((best, b) => b.estimatedDuration < best.estimatedDuration ? b : best)

      case 'most_reliable':
        return bids.reduce((best, b) => b.confidence > best.confidence ? b : best)

      case 'balanced': {
        const maxPrice = Math.max(...bids.map(b => b.price))
        const maxDuration = Math.max(...bids.map(b => b.estimatedDuration))

        return bids.reduce((best, b) => {
          const priceScore = maxPrice > 0 ? 1 - b.price / maxPrice : 0.5
          const durationScore = maxDuration > 0 ? 1 - b.estimatedDuration / maxDuration : 0.5
          const totalScore = 0.4 * priceScore + 0.3 * durationScore + 0.3 * b.confidence
          const bestScore = best ? (() => {
            const bp = maxPrice > 0 ? 1 - best.price / maxPrice : 0.5
            const bd = maxDuration > 0 ? 1 - best.estimatedDuration / maxDuration : 0.5
            return 0.4 * bp + 0.3 * bd + 0.3 * best.confidence
          })() : -1
          return totalScore > bestScore ? b : best
        }, bids[0])
      }
    }
  }
}
