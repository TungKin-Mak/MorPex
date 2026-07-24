import { CostController } from '../governance/CostController.js';
import { RuntimeManager } from '../governance/RuntimeManager.js';

export class ResourceController {
  private costController = CostController.getInstance();
  private runtimeManager = RuntimeManager.getInstance();

  canAllocate(estimatedCost: number): boolean {
    const usage = this.costController.getUsage('global');
    if (usage.budget > 0 && usage.spent + estimatedCost > usage.budget) return false;
    return this.runtimeManager.isResourceAvailable('execution', 10);
  }

  getBudgetStatus(): { budget: number; spent: number; remaining: number; percent: number } {
    return this.costController.getUsage('global');
  }
}
