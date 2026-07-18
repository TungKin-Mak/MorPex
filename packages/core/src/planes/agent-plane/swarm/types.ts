/**
 * Swarm Plugin — 类型定义
 *
 * 基于任务拍卖的多 Agent 调度系统。
 */

// ── 任务拍卖 ──

/** 拍卖状态 */
export type AuctionStatus = 'open' | 'awarded' | 'expired' | 'cancelled';

/** 任务拍卖 */
export interface TaskAuction {
  id: string;
  taskId: string;
  description: string;
  /** 所需能力 */
  requiredCapabilities: string[];
  /** 预算 */
  budget: number;
  /** 截止时间 */
  deadline: number;
  /** 当前状态 */
  status: AuctionStatus;
  /** 收到的投标 */
  bids: AgentBid[];
  /** 中标 Agent ID */
  awardedTo?: string;
  /** 创建时间 */
  createdAt: number;
}

// ── Agent 投标 ──

/** Agent 投标 */
export interface AgentBid {
  agentId: string;
  agentName: string;
  /** 能力声明 */
  capabilities: string[];
  /** 报价 */
  price: number;
  /** 预估耗时（毫秒） */
  estimatedDuration: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 投标时间 */
  timestamp: number;
}

// ── 配置 ──

export interface SwarmConfig {
  /** 拍卖超时（毫秒） */
  auctionTimeout?: number;
  /** 默认预算 */
  defaultBudget?: number;
}
