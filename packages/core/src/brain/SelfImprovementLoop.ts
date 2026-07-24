/**
 * SelfImprovementLoop — 自我改进循环
 * v15: 分析系统指标 → 生成改进提案 → 人工审批 → 实施
 *
 * 安全设计：
 *   - 不直接修改代码
 *   - 只生成提案（ImprovementProposal）
 *   - 需要人工审批后才能实施
 *   - 实施通过 Migration 机制进行
 */
import { ImprovementAnalyzer } from './ImprovementAnalyzer.js';
import { EvolutionProposal } from './EvolutionProposal.js';
import type { ImprovementInsight } from './ImprovementAnalyzer.js';
import type { Proposal } from './EvolutionProposal.js';

export class SelfImprovementLoop {
  private analyzer = new ImprovementAnalyzer();
  private proposalSystem = new EvolutionProposal();

  runAnalysis(metrics: {
    taskSuccessRate: number;
    avgLatency: number;
    failurePatterns: string[];
    artifactQuality: number;
  }): { insights: ImprovementInsight[]; proposals: Proposal[] } {
    const insights = this.analyzer.analyze(metrics);
    const proposals = insights.map(i =>
      this.proposalSystem.create(i.title, i.description, i.estimatedImpact, 'medium'),
    );
    return { insights, proposals };
  }

  getPendingProposals(): Proposal[] {
    return this.proposalSystem.getPending();
  }

  submitProposal(id: string): boolean {
    return this.proposalSystem.submitForReview(id);
  }

  approveProposal(id: string): boolean {
    return this.proposalSystem.approve(id);
  }

  rejectProposal(id: string): boolean {
    return this.proposalSystem.reject(id);
  }
}
