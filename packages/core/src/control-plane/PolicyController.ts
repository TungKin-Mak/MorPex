/**
 * PolicyController — 策略控制器
 *
 * ═══ v16 重构 ═══
 * - 整合 ApprovalPolicyRegistry + budget checks
 * - 提供 checkAction/reserveBudget/checkResource 方法
 */

import { ApprovalPolicyRegistry, type ApprovalAction, type RiskLevel, type ApprovalPolicy } from '../verification/ApprovalGate.js';
import { CostController } from '../governance/CostController.js';

export interface PolicyCheckResult {
  allowed: boolean;
  reason: string;
  requiresHuman?: boolean;
  deny?: boolean;
}

export class PolicyController {
  private costController = CostController.getInstance();

  /**
   * checkAction — 检查动作是否允许
   */
  checkAction(action: string, riskLevel: string, amount?: number): PolicyCheckResult {
    const needsHuman = ApprovalPolicyRegistry.needsHumanApproval(
      action as ApprovalAction,
      riskLevel as RiskLevel,
      amount,
    );

    if (needsHuman) {
      return {
        allowed: false,
        reason: `需要人工审批 (${action}/${riskLevel})`,
        requiresHuman: true,
      };
    }

    // 预算检查
    if (amount && amount > 0) {
      const usage = this.costController.getUsage('global');
      if (usage.budget > 0 && usage.spent + amount > usage.budget) {
        return {
          allowed: false,
          reason: `预算不足: 需要 $${amount}, 可用 $${usage.budget - usage.spent}`,
          requiresHuman: false,
        };
      }
    }

    return {
      allowed: true,
      reason: '策略允许',
      requiresHuman: false,
    };
  }

  /**
   * evaluate — 统一策略评估入口（异步）
   */
  async evaluate(input: { action: string; goal: string; actor?: string }): Promise<PolicyCheckResult> {
    return this.checkAction(input.action, 'MEDIUM');
  }

  /**
   * registerPolicy — 注册自定义策略
   */
  registerPolicy(policy: ApprovalPolicy): void {
    ApprovalPolicyRegistry.register(policy);
  }

  /**
   * checkGoalPolicy — 目标级策略检查
   */
  checkGoalPolicy(goal: string, domain?: string): PolicyCheckResult {
    // 敏感领域额外检查
    const sensitiveDomains = ['finance', 'legal', 'hr', 'production', 'healthcare'];
    if (domain && sensitiveDomains.includes(domain.toLowerCase())) {
      return {
        allowed: false,
        reason: `领域 "${domain}" 需要人工审批`,
        requiresHuman: true,
      };
    }

    return { allowed: true, reason: '策略允许' };
  }
}
