import { EventBus } from '../infrastructure/common/EventBus.js';

/**
 * CostController — 全链路成本控制（⑤ CostController 全链路计费）
 *
 * 计费来源（全链路）：
 *   1. 时长成本：execution.engine.completed（历史行为，duration×单价，保留兼容）
 *   2. 真实 token：execution.gate.token_usage 事件（Gate 两阶段 + 规则重试 + 语义复核，
 *      payload.tokens 为精确 usage.total 优先；orchestrator 编排 LLM 同事件）
 *
 * scope 约定：'global' 总账；'gate:<domain>' 按域 Gate 账；'orchestrator' 编排账。
 */
export class CostController {
  private static instance: CostController;
  private budgets: Map<string, number> = new Map();
  private spent: Map<string, number> = new Map();
  private spentTokens: Map<string, number> = new Map();
  /** 单价（美元/千 token）；未配置 → 仅累计 token 数不折算金额 */
  private tokenPricePerK: Map<string, number> = new Map();

  static getInstance(): CostController {
    if (!CostController.instance) CostController.instance = new CostController();
    return CostController.instance;
  }

  /** 重置单例（测试隔离用） */
  static resetInstance(): void {
    CostController.instance = new CostController();
  }

  init(eventBus: EventBus): void {
    eventBus.on('execution.engine.completed', (e: any) => {
      const cost = e.payload?.duration ? e.payload.duration * 0.0001 : 0;
      this.recordCost('global', cost);
    });
    // ⑤ 全链路：真实 token 事件（Gate 两阶段/规则重试/语义复核/orchestrator 编排）
    eventBus.on('execution.gate.token_usage', (e: any) => {
      const tokens = Number(e.payload?.tokens) || 0;
      const domain = typeof e.payload?.domain === 'string' ? e.payload.domain : 'global';
      if (tokens > 0) {
        this.recordTokens('global', tokens);
        if (domain && domain !== 'global') this.recordTokens(`gate:${domain}`, tokens);
      }
    });
  }

  setBudget(scope: string, amount: number): void { this.budgets.set(scope, amount); }

  /** 设置 token 单价（美元/千 token；未设置则只累计 token 数） */
  setTokenPrice(scope: string, pricePerK: number): void { this.tokenPricePerK.set(scope, pricePerK); }

  recordCost(scope: string, amount: number): void {
    this.spent.set(scope, (this.spent.get(scope) || 0) + amount);
  }

  /** ⑤ 全链路：记录真实 token 用量（usage.total 优先，调用方已归一化） */
  recordTokens(scope: string, tokens: number): void {
    if (tokens <= 0) return;
    this.spentTokens.set(scope, (this.spentTokens.get(scope) || 0) + tokens);
  }

  getUsage(scope: string): { budget: number; spent: number; remaining: number; percent: number } {
    const b = this.budgets.get(scope) || Infinity;
    const s = this.spent.get(scope) || 0;
    return {
      budget: b === Infinity ? 0 : b, spent: s,
      remaining: Math.max(0, b - s),
      percent: b > 0 ? (s / b) * 100 : 0,
    };
  }

  /** ⑤：token 用量（含折算金额：tokenPricePerK 配置时） */
  getTokenUsage(scope: string): { tokens: number; cost: number } {
    const tokens = this.spentTokens.get(scope) || 0;
    const price = this.tokenPricePerK.get(scope) ?? this.tokenPricePerK.get('global');
    return { tokens, cost: price ? (tokens / 1000) * price : 0 };
  }

  /** ⑤：全链路汇总（时长成本 + token 折算） */
  getTotalCost(scope: string): number {
    return (this.spent.get(scope) || 0) + this.getTokenUsage(scope).cost;
  }

  suggestAction(scope: string): string {
    const usage = this.getUsage(scope);
    if (usage.percent > 90) return 'CRITICAL: 暂停非关键任务，请求人工确认';
    if (usage.percent > 75) return 'WARNING: 降低模型等级，暂停非关键 Agent';
    if (usage.percent > 50) return 'INFO: 预算已过半，注意控制';
    return 'OK';
  }
}
