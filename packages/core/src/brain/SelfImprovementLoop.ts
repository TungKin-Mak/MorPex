/**
 * SelfImprovementLoop — 自我改进闭环
 * Phase 2: Observation → Analysis → Proposal → Simulation → Evaluation → Approval → Deployment → Monitor
 * 不直接修改代码，只生成提案
 */
import { ImprovementAnalyzer } from './ImprovementAnalyzer.js';
import { EvolutionProposal } from './EvolutionProposal.js';
import { SafetyMonitor } from './SafetyMonitor.js';
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

export type EvolutionPhase = 'observation' | 'analysis' | 'proposal' | 'simulation' | 'evaluation' | 'approval' | 'deployment' | 'monitoring';

export class SelfImprovementLoop {
  private analyzer = new ImprovementAnalyzer();
  private proposalSystem = new EvolutionProposal();
  private safetyMonitor: SafetyMonitor;
  private simulator?: ProposalSimulator;
  private currentPhase: EvolutionPhase = 'observation';
  private phaseHistory: Array<{ phase: EvolutionPhase; timestamp: number; detail: string }> = [];

  constructor(safetyMonitor?: SafetyMonitor) {
    this.safetyMonitor = safetyMonitor || new SafetyMonitor();
  }

  setSimulator(sim: ProposalSimulator): void { this.simulator = sim; }
  getMonitor(): SafetyMonitor { return this.safetyMonitor; }
  getCurrentPhase(): EvolutionPhase { return this.currentPhase; }

  async evolve(metrics: {
    taskSuccessRate: number;
    avgLatency: number;
    failurePatterns: string[];
    artifactQuality: number;
  }): Promise<{
    observations: any[];
    insights: ImprovementInsight[];
    proposals: Array<Proposal & { simulation?: any; evaluation?: any }>;
    phase: EvolutionPhase;
  }> {
    this.transition('observation');
    const observations = this.safetyMonitor.observe({
      taskSuccessRate: metrics.taskSuccessRate,
      avgLatency: metrics.avgLatency,
      retryRate: metrics.failurePatterns.length / Math.max(1, 10),
      artifactQuality: metrics.artifactQuality,
    });

    this.transition('analysis');
    const insights = this.analyzer.analyze(metrics);

    if (insights.length === 0) {
      this.transition('monitoring', '无改进需求');
      return { observations, insights: [], proposals: [], phase: this.currentPhase };
    }

    this.transition('proposal');
    const proposals: Array<Proposal & { simulation?: any; evaluation?: any }> = [];
    for (const insight of insights) {
      const proposal = this.proposalSystem.create(insight.title, insight.description, insight.estimatedImpact, 'medium');
      this.transition('simulation');
      let simulationResult = null;
      if (this.simulator) {
        try {
          simulationResult = await this.simulator.simulate(proposal, metrics as any);
        } catch { /* 降级 */ }
      }
      this.transition('evaluation');
      const evalScore = simulationResult
        ? (simulationResult.estimatedImprovement * 0.7) + (simulationResult.confidence * 0.3)
        : 0.5;
      this.transition('approval');
      if (evalScore >= 0.7) {
        this.proposalSystem.approve(proposal.id);
      }
      proposals.push({ ...proposal, simulation: simulationResult, evaluation: { score: evalScore, autoApproved: evalScore >= 0.7 } });
    }

    this.transition('deployment', `${proposals.filter(p => p.status === 'PENDING_REVIEW').length} 个提案待实施`);
    return { observations, insights, proposals, phase: this.currentPhase };
  }

  private transition(phase: EvolutionPhase, detail?: string): void {
    this.currentPhase = phase;
    this.phaseHistory.push({ phase, timestamp: Date.now(), detail: detail || phase });
  }

  getPhaseHistory(): Array<{ phase: EvolutionPhase; timestamp: number; detail: string }> {
    return [...this.phaseHistory];
  }

  async runAnalysis(metrics: any): Promise<{ insights: any[]; proposals: any[] }> {
    const result = await this.evolve(metrics);
    return { insights: result.insights, proposals: result.proposals };
  }

  getPendingProposals() { return this.proposalSystem.getPending(); }
  approveProposal(id: string) { return this.proposalSystem.approve(id); }
}
