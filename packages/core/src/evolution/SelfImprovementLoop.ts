/**
 * SelfImprovementLoop — 自我改进闭环（L7 Evolution 层，Wave 3a 自 cognition/ 迁入，Wave 5 收紧）
 * Phase: Observation → Analysis → Proposal → Simulation → Evaluation → 待审批
 * ⚠️ 边界契约（Wave 5）：本类只产提案，绝不自动审批/晋升——未审批状态只能是 pending；
 *   审批与晋升唯一路径 = L7 EvolutionSandbox.approveAndApply（含 Gate 硬校验 + 完整 Trace），
 *   提案须携带 Simulation 评估结果进入审批，禁止绕过 Sandbox 直接落地。
 */
import { ImprovementAnalyzer } from './ImprovementAnalyzer.js';
import { EvolutionProposal } from './EvolutionProposal.js';
import { SafetyMonitor } from '../cognition/SafetyMonitor.js';
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

export type EvolutionPhase = 'observation' | 'analysis' | 'proposal' | 'simulation' | 'evaluation' | 'approval' | 'monitoring';

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
    /** 验证通过率 0-1（可选） */
    verificationPassRate?: number;
    /** 验证失败的检查点描述列表（可选） */
    failedCheckpoints?: string[];
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
          simulationResult = await this.simulator.simulate(proposal, metrics as unknown as Parameters<typeof this.simulator.simulate>[1]);
        } catch { /* 降级 */ }
      }
      this.transition('evaluation');
      const evalScore = simulationResult
        ? (simulationResult.estimatedImprovement * 0.7) + (simulationResult.confidence * 0.3)
        : 0.5;
      this.transition('approval', '提案待审批（未审批状态只能是 pending，晋升走 EvolutionSandbox）');
      proposals.push({ ...proposal, simulation: simulationResult, evaluation: { score: evalScore, recommended: evalScore >= 0.7 } });
    }

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
}
