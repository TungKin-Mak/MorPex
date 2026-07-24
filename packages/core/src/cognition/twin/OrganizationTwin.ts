/**
 * OrganizationTwin — 组织孪生
 * Phase 2: 模拟虚拟公司的组织结构、角色决策、协作策略
 * 复用 BehaviorTwin/DecisionTwin/PreferenceModel 作为个体基础
 */
import { BehaviorTwin } from './BehaviorTwin.js';
import { DecisionTwin } from '../decision/DecisionTwin.js';
import { PreferenceModel } from './PreferenceModel.js';

export interface OrgRole {
  roleId: string;
  title: 'CEO' | 'CTO' | 'CMO' | 'CFO' | 'COO' | 'Lead';
  department: string;
  preferences: Record<string, number>;
  twin: { behavior: BehaviorTwin; decisions: DecisionTwin; preferences: PreferenceModel };
}

export interface OrgDecision {
  decisionId: string;
  title: string;
  description: string;
  proposedBy: string;
  requiredApprovals: string[];
  approvedBy: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  simulatedOutcome?: string;
}

export class OrganizationTwin {
  private roles: Map<string, OrgRole> = new Map();
  private decisions: Map<string, OrgDecision> = new Map();
  private simulationHistory: Array<{ scenario: string; outcome: string; timestamp: number }> = [];

  constructor() {
    this.initializeDefaultRoles();
  }

  private initializeDefaultRoles(): void {
    const roles = [
      { title: 'CEO' as const, department: 'executive', riskTolerance: 0.6, innovationPreference: 0.7 },
      { title: 'CTO' as const, department: 'engineering', riskTolerance: 0.4, innovationPreference: 0.8 },
      { title: 'CMO' as const, department: 'marketing', riskTolerance: 0.5, innovationPreference: 0.6 },
      { title: 'CFO' as const, department: 'finance', riskTolerance: 0.3, innovationPreference: 0.3 },
    ];
    for (const r of roles) {
      this.addRole({
        roleId: `role_${r.title}`, title: r.title, department: r.department,
        preferences: { riskTolerance: r.riskTolerance, innovationPreference: r.innovationPreference },
        twin: { behavior: new BehaviorTwin(), decisions: new DecisionTwin(null as any), preferences: new PreferenceModel() },
      });
    }
  }

  addRole(role: OrgRole): void { this.roles.set(role.roleId, role); }
  getRole(roleId: string): OrgRole | undefined { return this.roles.get(roleId); }
  getRoleByTitle(title: string): OrgRole | undefined {
    return [...this.roles.values()].find(r => r.title === title);
  }

  simulateDecision(title: string, description: string, proposedByTitle: string, riskLevel: OrgDecision['riskLevel']): OrgDecision {
    const proposer = this.getRoleByTitle(proposedByTitle);
    const decision: OrgDecision = {
      decisionId: `dec_${Date.now()}`, title, description,
      proposedBy: proposer?.roleId || 'unknown',
      requiredApprovals: this.getRequiredApprovals(riskLevel, proposedByTitle),
      approvedBy: [], status: 'PENDING', createdAt: Date.now(), riskLevel,
    };
    for (const approverId of decision.requiredApprovals) {
      const approver = this.roles.get(approverId);
      if (!approver) continue;
      const riskTolerance = approver.preferences.riskTolerance || 0.5;
      const riskMap = { LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8, CRITICAL: 0.95 };
      const riskValue = riskMap[riskLevel] || 0.5;
      if (riskValue <= riskTolerance + 0.2) {
        decision.approvedBy.push(approverId);
      }
    }
    decision.status = decision.approvedBy.length >= decision.requiredApprovals.length ? 'APPROVED' : 'REJECTED';
    decision.simulatedOutcome = this.simulateOutcome(title, riskLevel, decision.status);
    this.decisions.set(decision.decisionId, decision);
    this.simulationHistory.push({
      scenario: title, outcome: `${decision.status} (${decision.approvedBy.length}/${decision.requiredApprovals.length})`, timestamp: Date.now(),
    });
    return decision;
  }

  simulateGoToMarket(product: string, _market: string, budget: number): {
    recommended: 'GO' | 'REVISIT' | 'CANCEL';
    confidence: number;
    roleVotes: Array<{ role: string; vote: string; reason: string }>;
  } {
    const roleVotes = [
      { role: 'CEO', vote: budget > 50000 ? 'GO' : 'REVISIT', reason: budget > 50000 ? '有足够预算' : '预算有限需谨慎' },
      { role: 'CTO', vote: 'GO', reason: '技术可行性高' },
      { role: 'CMO', vote: 'GO', reason: '市场规模足够' },
      { role: 'CFO', vote: budget > 100000 ? 'GO' : 'REVISIT', reason: 'ROI 在可接受范围' },
    ];
    const goVotes = roleVotes.filter(v => v.vote === 'GO').length;
    const confidence = goVotes / roleVotes.length;
    return {
      recommended: confidence >= 0.75 ? 'GO' : confidence >= 0.5 ? 'REVISIT' : 'CANCEL',
      confidence: Math.round(confidence * 100) / 100,
      roleVotes,
    };
  }

  getSimulationHistory() { return [...this.simulationHistory]; }

  private getRequiredApprovals(riskLevel: OrgDecision['riskLevel'], proposedByTitle: string): string[] {
    const allRoles = [...this.roles.values()].map(r => r.roleId);
    if (riskLevel === 'CRITICAL') return allRoles;
    if (riskLevel === 'HIGH') return allRoles.filter(r => !r.includes('CMO'));
    if (riskLevel === 'MEDIUM') return allRoles.filter(r => r.includes('CEO') || r.includes(proposedByTitle === 'CTO' ? 'CTO' : 'CMO'));
    return [];
  }

  private simulateOutcome(_title: string, riskLevel: string, status: string): string {
    if (status === 'REJECTED') return '计划被否决，需要重新制定策略';
    const riskMap: Record<string, string> = {
      LOW: '大概率顺利执行',
      MEDIUM: '有一定风险，需要监控',
      HIGH: '高风险高回报，需要准备应急预案',
      CRITICAL: '改变公司方向的决策',
    };
    return riskMap[riskLevel] || '继续执行';
  }
}
