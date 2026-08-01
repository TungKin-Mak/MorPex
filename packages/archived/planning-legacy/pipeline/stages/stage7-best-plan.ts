/**
 * Stage 7: Best Plan Selection & Activation — Final gatekeeper
 *
 * Applies risk appetite regulation to override aggressive plans when
 * deviations are detected, then registers resource tokens and activates.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import type { IEvaluationScorecard, IShadowSimulationReport, ICandidatePlansOutput, DecisionTrace, PlanActivationResult, SemanticTag } from '../../types.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage7BestPlanSelection(
  ctx: PipelineStageContext,
  scorecard: IEvaluationScorecard,
  decisionTrace: DecisionTrace,
  candidates: ICandidatePlansOutput,
  simulations: IShadowSimulationReport[],
  sessionId: string,
  executionId: string,
): Promise<PlanActivationResult> {
  const deviationCount = ctx.deviationGuard.getDeviationCount(sessionId);

  // Risk Appetite Regulator
  if (deviationCount > 0) {
    if (scorecard.winner === 'aggressive') {
      const defensiveScore = scorecard.profiles.defensive.composite;
      const fallbackScore = scorecard.profiles.fallback.composite;

      if (defensiveScore >= scorecard.winnerScore * 0.7) {
        (scorecard as any).winner = 'defensive';
        (scorecard as any).winnerScore = defensiveScore;
        decisionTrace.winnerSelection.profile = 'defensive';
        decisionTrace.winnerSelection.rationale += ` | OVERRIDE: deviationCount=${deviationCount} triggered stability preference`;
      } else if (fallbackScore >= scorecard.winnerScore * 0.5) {
        (scorecard as any).winner = 'fallback';
        (scorecard as any).winnerScore = fallbackScore;
        decisionTrace.winnerSelection.profile = 'fallback';
        decisionTrace.winnerSelection.rationale += ` | OVERRIDE: deviationCount=${deviationCount} triggered fallback preference`;
      }
    }
  }

  const winnerCandidate = candidates.candidates.find(c => c.strategy === scorecard.winner);
  if (!winnerCandidate) {
    throw new Error(`Winner profile "${scorecard.winner}" not found in candidates`);
  }

  const resourceTokens: string[] = [];

  return {
    activatedPlan: winnerCandidate,
    decisionTrace,
    resourceTokens,
    readyForExecution: true,
  };
}

export function buildFallbackActivation(
  candidates: ICandidatePlansOutput | null,
  decisionTrace: DecisionTrace,
  executionId: string,
): PlanActivationResult {
  let winner = candidates?.candidates.find(c => c.strategy === 'defensive')
    ?? candidates?.candidates[0];

  if (!winner) {
    winner = {
      profileId: `profile_fallback_${executionId}_${Date.now()}`,
      strategy: 'defensive',
      dag: { nodes: [], isMultiDomain: false, involvedDomains: [], domainDependencies: [], globalIntent: '', reasoning: 'Emergency fallback' },
      rationale: 'Emergency fallback: no valid candidates available',
      estimatedLatencyMs: 60000,
      riskProfile: { nodeCount: 0, criticalPathLength: 0, externalDependencies: 0, securityCheckpoints: 0, visionAlignmentNodes: 0, fridaHooksCount: 0 },
      metadata: { source: 'emergency_fallback' },
    };
  }

  return {
    activatedPlan: winner,
    decisionTrace,
    resourceTokens: [],
    readyForExecution: true,
  };
}

export function categorizeTag(tag: string): SemanticTag['category'] {
  const domainTags = ['ai_ml', 'web_dev', 'mobile', 'data_engineering', 'devops', 'hardware', 'security', 'testing', 'startup'];
  const actionTags = ['build', 'analyze', 'fix', 'optimize', 'design', 'deploy'];
  const complexityTags = ['low_complexity', 'high_complexity'];

  if (domainTags.includes(tag)) return 'domain';
  if (actionTags.includes(tag)) return 'action';
  if (complexityTags.includes(tag)) return 'complexity';
  return 'constraint';
}
