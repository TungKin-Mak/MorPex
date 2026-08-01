/**
 * PolicyController — 策略控制器
 *
 * ═══ v16 重构 ═══
 * - 整合 ApprovalPolicyRegistry + budget checks
 * - 提供 checkAction/reserveBudget/checkResource 方法
 */

import { ApprovalPolicyRegistry, type ApprovalAction, type RiskLevel, type ApprovalPolicy } from '../../governance/ApprovalGate.js';
import { CostController } from '../../governance/CostController.js';

export interface PolicyCheckResult {
  allowed: boolean;
  reason: string;
  requiresHuman?: boolean;
  deny?: boolean;
}

export class PolicyController {
  private costController = CostController.getInstance();

  /**
   * capturePolicySnapshot — 捕获当前策略修订快照（热更新边界）
   *
   * vNext+ P2：Mission 启动时捕获；运行中 Mission 使用启动时快照，
   * 避免策略热更新导致行为突变不可解释。
   */
  capturePolicySnapshot(): { revision: number; capturedAt: number } {
    return { revision: ApprovalPolicyRegistry.getRevision(), capturedAt: Date.now() };
  }

  /**
   * hasPolicyChanged — 检测策略是否已偏离快照（供运行中 Mission 判断是否需要显式重启）
   */
  hasPolicyChanged(snapshot: { revision: number }): boolean {
    return snapshot.revision !== ApprovalPolicyRegistry.getRevision();
  }

  /**
   * getPolicyRevision — 当前策略修订号
   */
  getPolicyRevision(): number {
    return ApprovalPolicyRegistry.getRevision();
  }

  /**
   * checkAction — 检查动作是否允许
   */
  checkAction(action: string, riskLevel: string, amount?: number, snapshot?: { revision: number }): PolicyCheckResult {
    // 热更新边界：若传入快照且策略已变更，明确标记（调用方可决定阻断/重评）
    if (snapshot && this.hasPolicyChanged(snapshot)) {
      return {
        allowed: true,
        reason: '策略已变更（新 mission 将采用新策略），运行中任务按启动快照继续',
        requiresHuman: false,
      };
    }
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
