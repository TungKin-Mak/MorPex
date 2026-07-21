/**
 * Stage 5: Plan Evaluation (MCDA) — Multi-Criteria Decision Analysis
 *
 * Evaluates candidate plans using alignment, knowledge, stability, latency, and security scores.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import type { IShadowSimulationReport, ICandidatePlansOutput, IntentAnalysisResult, ExperienceQueryResult, IEvaluationScorecard, CandidatePlanProfile } from '../../types.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage5PlanEvaluation(
  ctx: PipelineStageContext,
  simulationReports: IShadowSimulationReport[],
  candidates: ICandidatePlansOutput,
  intent: IntentAnalysisResult,
  experience: ExperienceQueryResult | null,
  sessionId: string,
): Promise<IEvaluationScorecard> {
  const deviationCount = ctx.deviationGuard.getDeviationCount(sessionId);
  return evaluateMCDA(simulationReports, candidates.candidates, intent, experience, deviationCount);
}

/**
 * evaluateMCDA — Multi-criteria decision analysis
 */
function evaluateMCDA(
  simulations: IShadowSimulationReport[],
  candidateProfiles: CandidatePlanProfile[],
  intent: IntentAnalysisResult,
  experience: ExperienceQueryResult | null,
  deviationCount: number,
): IEvaluationScorecard {
  const profiles: IEvaluationScorecard['profiles'] = {} as any;
  let highestScore = 0;
  let winner: 'aggressive' | 'defensive' | 'fallback' = candidateProfiles[0]?.strategy as 'aggressive' | 'defensive' | 'fallback' ?? 'defensive';
  const w = getWeights(deviationCount);

  for (const candidate of candidateProfiles) {
    const sim = simulations.find(s => s.strategy === candidate.strategy);
    if (!sim) continue;

    const alignment = computeAlignmentScore(candidate, intent);
    const knowledge = computeKnowledgeScore(candidate, experience);
    const stability = sim.survivalProbability;
    const latency = Math.max(0, 1 - sim.totalSimulatedLatencyMs / 300000);
    const security = (candidate.dag.nodes.filter(n =>
      n.domain === 'security' || n.description?.toLowerCase().includes('security')
    ).length + 1) / (candidate.dag.nodes.length + 1);

    const composite = alignment * 0.15 + knowledge * 0.10 + stability * w.stabilityWeight + latency * w.latencyWeight + security * 0.05;

    profiles[candidate.strategy] = {
      composite, alignment, knowledge, stability, latency, security, healing: 0.5,
    };

    if (composite > highestScore) {
      highestScore = composite;
      winner = candidate.strategy as 'aggressive' | 'defensive' | 'fallback';
    }
  }

  return {
    evaluationId: `eval_${Date.now().toString(36)}`,
    profiles,
    winner,
    winnerScore: highestScore,
    evaluatedAt: Date.now(),
    weightConfiguration: {
      stability: w.stabilityWeight,
      latency: w.latencyWeight,
      security: w.securityWeight,
      alignment: 0.15,
      healing: 0.1,
      knowledge: 0.1,
    },
    scoreBreakdown: [],
  };
}

function getWeights(deviationCount: number): { stabilityWeight: number; latencyWeight: number; securityWeight: number } {
  if (deviationCount === 0) return { stabilityWeight: 0.3, latencyWeight: 0.3, securityWeight: 0.1 };
  if (deviationCount <= 2) return { stabilityWeight: 0.45, latencyWeight: 0.15, securityWeight: 0.15 };
  return { stabilityWeight: 0.55, latencyWeight: 0.05, securityWeight: 0.2 };
}

export function computeAlignmentScore(candidate: CandidatePlanProfile, intent: IntentAnalysisResult): number {
  const intentDomains = intent.tags.filter(t => t.category === 'domain').map(t => t.tag);
  const planDomains = candidate.dag.involvedDomains ?? [];
  if (intentDomains.length === 0) return 0.5;

  const overlap = intentDomains.filter(d => planDomains.includes(d)).length;
  const domainScore = overlap / intentDomains.length;

  const intentComplexity = intent.targetStateMatrix.complexity as string;
  const planComplexity = candidate.dag.nodes.length > 5 ? 'high' : candidate.dag.nodes.length > 3 ? 'medium' : 'low';
  const complexityScore = intentComplexity === planComplexity ? 0.2 : 0;

  return Math.min(1, domainScore * 0.8 + complexityScore);
}

export function computeKnowledgeScore(candidate: CandidatePlanProfile, experience: ExperienceQueryResult | null): number {
  if (!experience || experience.positiveSamples.length === 0) return 0.3;

  const planRoles = candidate.dag.nodes.map(n => n.taskId);
  let overlapCount = 0;

  for (const sample of experience.positiveSamples) {
    const sampleRoles = sample.dagNodes.map(n => n.role);
    const overlap = planRoles.filter(r => sampleRoles.includes(r)).length;
    if (overlap > 0) overlapCount++;
  }

  return Math.min(1, overlapCount / Math.max(experience.positiveSamples.length, 1));
}
