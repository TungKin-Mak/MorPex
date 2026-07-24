/**
 * PolicyEngine — 统一策略引擎
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
      { id: 'delete-any', action: 'delete_data', riskLevel: 'LOW', decision: 'REQUIRE_APPROVAL', description: '数据删除需要审批' },
      { id: 'modify-any', action: 'modify_system', riskLevel: 'LOW', decision: 'REQUIRE_APPROVAL', description: '系统修改需要审批' },
      { id: 'code-exec', action: 'execute_code', riskLevel: 'LOW', decision: 'REQUIRE_APPROVAL', description: '代码执行需要审批' },
      { id: 'create-agent', action: 'create_agent', riskLevel: 'MEDIUM', decision: 'ALLOW', description: '创建 Agent 自动允许' },
      { id: 'ext-access', action: 'access_external', riskLevel: 'LOW', decision: 'ALLOW', description: '外部 API 访问自动允许' },
    ];
    this.policies.push(...defaults);
  }

  check(action: PolicyAction, riskLevel: RiskLevel, context?: { amount?: number; target?: string }): PolicyCheckResult {
    let matched = this.policies.filter(p => p.action === action && p.riskLevel === riskLevel);
    if (matched.length === 0) {
      matched = this.policies.filter(p => p.action === action);
    }
    if (matched.length === 0) {
      return { decision: 'REQUIRE_APPROVAL', policy: null, reason: `无匹配策略，默认需要审批 (${action}/${riskLevel})` };
    }
    matched.sort((a, b) => {
      const aExact = a.riskLevel === riskLevel ? 1 : 0;
      const bExact = b.riskLevel === riskLevel ? 1 : 0;
      return bExact - aExact;
    });
    const policy = matched[0];
    if (policy.decision === 'DENY') return { decision: 'DENY', policy, reason: `策略禁止: ${policy.description}` };
    if (policy.decision === 'REQUIRE_APPROVAL') {
      const amount = context?.amount || 0;
      if (policy.maxAmount && amount > policy.maxAmount) {
        return { decision: 'REQUIRE_APPROVAL', policy, reason: `超出额度 $${policy.maxAmount}`, requiredApprovers: ['CEO', 'CFO'] };
      }
      return { decision: 'REQUIRE_APPROVAL', policy, reason: policy.description, requiredApprovers: ['CEO'] };
    }
    if (policy.maxAmount && (context?.amount || 0) > policy.maxAmount) {
      return { decision: 'REQUIRE_APPROVAL', policy, reason: `金额 $${context?.amount} 超出自动限额 $${policy.maxAmount}` };
    }
    return { decision: 'ALLOW', policy, reason: policy.description };
  }

  register(policy: Policy): void {
    const idx = this.policies.findIndex(p => p.id === policy.id);
    if (idx >= 0) this.policies[idx] = policy;
    else this.policies.push(policy);
  }

  getAll(): Policy[] { return [...this.policies]; }
}

export const policyEngine = new PolicyEngine();
