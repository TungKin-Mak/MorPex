/**
 * Swarm Plugin — 多 Agent 调度插件
 *
 * 事件协议：
 *   - 监听: 'swarm.create_auction'   ← 发布任务拍卖
 *   - 监听: 'swarm.submit_bid'       ← Agent 投标
 *   - 监听: 'swarm.award'            ← 手动授标
 *   - 监听: 'swarm.cancel'           ← 取消拍卖
 *   - 广播: 'swarm.auction_created'  → 拍卖发布
 *   - 广播: 'swarm.bid_received'     → 收到投标
 *   - 广播: 'swarm.auction_awarded'  → 授标完成
 *   - 广播: 'swarm.auction_expired'  → 拍卖过期
 *   - 广播: 'swarm.stats'            → 统计
 */

import type { MorPexPlugin, PluginContext, EventBus, MorPexEvent } from '../../../common/types.js';
import { SwarmEngine } from './SwarmEngine.js';
import type { SwarmConfig } from './types.js';
import type { ExecutionIdentity } from '../../../common/ExecutionIdentity.js';

export class SwarmPlugin implements MorPexPlugin {
  name = 'swarm-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private engine!: SwarmEngine;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;
    const config = (context.config?.swarm ?? {}) as SwarmConfig;
    this.engine = new SwarmEngine(config);

    this.engine.onAuctionCreated = (a) => this.emitEvent('swarm.auction_created', { auction: a });
    this.engine.onBidReceived = (id, bid) => this.emitEvent('swarm.bid_received', { auctionId: id, bid });
    this.engine.onAuctionAwarded = (id, winner) => this.emitEvent('swarm.auction_awarded', { auctionId: id, winner });
    this.engine.onAuctionExpired = (id) => this.emitEvent('swarm.auction_expired', { auctionId: id });

    this.initialized = true;
    console.log('[SwarmPlugin] 已初始化');
  }

  async start(): Promise<void> {
    if (!this.initialized) throw new Error('必须先 initialize');

    this.unsubscribers.push(this.eventBus.on('swarm.create_auction', (e: MorPexEvent) => {
      const d = e.payload;
      if (d?.taskId) this.engine.createAuction(d);
    }));

    this.unsubscribers.push(this.eventBus.on('swarm.submit_bid', (e: MorPexEvent) => {
      const { auctionId, bid } = e.payload ?? {};
      if (auctionId && bid) this.engine.submitBid(auctionId, bid);
    }));

    this.unsubscribers.push(this.eventBus.on('swarm.award', (e: MorPexEvent) => {
      const id = e.payload?.auctionId;
      if (id) this.engine.award(id);
    }));

    this.unsubscribers.push(this.eventBus.on('swarm.get_stats', () => {
      this.emitEvent('swarm.stats', { stats: this.engine.getStats() });
    }));

    console.log('[SwarmPlugin] 已启动');
  }

  async stop(): Promise<void> {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.engine.dispose();
  }

  getEngine(): SwarmEngine { return this.engine; }

  private emitEvent(type: string, payload: any, executionId?: string): void {
    this.eventBus.emit({
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: executionId ?? 'swarm-plugin',
      source: 'swarm-plugin',
      payload,
    });
  }
}
