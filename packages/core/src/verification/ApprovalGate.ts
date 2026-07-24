/**
 * ApprovalGate — 审批门
 * v16: Compliance → RiskAssessment → ApprovalGate → Release
 * 自动决策(LOW风险+合规通过) 或 等待人工审批
 */
import { EventBus } from '../common/EventBus.js';
import type { ComplianceResult } from './ComplianceChecker.js';

export type ApprovalDecision = 'APPROVED' | 'REJECTED' | 'WAIT_HUMAN';

export interface ApprovalRequest {
  id: string;
  artifactId: string;
  artifactName: string;
  complianceResult: ComplianceResult;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: number;
}

export class ApprovalGate {
  private requests: Map<string, ApprovalRequest> = new Map();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  requestApproval(
    artifactId: string,
    artifactName: string,
    complianceResult: ComplianceResult,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
  ): ApprovalRequest {
    const summary = complianceResult.pass
      ? `✅ 合规通过 (${complianceResult.checks.filter(c => c.pass).length}/${complianceResult.checks.length})`
      : `❌ 合规失败: ${complianceResult.blockingIssues.join('; ')}`;

    const autoDecision: ApprovalDecision =
      riskLevel === 'LOW' && complianceResult.pass ? 'APPROVED'
      : complianceResult.level === 'BLOCK' ? 'WAIT_HUMAN'
      : riskLevel === 'HIGH' ? 'WAIT_HUMAN'
      : 'APPROVED';

    const request: ApprovalRequest = {
      id: `apr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      artifactId,
      artifactName,
      complianceResult,
      riskLevel,
      summary,
      decision: autoDecision === 'APPROVED' ? 'APPROVED' : undefined,
      decidedBy: autoDecision === 'APPROVED' ? 'auto' : undefined,
      decidedAt: autoDecision === 'APPROVED' ? Date.now() : undefined,
    };

    this.requests.set(request.id, request);

    if (this.eventBus) {
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: `approval.${autoDecision === 'APPROVED' ? 'auto_approved' : 'wait_human'}`,
        timestamp: Date.now(),
        executionId: 'approval',
        source: 'approval-gate',
        payload: request,
      });
    }

    return request;
  }

  decide(requestId: string, decision: ApprovalDecision, decidedBy: string): boolean {
    const req = this.requests.get(requestId);
    if (!req || req.decision) return false;
    req.decision = decision;
    req.decidedBy = decidedBy;
    req.decidedAt = Date.now();
    return true;
  }

  getPending(): ApprovalRequest[] {
    return [...this.requests.values()].filter(r => !r.decision);
  }

  getHistory(): ApprovalRequest[] {
    return [...this.requests.values()].filter(r => r.decision);
  }

  getAll(): ApprovalRequest[] {
    return [...this.requests.values()];
  }
}
