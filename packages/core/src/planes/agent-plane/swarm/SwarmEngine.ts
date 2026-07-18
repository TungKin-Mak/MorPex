/**
 * SwarmEngine — 基于拍卖的多 Agent 调度引擎
 *
 * 任务拍卖流程：
 *   1. 发布任务 → TaskAuction（open）
 *   2. Agent 投标 → AgentBid
 *   3. 到期或手动授标 → 最优分配
 *
 * 最优分配算法：
 *   综合评分 = confidence * 0.4 + (1 - price/budget) * 0.3 + (1 - duration/maxDuration) * 0.3
 */

import type { TaskAuction, AgentBid, AuctionStatus, SwarmConfig } from './types.js';
import { ExecutionIdentity } from '../../../common/ExecutionIdentity.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';

const identity = new ExecutionIdentity();

/** 默认配置 */
const DEFAULT_CONFIG: Required<SwarmConfig> = {
  auctionTimeout: 60_000,
  defaultBudget: 100,
};

/**
 * SwarmEngine — 多 Agent 调度引擎
 */
export class SwarmEngine {
  private auctions: Map<string, TaskAuction> = new Map();
  private config: Required<SwarmConfig>;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  onAuctionCreated: ((auction: TaskAuction) => void) | null = null;
  onBidReceived: ((auctionId: string, bid: AgentBid) => void) | null = null;
  onAuctionAwarded: ((auctionId: string, winnerId: string) => void) | null = null;
  onAuctionExpired: ((auctionId: string) => void) | null = null;

