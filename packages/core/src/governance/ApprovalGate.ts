/**
 * ApprovalGate — 审批门
 * v16: Compliance → RiskAssessment → ApprovalGate → Release
 * Stabilization: 增加 ApprovalPolicyRegistry 商业级策略引擎
 */
import { EventBus } from '../infrastructure/common/EventBus.js';
import { EventType } from '../infrastructure/protocol/events/EventType.js';
import type { ComplianceResult } from './ComplianceChecker.js';

export type ApprovalDecision = 'APPROVED' | 'REJECTED' | 'WAIT_HUMAN';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ApprovalAction = 'spend_money' | 'publish_content' | 'delete_data' | 'send_message' | 'modify_system' | 'execute_code' | 'execute_goal';

export interface ApprovalRequest {
  id: string;
  artifactId: string;
  artifactName: string;
  complianceResult: ComplianceResult;
  riskLevel: string;
  summary: string;
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: number;
}

export interface ApprovalPolicy {
  action: ApprovalAction;
  riskLevel: RiskLevel;
  autoApprove: boolean;
  requireHuman: boolean;
  maxAmount?: number;
}

export class ApprovalPolicyRegistry {
  private static policies: ApprovalPolicy[] = [
    { action: 'spend_money', riskLevel: 'LOW', autoApprove: true, requireHuman: false, maxAmount: 10 },
    { action: 'spend_money', riskLevel: 'MEDIUM', autoApprove: true, requireHuman: false, maxAmount: 100 },
    { action: 'spend_money', riskLevel: 'HIGH', autoApprove: false, requireHuman: true, maxAmount: 1000 },
    { action: 'spend_money', riskLevel: 'CRITICAL', autoApprove: false, requireHuman: true },
    { action: 'publish_content', riskLevel: 'LOW', autoApprove: true, requireHuman: false },
    { action: 'publish_content', riskLevel: 'MEDIUM', autoApprove: false, requireHuman: true },
    { action: 'publish_content', riskLevel: 'HIGH', autoApprove: false, requireHuman: true },
    { action: 'publish_content', riskLevel: 'CRITICAL', autoApprove: false, requireHuman: true },
    { action: 'delete_data', riskLevel: 'LOW', autoApprove: false, requireHuman: true },
    { action: 'delete_data', riskLevel: 'MEDIUM', autoApprove: false, requireHuman: true },
    { action: 'delete_data', riskLevel: 'HIGH', autoApprove: false, requireHuman: true },
    { action: 'delete_data', riskLevel: 'CRITICAL', autoApprove: false, requireHuman: true },
    { action: 'execute_code', riskLevel: 'LOW', autoApprove: false, requireHuman: true },
    { action: 'execute_code', riskLevel: 'MEDIUM', autoApprove: false, requireHuman: true },
    { action: 'execute_code', riskLevel: 'HIGH', autoApprove: false, requireHuman: true },
    { action: 'execute_code', riskLevel: 'CRITICAL', autoApprove: false, requireHuman: true },
    { action: 'send_message', riskLevel: 'LOW', autoApprove: true, requireHuman: false },
    { action: 'send_message', riskLevel: 'MEDIUM', autoApprove: true, requireHuman: false },
    { action: 'send_message', riskLevel: 'HIGH', autoApprove: false, requireHuman: true },
    { action: 'send_message', riskLevel: 'CRITICAL', autoApprove: false, requireHuman: true },
    // execute_goal：系统主入口（ControlPlane 对每个 goal 调用）。普通业务目标自动执行；
    // 高风险/关键目标（部署/对外/破坏性）由各自动作策略另行拦截，此处仅作兜底分级。
    { action: 'execute_goal', riskLevel: 'LOW', autoApprove: true, requireHuman: false },
    { action: 'execute_goal', riskLevel: 'MEDIUM', autoApprove: true, requireHuman: false, maxAmount: 5000 },
    { action: 'execute_goal', riskLevel: 'HIGH', autoApprove: false, requireHuman: true },
    { action: 'execute_goal', riskLevel: 'CRITICAL', autoApprove: false, requireHuman: true },
  ];

  /** vNext+ P2：策略修订号（热更新边界 — 策略变更时递增） */
  private static revision = 0;

  static getRevision(): number {
    return ApprovalPolicyRegistry.revision;
  }

