/**
 * Stage 6: Decision Trace — Serialize rationale and write to MemoryBus + JSONL
 *
 * Builds elimination records for non-winners, winner selection rationale,
 * and persists to MemoryBus and JSONL.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import type { IEvaluationScorecard, IShadowSimulationReport, ICandidatePlansOutput, DecisionTrace, CandidateElimination, WinnerSelection } from '../../types.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage6DecisionTrace(
  ctx: PipelineStageContext,
  scorecard: IEvaluationScorecard,
  simulations: IShadowSimulationReport[],
  candidates: ICandidatePlansOutput,
  sessionId: string,
  executionId: string,
): Promise<DecisionTrace> {
  const deviationCount = ctx.deviationGuard.getDeviationCount(sessionId);
  const riskAppetite: 'efficiency' | 'balanced' | 'stability' =
    deviationCount === 0 ? 'efficiency'
      : deviationCount <= 2 ? 'balanced'
      : 'stability';

  const traceId = `trace_${executionId}_${Date.now()}`;

  const candidateEliminations: CandidateElimination[] = [];
  for (const [profileName, profileScore] of Object.entries(scorecard.profiles)) {
    if (profileName !== scorecard.winner) {
      const sim = simulations.find(s => s.strategy === profileName);
      const reasons: string[] = [];

      if (sim) {
        if (sim.overallAssessment === 'FAIL') reasons.push(`Simulation assessment: FAIL (survival ${(sim.survivalProbability * 100).toFixed(1)}%)`);
        if (profileScore.stability < 0.5) reasons.push(`Low stability (${profileScore.stability.toFixed(3)})`);
        if (profileScore.latency < 0.3) reasons.push(`Poor latency score (${profileScore.latency.toFixed(3)})`);
        if (profileScore.security < 0.4) reasons.push(`Insufficient security (${profileScore.security.toFixed(3)})`);
        if (sim.resourceBottlenecks.length > 2) reasons.push(`${sim.resourceBottlenecks.length} resource bottlenecks detected`);
        if (sim.cascadeFailureCount > 2) reasons.push(`${sim.cascadeFailureCount} cascade failures in simulation`);
      }

      candidateEliminations.push({
        profile: profileName,
        reason: reasons.length > 0 ? reasons.join('; ') : `Composite score ${profileScore.composite.toFixed(4)} < winner ${scorecard.winnerScore.toFixed(4)}`,
        score: profileScore.composite,
      });
    }
  }

  const winnerSim = simulations.find(s => s.strategy === scorecard.winner);
  const winnerRationaleParts: string[] = [];
  winnerRationaleParts.push(`Highest MCDA composite score: ${scorecard.winnerScore.toFixed(4)}`);
  if (winnerSim) {
    winnerRationaleParts.push(`Simulation survival: ${(winnerSim.survivalProbability * 100).toFixed(1)}%`);
    winnerRationaleParts.push(`Simulation assessment: ${winnerSim.overallAssessment}`);
  }
  winnerRationaleParts.push(`Risk appetite: ${riskAppetite.toUpperCase()} (deviationCount=${deviationCount})`);

  const winnerSelection: WinnerSelection = {
    profile: scorecard.winner,
    rationale: winnerRationaleParts.join(' | '),
    riskAdjustedWeights: { ...scorecard.weightConfiguration },
  };

  // Write to MemoryBus + JSONL
  let writtenToDisk = false;
  if (ctx.memoryBus) {
    try {
      const traceEntry = {
        type: 'decision_trace', traceId, sessionId, executionId,
        winner: scorecard.winner, winnerScore: scorecard.winnerScore,
        riskAppetite, deviationCount,
        candidateEliminations: candidateEliminations.map(e => ({ profile: e.profile, reason: e.reason.slice(0, 200), score: e.score })),
        timestamp: Date.now(),
      };
      if (typeof ctx.memoryBus.remember === 'function') {
        await ctx.memoryBus.remember({
          content: JSON.stringify(traceEntry),
          source: 'MetaPlanner', sourceId: traceId,
          tags: ['decision_trace', scorecard.winner, riskAppetite],
          importance: 0.9,
        });
      }
      if (typeof ctx.memoryBus.appendLog === 'function') {
        await ctx.memoryBus.appendLog({
          sessionId, executionId, intervention: 'decision_trace',
          reason: `Winner: ${scorecard.winner} (score: ${scorecard.winnerScore.toFixed(4)})`,
          timestamp: Date.now(), affectedNodes: [],
          patchDetails: traceEntry as any,
        });
        writtenToDisk = true;
      }
    } catch { /* non-critical */ }
  }

  if (!writtenToDisk) {
    try {
      ctx.decisionWriter!.append({
        type: 'decision_trace', traceId, sessionId, executionId,
        evaluatedAt: Date.now(), winner: scorecard.winner,
        winnerScore: scorecard.winnerScore, riskAppetite, deviationCount,
        candidateEliminations, winnerSelection,
      });
      writtenToDisk = true;
    } catch { /* non-critical */ }
  }

  if (ctx.wiki?.ready) {
    ctx.wiki.remember({
      id: traceId, type: 'DecisionTrace', name: `trace_${executionId}`,
      data: {
        execution_id: executionId, winner_strategy: scorecard.winner,
        winner_score: scorecard.winnerScore,
        eliminated_candidates: JSON.stringify(candidateEliminations),
        selection_reason: winnerSelection.rationale,
        risk_appetite: riskAppetite, timestamp: Date.now(),
      },
    }).catch(() => {});
  }

  return {
    traceId, sessionId, executionId, evaluatedAt: Date.now(),
    candidateEliminations, winnerSelection, deviationCount, riskAppetite, writtenToDisk,
  };
}
