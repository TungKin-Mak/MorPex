/**
 * CapabilityAdvertiser — 能力广告
 *
 * Agent 发布/更新能力描述到市场。
 */

import type { MarketplaceListing } from './types.js'
import { MarketplaceRegistry } from './MarketplaceRegistry.js'

export class CapabilityAdvertiser {
  constructor(private registry: MarketplaceRegistry) {}

  advertise(
    agentId: string,
    agentName: string,
    agentType: string,
    capabilities: { name: string; level: number; price: number }[],
    options?: { reputation?: number; pricePerTask?: number; tags?: string[] }
  ): MarketplaceListing {
    const listing: MarketplaceListing = {
      id: `listing_${agentId}`,
      agentId,
      agentName,
      agentType,
      capabilities,
      reputation: options?.reputation ?? 0.5,
      totalTasks: 0,
      successRate: 1,
      avgLatency: 0,
      pricePerTask: options?.pricePerTask ?? 100,
      available: true,
      tags: options?.tags ?? [],
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    }

    this.registry.register(listing)
    return listing
  }

  updatePricing(agentId: string, capabilityName: string, newPrice: number): boolean {
    return this.registry.updateCapabilityPrice(agentId, capabilityName, newPrice)
  }

  getAdvertisedCapabilities(agentId: string): { name: string; level: number; price: number }[] {
    for (const listing of this.registry.listAll()) {
      if (listing.agentId === agentId) {
        return [...listing.capabilities]
      }
    }
    return []
  }

  removeAdvert(agentId: string): boolean {
    return this.registry.unregister(agentId)
  }
}
