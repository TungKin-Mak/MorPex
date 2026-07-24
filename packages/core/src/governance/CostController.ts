/**
 * CostController — 成本控制器
 * v15: 预算追踪 + 模型等级自动调整 + 动作建议
 */
export class CostController {
  private budget: number = 100;
  private spent: number = 0;
  private modelLevel: 'fast' | 'balanced' | 'quality' = 'balanced';

  setBudget(amount: number): void {
    this.budget = amount;
  }

  recordCost(amount: number): void {
    this.spent += amount;
    this.adjustModel();
  }

  getRemaining(): number {
    return this.budget - this.spent;
  }

  getUsagePercent(): number {
    return (this.spent / this.budget) * 100;
  }

  suggestAction(): string {
    const pct = this.getUsagePercent();
    if (pct > 90) return 'CRITICAL: 暂停非关键任务，请求人工确认';
    if (pct > 75) return 'WARNING: 降低模型等级，暂停非关键 Agent';
    if (pct > 50) return 'INFO: 预算已过半，注意控制';
    return 'OK';
  }

  private adjustModel(): void {
    const pct = this.getUsagePercent();
    this.modelLevel = pct > 75 ? 'fast' : pct > 50 ? 'balanced' : 'quality';
  }
}
