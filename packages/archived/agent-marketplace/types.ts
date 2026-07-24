/**
 * Agent Marketplace — 类型定义
 *
 * v9.2: 动态 Agent 发现、能力竞价、信任验证。
 */

export interface MarketplaceListing {
  id: string
  agentId: string
  agentName: string
  agentType: string
  capabilities: { name: string; level: number; price: number }[]
  reputation: number
  totalTasks: number
  successRate: number
  avgLatency: number
  pricePerTask: number
  available: boolean
  tags: string[]
  registeredAt: number
  lastSeenAt: number
}

export interface BidRequest {
  id: string
  taskDescription: string
  requiredCapabilities: string[]
  maxBudget: number
  deadline: number
  issuedAt: number
}

export interface Bid {
  requestId: string
  agentId: string
  price: number
  estimatedDuration: number
  confidence: number
  submittedAt: number
}

export interface MarketplaceContract {
  id: string
  buyerAgentId: string
  sellerAgentId: string
  taskDescription: string
  price: number
  deadline: number
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled'
  signedAt: number
  completedAt?: number
}
