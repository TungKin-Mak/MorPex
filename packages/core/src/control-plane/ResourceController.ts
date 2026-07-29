/**
 * ResourceController — 资源控制器
 *
 * ═══ v16 重构 ═══
 * - 整合 CostController + RuntimeManager + CapabilityRegistry
 * - 提供资源配额跟踪
 */

import { CostController } from '../governance/CostController.js';
import { RuntimeManager } from '../governance/RuntimeManager.js';
import { CapabilityRegistry } from '../capability/CapabilityRegistry.js';

export interface ResourceBudget {
  budget: number;
  spent: number;
  remaining: number;
  percent: number;
}

export interface ResourceAvailability {
  available: boolean;
  reason?: string;
  estimatedCost: number;
  budgetStatus: ResourceBudget;
  memoryAvailable: boolean;
  executionSlots: number;
}

export class ResourceController {
  private costController = CostController.getInstance();
  private runtimeManager = RuntimeManager.getInstance();
  private _quotas: Map<string, { limit: number; used: number }> = new Map();

  /**
   * canAllocate — 检查是否可以分配资源
   */
  canAllocate(estimatedCost: number): boolean {
    const usage = this.costController.getUsage('global');
    if (usage.budget > 0 && usage.spent + estimatedCost > usage.budget) return false;
    return this.runtimeManager.isResourceAvailable('execution', 10);
  }

  /**
   * checkAvailability — 完整资源可用性检查
   */
  checkAvailability(estimatedCost: number, executionSlots: number = 1): ResourceAvailability {
    const usage = this.costController.getUsage('global');
    const slotsAvailable = this.runtimeManager.isResourceAvailable('execution', executionSlots);
    const memAvailable = this.runtimeManager.isResourceAvailable('memory', 1);

    const budgetOk = usage.budget <= 0 || usage.spent + estimatedCost <= usage.budget;

    return {
      available: budgetOk && slotsAvailable && memAvailable,
      estimatedCost,
      budgetStatus: usage,
      memoryAvailable: memAvailable,
      executionSlots: slotsAvailable ? 10 : 0,
      reason: budgetOk
        ? slotsAvailable
          ? '资源充足'
          : '执行槽位不足'
        : `预算不足 (已用 $${usage.spent}/${usage.budget})`,
    };
  }

  /**
   * getBudgetStatus — 获取预算状态
   */
  getBudgetStatus(): ResourceBudget {
    return this.costController.getUsage('global');
  }

  /**
   * setQuota — 设置部门/能力配额
   */
  setQuota(key: string, limit: number): void {
    this._quotas.set(key, { limit, used: 0 });
  }

  /**
   * useQuota — 消耗配额
   */
  useQuota(key: string, amount: number): boolean {
    const q = this._quotas.get(key);
    if (!q) return true; // 无配额限制
    if (q.used + amount > q.limit) return false;
    q.used += amount;
    return true;
  }
}
