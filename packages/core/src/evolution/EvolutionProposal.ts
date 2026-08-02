/** L7 Evolution 层 — EvolutionProposal（Wave 3a 自 cognition/ 迁入）
 * 提案数据模型：创建后状态必须为 pending，晋升由 L7 管线控制。
 * Wave 3b：创建入口 tier-0/1 必须持有 KnowledgeContextPackage（Gate 硬拦截）。 */
import { requireKnowledgeContext, type KnowledgeContextPackage } from '../gate/context.js';
import type { RiskTier } from '../gate/types.js';
export interface Proposal {
  id: string;
  title: string;
  description: string;
  impact: string;
  effort: 'small' | 'medium' | 'large';
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTED';
  createdAt: number;
}

export interface ProposalCreateOptions {
  /** Gate 凭证：tier-0/1 提案创建必须持有，缺失抛 GateContextRequiredError */
  gateContext?: KnowledgeContextPackage;
  /** 风险分级：tier-0/1 强制要求 Gate 凭证；默认 tier-2（草稿） */
  riskTier?: RiskTier;
}

export class EvolutionProposal {
  private proposals: Proposal[] = [];

  create(
    title: string,
    description: string,
    impact: string,
    effort: 'small' | 'medium' | 'large',
    options?: ProposalCreateOptions,
  ): Proposal {
    // Wave 3b：tier-0/1 提案创建必须持有 Gate 凭证（缺失直接抛错）
    const riskTier = options?.riskTier ?? 'tier-2';
    if (riskTier === 'tier-0' || riskTier === 'tier-1') {
      requireKnowledgeContext(options?.gateContext, `EvolutionProposal.create(${title})`);
    }

    const p: Proposal = {
      id: `prop_${Date.now()}`,
      title,
      description,
      impact,
      effort,
      status: 'DRAFT',
      createdAt: Date.now(),
    };
    this.proposals.push(p);
    return p;
  }

  submitForReview(id: string): boolean {
    const p = this.proposals.find(p => p.id === id);
    if (!p || p.status !== 'DRAFT') return false;
    p.status = 'PENDING_REVIEW';
    return true;
  }

  approve(id: string): boolean {
    const p = this.proposals.find(p => p.id === id);
    if (!p || p.status !== 'PENDING_REVIEW') return false;
    p.status = 'APPROVED';
    return true;
  }

  reject(id: string): boolean {
    const p = this.proposals.find(p => p.id === id);
    if (!p) return false;
    p.status = 'REJECTED';
    return true;
  }

  getPending(): Proposal[] {
    return this.proposals.filter(p => p.status === 'DRAFT' || p.status === 'PENDING_REVIEW');
  }

  getAll(): Proposal[] {
    return [...this.proposals];
  }
}
