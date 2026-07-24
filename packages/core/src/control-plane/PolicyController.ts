import { ApprovalPolicyRegistry, ApprovalPolicy } from '../verification/ApprovalGate.js';

export class PolicyController {
  checkAction(action: string, riskLevel: string, amount?: number): { allowed: boolean; reason: string } {
    const needsHuman = ApprovalPolicyRegistry.needsHumanApproval(action as any, riskLevel as any, amount);
    if (needsHuman) return { allowed: false, reason: `需要人工审批 (${action}/${riskLevel})` };
    return { allowed: true, reason: '策略允许' };
  }

  registerPolicy(policy: ApprovalPolicy): void {
    ApprovalPolicyRegistry.register(policy);
  }
}
