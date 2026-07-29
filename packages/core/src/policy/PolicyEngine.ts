/**
 * @deprecated 请使用 packages/core/src/control/PolicyEngine.ts
 *
 * PolicyEngine — 统一策略引擎（旧版，保留向后兼容）
 * Phase 2: 统一 control/PolicyEngine + verification/ApprovalPolicyRegistry + runtime/approval/ApprovalEngine
 */
export type PolicyAction = 'spend_money' | 'publish_content' | 'delete_data' | 'send_message' | 'modify_system' | 'execute_code' | 'create_agent' | 'modify_mission' | 'access_external';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PolicyDecision = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface Policy {
  id: string;
  action: PolicyAction;
  riskLevel: RiskLevel;
  decision: PolicyDecision;
  conditions?: Array<{ field: string; operator: 'eq' | 'lt' | 'gt' | 'contains'; value: unknown }>;
  maxAmount?: number;
  description: string;
}

export interface PolicyCheckResult {
  decision: PolicyDecision;
  policy: Policy | null;
  reason: string;
  requiredApprovers?: string[];
}

export class PolicyEngine {
  private policies: Policy[] = [];

  constructor() {
    this.loadDefaults();
  }

  private loadDefaults(): void {
    const defaults: Policy[] = [
      { id: 'spend-low', action: 'spend_money', riskLevel: 'LOW', decision: 'ALLOW', maxAmount: 10, description: '小额支出自动允许' },
      { id: 'spend-medium', action: 'spend_money', riskLevel: 'MEDIUM', decision: 'ALLOW', maxAmount: 100, description: '中等额度支出自动允许' },
      { id: 'spend-high', action: 'spend_money', riskLevel: 'HIGH', decision: 'REQUIRE_APPROVAL', maxAmount: 1000, description: '大额支出需要审批' },
      { id: 'spend-critical', action: 'spend_money', riskLevel: 'CRITICAL', decision: 'REQUIRE_APPROVAL', description: '重大支出需要审批' },
      { id: 'pub-low', action: 'publish_content', riskLevel: 'LOW', decision: 'ALLOW', description: '低风险内容自动发布' },
      { id: 'pub-medium', action: 'publish_content', riskLevel: 'MEDIUM', decision: 'REQUIRE_APPROVAL', description: '中等风险内容需要审批' },
      { id: 'pub-high', action: 'publish_content', riskLevel: 'HIGH', decision: 'REQUIRE_APPROVAL', description: '高风险内容需要审批' },
      { id: 'pub-critical', action: 'publish_content', riskLevel: 'CRITICAL', decision: 'REQUIRE_APPROVAL', description: '重大发布需要审批' },
      { id: 'del-low', action: 'delete_data', riskLevel: 'LOW', decision: 'REQUIRE_APPROVAL', description: '数据删除需要审批' },
      { id: 'exec-low', action: 'execute_code', riskLevel: 'LOW', decision: 'REQUIRE_APPROVAL', description: '代码执行需要审批' },
      { id: 'msg-low', action: 'send_message', riskLevel: 'LOW', decision: 'ALLOW', description: '消息发送自动允许' },
    ];

    for (const p of defaults) this.addPolicy(p);
  }

  addPolicy(policy: Policy): void {
    const existing = this.policies.findIndex(p => p.id === policy.id);
    if (existing >= 0) {
      this.policies[existing] = policy;
    } else {
      this.policies.push(policy);
    }
  }

  evaluate(action: PolicyAction, context?: { riskLevel?: RiskLevel; amount?: number }): PolicyCheckResult {
    const level = context?.riskLevel || 'LOW';
    const matching = this.policies.filter(p => p.action === action && p.riskLevel === level);

    if (matching.length === 0) {
      return { decision: 'DENY', policy: null, reason: `无匹配策略 (${action}/${level})` };
    }

    // 按优先级：REQUIRE_APPROVAL > DENY > ALLOW
    const sorted = [...matching].sort((a, b) => {
      const order = { 'REQUIRE_APPROVAL': 0, 'DENY': 1, 'ALLOW': 2 };
      return (order[a.decision] ?? 3) - (order[b.decision] ?? 3);
    });

    const policy = sorted[0];
    if (policy.maxAmount && context?.amount && context.amount > policy.maxAmount) {
      return { decision: 'REQUIRE_APPROVAL', policy, reason: `超出额度限制: $${context.amount} > $${policy.maxAmount}` };
    }

    return { decision: policy.decision, policy, reason: policy.description };
  }

  getPolicies(): Policy[] {
    return [...this.policies];
  }
}

/** @deprecated 使用新的 PolicyEngine 实例 */
export const policyEngine = new PolicyEngine();
