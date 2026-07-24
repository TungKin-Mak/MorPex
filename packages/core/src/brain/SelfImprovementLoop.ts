/**
 * SelfImprovementLoop — 自我改进循环
 * v16: 分析→提案→模拟→审批（不直接改代码）
 */
import { ImprovementAnalyzer } from './ImprovementAnalyzer.js';
import { EvolutionProposal } from './EvolutionProposal.js';
import type { ImprovementInsight } from './ImprovementAnalyzer.js';
import type { Proposal } from './EvolutionProposal.js';

export interface ProposalSimulator {
  simulate(proposal: Proposal, currentMetrics: Record<string, number>): Promise<{
    estimatedImprovement: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    sideEffects: string[];
    confidence: number;
  }>;
}

export class SelfImprovementLoop {
  private analyzer = new ImprovementAnalyzer();
  private proposalSystem = new EvolutionProposal();
  private simulator?: ProposalSimulator;

  setSimulator(sim: ProposalSimulator): void { this.simulator = sim; }

  async runAnalysis(metrics: {
    taskSuccessRate: number;
    avgLatency: number;
    failurePatterns: string[];
    artifactQuality: number;
  }): Promise<{
    insights: ImprovementInsight[];
    proposals: Array<Proposal & { simulation?: unknown }>;
  }> {
    const insights = this.analyzer.analyze(metrics);
    const proposals: Array<Proposal & { simulation?: unknown }> = [];

    for (const insight of insights) {
      const proposal = this.proposalSystem.create(insight.title, insight.description, insight.estimatedImpact, 'medium');
      let simulationResult = null;
      if (this.simulator) {
        try {
          simulationResult = await this.simulator.simulate(proposal, metrics as unknown as Record<string, number>);
        } catch (err) {
          console.warn('[SelfImprovementLoop] 模拟失败:', (err as Error).message);
        }
      }
      proposals.push({ ...proposal, simulation: simulationResult });
    }
    return { insights, proposals };
  }

  getPendingProposals(): Proposal[] { return this.proposalSystem.getPending(); }
  approveProposal(id: string): boolean { return this.proposalSystem.approve(id); }
}