  static needsHumanApproval(action: ApprovalAction, riskLevel: RiskLevel, amount?: number): boolean {
    const policy = ApprovalPolicyRegistry.policies.find(p => p.action === action && p.riskLevel === riskLevel);
    if (!policy) return true;
    if (policy.autoApprove && (!amount || !policy.maxAmount || amount <= policy.maxAmount)) return false;
    return policy.requireHuman;
  }

  static register(policy: ApprovalPolicy): void {
    ApprovalPolicyRegistry.policies.push(policy);
    ApprovalPolicyRegistry.revision++;
  }
}

export class ApprovalGate {
  private requests: Map<string, ApprovalRequest> = new Map();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) { this.eventBus = eventBus; }

  requestApproval(artifactId: string, artifactName: string, complianceResult: ComplianceResult, riskLevel: string): ApprovalRequest {
    const summary = complianceResult.pass
      ? `✅ 合规通过 (${complianceResult.checks.filter(c => c.pass).length}/${complianceResult.checks.length})`
      : `❌ 合规失败: ${complianceResult.blockingIssues.join('; ')}`;
    const autoDecision: ApprovalDecision = riskLevel === 'LOW' && complianceResult.pass ? 'APPROVED' : complianceResult.level === 'BLOCK' ? 'WAIT_HUMAN' : riskLevel === 'HIGH' ? 'WAIT_HUMAN' : 'APPROVED';
    const request: ApprovalRequest = { id: `apr_${Date.now()}`, artifactId, artifactName, complianceResult, riskLevel, summary, decision: autoDecision === 'APPROVED' ? 'APPROVED' : undefined, decidedBy: autoDecision === 'APPROVED' ? 'auto' : undefined, decidedAt: autoDecision === 'APPROVED' ? Date.now() : undefined };
    this.requests.set(request.id, request);
    const eventType = autoDecision === 'APPROVED' ? EventType.APPROVAL_AUTO_APPROVED : EventType.APPROVAL_WAIT_HUMAN;
    this.eventBus?.emit({ id: `evt_${Date.now()}`, type: eventType, timestamp: Date.now(), executionId: 'approval', source: 'approval-gate', payload: request });
    return request;
  }

  /** Stabilization: 按策略自动决策 */
  requestApprovalForAction(action: ApprovalAction, riskLevel: RiskLevel, description: string, amount?: number): { approved: boolean; reason: string } {
    const needsHuman = ApprovalPolicyRegistry.needsHumanApproval(action, riskLevel, amount);
    const eventType = needsHuman ? EventType.APPROVAL_WAIT_HUMAN : EventType.APPROVAL_AUTO_APPROVED;
    this.eventBus?.emit({ id: `evt_${Date.now()}`, type: eventType, timestamp: Date.now(), executionId: 'approval', source: 'approval-gate', payload: { action, riskLevel, description, amount } });
    return needsHuman
      ? { approved: false, reason: `需要人工审批 (${action}/${riskLevel})` }
      : { approved: true, reason: `自动批准 (${action}/${riskLevel})` };
  }

  decide(requestId: string, decision: ApprovalDecision, decidedBy: string): boolean {
    const req = this.requests.get(requestId);
    if (!req || req.decision) return false;
    req.decision = decision;
    req.decidedBy = decidedBy;
    req.decidedAt = Date.now();
    return true;
  }

  getPending(): ApprovalRequest[] { return [...this.requests.values()].filter(r => !r.decision); }
  getHistory(): ApprovalRequest[] { return [...this.requests.values()].filter(r => r.decision); }
  getAll(): ApprovalRequest[] { return [...this.requests.values()]; }

  /**
   * waitForDecision — 等待人工审批决策（awaitHuman 模式）
   *
   * ⭐ P0: 阻塞直到审批被决定（外部调用 decide()）
   * 超时返回 WAIT_HUMAN 状态。
   *
   * @param requestId - 审批请求 ID
   * @param timeoutMs - 超时毫秒（默认 30 分钟）
   * @returns 决定的 ApprovalRequest
   */
  async waitForDecision(requestId: string, timeoutMs: number = 1800000): Promise<ApprovalRequest> {
    const req = this.requests.get(requestId);
    if (!req) throw new Error(`审批请求不存在: ${requestId}`);
    if (req.decision) return req;

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const current = this.requests.get(requestId);
      if (current?.decision) return current;
      await new Promise(r => setTimeout(r, 2000));
    }

    return req; // 超时，decision 仍为 undefined
  }
}