  constructor(config?: SwarmConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 拍卖管理 ──

  /** 发布任务拍卖 */
  createAuction(overrides: {
    taskId: string;
    description: string;
    requiredCapabilities?: string[];
    budget?: number;
    deadline?: number;
  }): TaskAuction {
    const id = `auc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const now = Date.now();

    const auction: TaskAuction = {
      id,
      taskId: overrides.taskId,
      description: overrides.description,
      requiredCapabilities: overrides.requiredCapabilities ?? [],
      budget: overrides.budget ?? this.config.defaultBudget,
      deadline: overrides.deadline ?? now + this.config.auctionTimeout,
      status: 'open',
      bids: [],
      createdAt: now,
    };

    // 检查是否已过期
    if (auction.deadline <= now) {
      auction.status = 'expired';
      this.auctions.set(id, auction);
      this.onAuctionCreated?.(auction);
      this.onAuctionExpired?.(id);
      return auction;
    }

    this.auctions.set(id, auction);

    const timer = setTimeout(() => {
      const a = this.auctions.get(id);
      if (a && a.status === 'open') {
        if (a.bids.length > 0) {
          this.award(id);
        } else {
          a.status = 'expired';
          this.onAuctionExpired?.(id);
        }
      }
    }, auction.deadline - now);
    this.timers.set(id, timer);

    this.onAuctionCreated?.(auction);
    return auction;
  }

  /** Agent 投标 */
  submitBid(auctionId: string, bid: Omit<AgentBid, 'timestamp'>): { success: boolean; error?: string } {
    const auction = this.auctions.get(auctionId);
    if (!auction) return { success: false, error: '拍卖不存在' };
    if (auction.status !== 'open') return { success: false, error: `拍卖已 ${auction.status}` };
    if (Date.now() > auction.deadline) {
      auction.status = 'expired';
      return { success: false, error: '拍卖已过期' };
    }

    const fullBid: AgentBid = { ...bid, timestamp: Date.now() };
    auction.bids.push(fullBid);
    this.onBidReceived?.(auctionId, fullBid);
    return { success: true };
  }

  /** 授标给最优投标 */
  award(auctionId: string): { winner?: AgentBid; auction?: TaskAuction } {
    const auction = this.auctions.get(auctionId);
    if (!auction || auction.status !== 'open') return {};

    const winner = this.selectWinner(auction);
    if (winner) {
      auction.status = 'awarded';
      auction.awardedTo = winner.agentId;
      this.clearTimer(auctionId);
      this.onAuctionAwarded?.(auctionId, winner.agentId);
    } else {
      auction.status = 'expired';
      this.onAuctionExpired?.(auctionId);
    }

    return { winner, auction };
  }

  /** 取消拍卖 */
  cancelAuction(auctionId: string): boolean {
    const auction = this.auctions.get(auctionId);
    if (!auction || auction.status !== 'open') return false;
    auction.status = 'cancelled';
    this.clearTimer(auctionId);
    return true;
  }

  // ── Phase 6: 并发 Zone 执行 ──

  /**
   * runConcurrentZones — 并发调度多个功能区的 Agent
   *
   * 同时向多个 zone 发送消息，等待全部完成或任一失败。
   * 使用 Promise.allSettled 确保不会因单个 zone 失败而阻塞其他 zone。
   *
   * @param zones - 要调度的功能区名称列表
   * @param message - 发送给每个 zone 的消息
   * @param orchestrator - AgentOrchestrator 实例
   * @returns Map<zoneName, { success: boolean; content?: string; error?: string }>
   */
  async runConcurrentZones(
    zones: string[],
    message: string,
    orchestrator: AgentOrchestrator,
  ): Promise<Map<string, { success: boolean; content?: string; error?: string }>> {
    const results = new Map<string, { success: boolean; content?: string; error?: string }>();

    const tasks = zones.map(async (zoneName) => {
      try {
        const result = await orchestrator.dispatch(zoneName, message);
        results.set(zoneName, { success: true, content: result.content });
      } catch (err: any) {
        results.set(zoneName, { success: false, error: err.message });
      }
    });

    await Promise.allSettled(tasks);
    return results;
  }

  // ── 查询 ──

  /** 获取拍卖 */
  getAuction(auctionId: string): TaskAuction | undefined {
    return this.auctions.get(auctionId);
  }

  /** 获取 Agent 的投标历史 */
  getAgentBids(agentId: string): Array<{ auctionId: string; bid: AgentBid }> {
    const result: Array<{ auctionId: string; bid: AgentBid }> = [];
    for (const [auctionId, auction] of this.auctions) {
      for (const bid of auction.bids) {
        if (bid.agentId === agentId) {
          result.push({ auctionId, bid });
        }
      }
    }
    return result;
  }

  /** 获取活跃拍卖 */
  getActiveAuctions(): TaskAuction[] {
    return [...this.auctions.values()].filter(a => a.status === 'open');
  }

  /** 获取统计 */
  getStats(): { total: number; awarded: number; expired: number; active: number } {
    const all = [...this.auctions.values()];
    return {
      total: all.length,
      awarded: all.filter(a => a.status === 'awarded').length,
      expired: all.filter(a => a.status === 'expired').length,
      active: all.filter(a => a.status === 'open').length,
    };
  }

  // ── 内部 ──

  /** 选择最优投标 */
  private selectWinner(auction: TaskAuction): AgentBid | undefined {
    if (auction.bids.length === 0) return undefined;

    let bestBid = auction.bids[0];
    let bestScore = this.calculateScore(bestBid, auction);

    for (let i = 1; i < auction.bids.length; i++) {
      const score = this.calculateScore(auction.bids[i], auction);
      if (score > bestScore) {
        bestBid = auction.bids[i];
        bestScore = score;
      }
    }

    return bestBid;
  }

  /** 计算投标综合评分 */
  private calculateScore(bid: AgentBid, auction: TaskAuction): number {
    const confidenceScore = bid.confidence * 0.4;
    const priceScore = (1 - bid.price / auction.budget) * 0.3;
    const durationScore = (1 - bid.estimatedDuration / Math.max(auction.deadline - Date.now(), 1)) * 0.3;
    return confidenceScore + Math.max(0, priceScore) + Math.max(0, durationScore);
  }

  private clearTimer(auctionId: string): void {
    const timer = this.timers.get(auctionId);
    if (timer) { clearTimeout(timer); this.timers.delete(auctionId); }
  }

  dispose(): void {
    for (const [id] of this.timers) this.clearTimer(id);
    this.auctions.clear();
  }
}
