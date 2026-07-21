/**
 * MarketplaceRegistry — 市场注册中心
 *
 * 管理 Agent 市场列表的注册、查询、心跳更新。
 */

import type { MarketplaceListing } from './types.js'

export interface MarketplaceQuery {
  capability?: string
  tag?: string
  minReputation?: number
  maxPrice?: number
  availableOnly?: boolean
}

export class MarketplaceRegistry {
  private listings = new Map<string, MarketplaceListing>()

  register(listing: MarketplaceListing): void {
    this.listings.set(listing.id, { ...listing, registeredAt: Date.now(), lastSeenAt: Date.now() })
  }

  unregister(agentId: string): boolean {
    for (const [id, listing] of this.listings) {
      if (listing.agentId === agentId) {
        this.listings.delete(id)
        return true
      }
    }
    return false
  }

  get(agentId: string): MarketplaceListing | undefined {
    for (const listing of this.listings.values()) {
      if (listing.agentId === agentId) return { ...listing }
    }
    return undefined
  }

  /**
   * getByListingId — 按列表 ID 查找
   */
  getByListingId(listingId: string): MarketplaceListing | undefined {
    return this.listings.get(listingId)
  }

  query(filter: MarketplaceQuery): MarketplaceListing[] {
    let results = [...this.listings.values()]

    if (filter.capability) {
      results = results.filter(l => l.capabilities.some(c => c.name === filter.capability))
    }
    if (filter.tag) {
      results = results.filter(l => l.tags.includes(filter.tag!))
    }
    if (filter.minReputation !== undefined) {
      results = results.filter(l => l.reputation >= filter.minReputation!)
    }
    if (filter.maxPrice !== undefined) {
      results = results.filter(l => l.pricePerTask <= filter.maxPrice!)
    }
    if (filter.availableOnly) {
      results = results.filter(l => l.available)
    }

    return results.sort((a, b) => b.reputation - a.reputation)
  }

  updateHeartbeat(agentId: string): void {
    for (const listing of this.listings.values()) {
      if (listing.agentId === agentId) {
        listing.lastSeenAt = Date.now()
        return
      }
    }
  }

  getStats(): { totalListings: number; avgPrice: number; avgReputation: number } {
    const values = [...this.listings.values()]
    return {
      totalListings: values.length,
      avgPrice: values.length > 0 ? values.reduce((s, l) => s + l.pricePerTask, 0) / values.length : 0,
      avgReputation: values.length > 0 ? values.reduce((s, l) => s + l.reputation, 0) / values.length : 0,
    }
  }

  /**
   * findByCapability — 按能力名称查找
   */
  findByCapability(capability: string): MarketplaceListing[] {
    return [...this.listings.values()].filter(l =>
      l.available && l.capabilities.some(c => c.name === capability)
    )
  }

  /**
   * findByTag — 按标签查找
   */
  findByTag(tag: string): MarketplaceListing[] {
    return [...this.listings.values()].filter(l =>
      l.available && l.tags.includes(tag)
    )
  }

  /**
   * updateCapabilityPrice — 更新 Agent 某项能力的定价（直接修改内部存储）
   */
  updateCapabilityPrice(agentId: string, capabilityName: string, newPrice: number): boolean {
    for (const listing of this.listings.values()) {
      if (listing.agentId === agentId) {
        const cap = listing.capabilities.find(c => c.name === capabilityName)
        if (!cap) return false
        cap.price = newPrice
        listing.pricePerTask = Math.max(...listing.capabilities.map(c => c.price))
        return true
      }
    }
    return false
  }

  listAll(): MarketplaceListing[] {
    return [...this.listings.values()]
  }
}
