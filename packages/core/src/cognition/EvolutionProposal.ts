export interface Proposal {
  id: string;
  title: string;
  description: string;
  impact: string;
  effort: 'small' | 'medium' | 'large';
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTED';
  createdAt: number;
}

export class EvolutionProposal {
  private proposals: Proposal[] = [];

  create(title: string, description: string, impact: string, effort: 'small' | 'medium' | 'large'): Proposal {
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
