import { EventBus } from '../common/EventBus.js';

export class CostController {
  private static instance: CostController;
  private budgets: Map<string, number> = new Map();
  private spent: Map<string, number> = new Map();

  static getInstance(): CostController {
    if (!CostController.instance) CostController.instance = new CostController();
    return CostController.instance;
  }

  init(eventBus: EventBus): void {
    eventBus.on('execution.engine.completed', (e: any) => {
      const cost = e.payload?.duration ? e.payload.duration * 0.0001 : 0;
      this.recordCost('global', cost);
    });
  }

  setBudget(scope: string, amount: number): void { this.budgets.set(scope, amount); }
  recordCost(scope: string, amount: number): void {
    this.spent.set(scope, (this.spent.get(scope) || 0) + amount);
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

  suggestAction(scope: string): string {
    const usage = this.getUsage(scope);
    if (usage.percent > 90) return 'CRITICAL: 暂停非关键任务，请求人工确认';
    if (usage.percent > 75) return 'WARNING: 降低模型等级，暂停非关键 Agent';
    if (usage.percent > 50) return 'INFO: 预算已过半，注意控制';
    return 'OK';
  }
}
