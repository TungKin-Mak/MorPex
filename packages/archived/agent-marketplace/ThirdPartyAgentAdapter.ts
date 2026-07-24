/**
 * ThirdPartyAgentAdapter — 第三方 Agent 适配器
 *
 * 将外部 Agent 数据格式转换为标准 MarketplaceListing。
 */

import type { MarketplaceListing } from './types.js'

export class ThirdPartyAgentAdapter {
  /**
   * adaptExternalAgent — 将外部 Agent 数据转换为 MarketplaceListing
   */
  adaptExternalAgent(externalAgentData: any): MarketplaceListing {
    const name = externalAgentData.name || externalAgentData.agentName || 'unknown'
    const tags = ['external']

    if (externalAgentData.tags && Array.isArray(externalAgentData.tags)) {
      tags.push(...externalAgentData.tags.filter((t: any) => typeof t === 'string'))
    }

    return {
      id: `ext_${externalAgentData.id || Date.now()}`,
      agentId: externalAgentData.id || `ext_${Date.now()}`,
      agentName: name,
      agentType: externalAgentData.type || 'external',
      capabilities: (externalAgentData.capabilities || []).map((c: any) => ({
        name: typeof c === 'string' ? c : c.name || 'unknown',
        level: c.level || 1,
        price: c.price || 200,
      })),
      reputation: 0.3, // 未知 Agent 默认低信任
      totalTasks: externalAgentData.totalTasks || 0,
      successRate: externalAgentData.successRate || 0.5,
      avgLatency: externalAgentData.avgLatency || 10000,
      pricePerTask: externalAgentData.pricePerTask || 200,
      available: externalAgentData.available !== false,
      tags,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    }
  }

  /**
   * isExternal — 判断列表是否为外部 Agent
   */
  isExternal(listing: MarketplaceListing): boolean {
    return listing.tags.includes('external') || listing.id.startsWith('ext_')
  }

  /**
   * getExternalMetadata — 获取外部 Agent 元数据
   */
  getExternalMetadata(listing: MarketplaceListing): { originalId?: string; source?: string } {
    return {
      originalId: listing.agentId,
      source: listing.tags.includes('external') ? 'external' : 'internal',
    }
  }
}
