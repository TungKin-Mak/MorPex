/**
 * PipelineLogger.ts — Structured Trace Logger for the 7-Stage Pipeline
 *
 * DESIGN RULE (可观测性驱动):
 *   Every stage in the 7-stage pipeline MUST produce a visible trace.
 *   The developer MUST be able to see in the terminal:
 *     - What each stage output
 *     - Which profile was eliminated and why
 *     - The score composition
 *     - The final winner selection
 *
 * This logger writes structured, colorized traces to stdout and
 * simultaneously persists them to the MemoryBus JSONL append-only log.
 *
 * @see MetaPlanner.ts — calls PipelineLogger after each stage completes
 * @see PipelineTypes.ts — PipelineTrace type definition
 */

import type {
  PipelineTrace,
  PipelineStageResult,
  PipelineStageNumber,
  StageStatus,
  IntentAnalysisResult,
  ExperienceQueryResult,
  ICandidatePlansOutput,
  IShadowSimulationReport,
  IEvaluationScorecard,
  DecisionTrace,
  PlanActivationResult,
  CandidatePlanProfile,
} from './types.js';
import { PIPELINE_STAGE_NAMES } from './types.js';

// ═══════════════════════════════════════════════════════════════════════
// ANSI Color Utilities
// ═══════════════════════════════════════════════════════════════════════

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
} as const;

function colorize(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function padRight(text: string, len: number): string {
  return text.padEnd(len);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ═══════════════════════════════════════════════════════════════════════
// Stage-Specific Detail Renderers
// ═══════════════════════════════════════════════════════════════════════

function renderStage1Details(output: IntentAnalysisResult): string[] {
  const lines: string[] = [];
  lines.push(`  ${colorize('cyan', 'Tags:')}            ${output.tags.map(t => `${t.tag}(${t.source},${t.score.toFixed(2)})`).join(', ')}`);
  lines.push(`  ${colorize('cyan', 'Confidence:')}       ${colorize(output.confidenceScore >= 0.7 ? 'green' : output.confidenceScore >= 0.3 ? 'yellow' : 'red', output.confidenceScore.toFixed(3))}`);
  lines.push(`  ${colorize('cyan', 'Explicit Constraints:')} ${Object.keys(output.explicitConstraints).length > 0 ? Object.entries(output.explicitConstraints).map(([k, v]) => `${k}=${v}`).join(', ') : '(none)'}`);
  lines.push(`  ${colorize('cyan', 'Implicit Constraints:')} ${output.implicitConstraints.length > 0 ? output.implicitConstraints.join('; ') : '(none)'}`);
  if (output.abortReason) {
    lines.push(`  ${colorize('bgRed', ' ⚠ ABORT: ')} ${output.abortReason}`);
  }
  return lines;
}

function renderStage2Details(output: ExperienceQueryResult): string[] {
  const lines: string[] = [];
  lines.push(`  ${colorize('cyan', 'Positive Samples:')}  ${output.positiveSamples.length}`);
  lines.push(`  ${colorize('cyan', 'Negative Samples:')}  ${output.negativeSamples.length}`);
  lines.push(`  ${colorize('cyan', 'Vector Matches:')}    ${output.vectorMatches.length}`);
  lines.push(`  ${colorize('cyan', 'Total Candidates:')}  ${output.totalCandidates}`);
  if (output.vectorMatches.length > 0) {
    const top = output.vectorMatches.slice(0, 3);
    for (const vm of top) {
      lines.push(`    ${colorize('dim', '→')} ${vm.recordId} (sim: ${vm.similarity.toFixed(3)}) — ${vm.keyInsight.slice(0, 80)}`);
    }
  }
  return lines;
}

function renderCandidateSummary(candidate: CandidatePlanProfile): string[] {
  const strategyColors: Record<string, keyof typeof COLORS> = {
    aggressive: 'red',
    defensive: 'green',
    fallback: 'yellow',
  };
  const color = strategyColors[candidate.strategy] ?? 'white';
  const lines: string[] = [];
  lines.push(`    ┌─ ${colorize('bright', colorize(color, padRight(candidate.strategy.toUpperCase(), 12)))} ${colorize('dim', candidate.profileId)}`);
  lines.push(`    │ Nodes: ${candidate.dag.nodes.length}  |  Latency: ${formatDuration(candidate.estimatedLatencyMs)}  |  CriticalPath: ${candidate.riskProfile.criticalPathLength}`);
  lines.push(`    │ Hooks: ${candidate.riskProfile.fridaHooksCount}  |  SecurityChk: ${candidate.riskProfile.securityCheckpoints}  |  VisionAlign: ${candidate.riskProfile.visionAlignmentNodes}`);
  lines.push(`    │ ${candidate.rationale.slice(0, 120)}`);
  lines.push(`    └─`);
  return lines;
}

function renderStage3Details(output: ICandidatePlansOutput): string[] {
  const lines: string[] = [];
  lines.push(`  ${colorize('cyan', 'Request ID:')}     ${output.planRequestId}`);
  lines.push(`  ${colorize('cyan', 'Model:')}          ${output.generationMetadata.modelUsed} (${output.generationMetadata.tokensUsed} tok, ${formatDuration(output.generationMetadata.generationTimeMs)})`);
  lines.push(`  ${colorize('cyan', 'Validation:')}     ${output.validationPassed ? colorize('green', 'PASSED') : colorize('bgRed', ' FAILED ')}`);
  if (output.fallbackTemplateUsed) {
    lines.push(`  ${colorize('bgYellow', ' ⚡ FALLBACK ')} Pre-compiled defensive template used instead of LLM output`);
  }
  if (output.validationErrors && output.validationErrors.length > 0) {
    lines.push(`  ${colorize('red', 'Validation Errors:')} ${output.validationErrors.join('; ')}`);
  }
  lines.push(`  ${colorize('bright', 'Candidates:')}`);
  for (const c of output.candidates) {
    lines.push(...renderCandidateSummary(c));
  }
  return lines;
}

function renderStage4Details(output: IShadowSimulationReport[]): string[] {
  const lines: string[] = [];
  const strategyColors: Record<string, keyof typeof COLORS> = {
    aggressive: 'red',
    defensive: 'green',
    fallback: 'yellow',
  };

  for (const report of output) {
    const color = strategyColors[report.strategy] ?? 'white';
    const assessmentColor: keyof typeof COLORS = report.overallAssessment === 'PASS' ? 'green' : report.overallAssessment === 'CONDITIONAL_PASS' ? 'yellow' : 'red';
    lines.push(`  ┌─ ${colorize('bright', colorize(color, padRight(report.strategy.toUpperCase(), 12)))} ${colorize('dim', report.simulationId)}`);
    lines.push(`  │ Survival:   ${colorize(assessmentColor, (report.survivalProbability * 100).toFixed(1) + '%')}`);
    lines.push(`  │ Latency:    ${formatDuration(report.totalSimulatedLatencyMs)}`);
    lines.push(`  │ Nodes:      ${report.passedNodes} passed / ${report.failedNodes} failed / ${report.cascadeFailureCount} cascade`);
    lines.push(`  │ Assessment: ${colorize(assessmentColor, report.overallAssessment)}`);
    if (report.resourceBottlenecks.length > 0) {
      const top = report.resourceBottlenecks.slice(0, 3);
      for (const b of top) {
        lines.push(`  │ ⚡ ${b.resourceId}: ${b.contentionCount} contentions, avg ${b.avgWaitTimeMs.toFixed(0)}ms wait`);
      }
    }
    if (report.simulatedExceptionTraces.length > 0) {
      for (const e of report.simulatedExceptionTraces.slice(0, 2)) {
        lines.push(`  │ ✗ ${e.nodeId}: ${e.message.slice(0, 80)}`);
      }
    }
    lines.push(`  └─`);
  }
  return lines;
}

function renderStage5Details(output: IEvaluationScorecard): string[] {
  const lines: string[] = [];
  const dims = ['stability', 'latency', 'security', 'alignment', 'healing', 'knowledge'] as const;

  lines.push(`  ${colorize('cyan', 'Weights:')}       ${dims.map(d => `${d}=${output.weightConfiguration[d].toFixed(2)}`).join(' | ')}`);
  lines.push(`  ${colorize('cyan', 'Winner:')}        ${colorize('bright', colorize('green', output.winner.toUpperCase()))} (score: ${output.winnerScore.toFixed(4)})`);

  for (const profile of ['aggressive', 'defensive', 'fallback'] as const) {
    const ps = output.profiles[profile];
    const isWinner = profile === output.winner;
    const prefix = isWinner ? '🏆' : '  ';
    const color: keyof typeof COLORS = isWinner ? 'green' : 'dim';
    lines.push(`  ${prefix} ${colorize(color, padRight(profile.toUpperCase(), 12))} composite: ${ps.composite.toFixed(4)}`);
    for (const d of dims) {
      const barLen = Math.round(ps[d] * 20);
      const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
      lines.push(`      ${padRight(d, 12)} ${colorize(color, bar)} ${colorize('bright', ps[d].toFixed(3))}`);
    }
  }

  // Show top elimination reasons
  const eliminations = output.scoreBreakdown.filter(b => b.profile !== output.winner);
  if (eliminations.length > 0) {
    lines.push(`  ${colorize('yellow', 'Elimination Insights:')}`);
    const byProfile = new Map<string, { dim: string; raw: number }[]>();
    for (const e of eliminations) {
      if (!byProfile.has(e.profile)) byProfile.set(e.profile, []);
      byProfile.get(e.profile)!.push({ dim: e.dimension, raw: e.rawScore });
    }
    for (const [prof, scores] of byProfile) {
      const lowScores = scores.sort((a, b) => a.raw - b.raw).slice(0, 2);
      lines.push(`    ${colorize('dim', prof)}: weak in ${lowScores.map(s => `${s.dim}=${s.raw.toFixed(3)}`).join(', ')}`);
    }
  }
  return lines;
}

function renderStage6Details(output: DecisionTrace): string[] {
  const lines: string[] = [];
  lines.push(`  ${colorize('cyan', 'Risk Appetite:')}  ${output.riskAppetite.toUpperCase()} (deviationCount=${output.deviationCount})`);
  lines.push(`  ${colorize('cyan', 'Winner:')}        ${colorize('bright', colorize('green', output.winnerSelection.profile))}`);

  for (const elim of output.candidateEliminations) {
    lines.push(`  ${colorize('dim', '✗ ' + padRight(elim.profile, 12))} score=${elim.score.toFixed(4)} — ${elim.reason.slice(0, 100)}`);
  }

  lines.push(`  ${colorize('green', '✓ ' + padRight(output.winnerSelection.profile, 12))} ${output.winnerSelection.rationale.slice(0, 100)}`);
  lines.push(`  ${colorize('cyan', 'Written to disk:')} ${output.writtenToDisk ? colorize('green', 'YES') : colorize('red', 'NO')}`);
  return lines;
}

function renderStage7Details(output: PlanActivationResult): string[] {
  const lines: string[] = [];
  lines.push(`  ${colorize('cyan', 'Activated:')}     ${colorize('bright', colorize('green', output.activatedPlan.strategy.toUpperCase()))} (${output.activatedPlan.profileId})`);
  lines.push(`  ${colorize('cyan', 'Resource Tokens:')} ${output.resourceTokens.length > 0 ? output.resourceTokens.join(', ') : '(none acquired)'}`);
  lines.push(`  ${colorize('cyan', 'Ready:')}          ${output.readyForExecution ? colorize('green', 'YES → forwarding to ExecutionOrchestrator') : colorize('bgRed', ' NO ')}`);
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════
// Main Stage Renderer
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render a single pipeline stage to a formatted string block.
 * Color-encoded: green=completed, yellow=skipped, red=failed
 */
function renderStage(stageResult: PipelineStageResult): string {
  const stageNum = stageResult.stage;
  const stageName = PIPELINE_STAGE_NAMES[stageNum];
  const statusColor: keyof typeof COLORS = stageResult.status === 'completed' ? 'green' : stageResult.status === 'skipped' ? 'yellow' : 'red';
  const statusIcon = stageResult.status === 'completed' ? '✓' : stageResult.status === 'skipped' ? '∼' : '✗';

  const lines: string[] = [];
  lines.push('');
  lines.push(colorize('bright', '━'.repeat(72)));
  lines.push(` ${colorize('bright', `Stage ${stageNum}: ${stageName}`)}`);
  lines.push(` ${colorize(statusColor, statusIcon)} ${colorize('dim', 'Status:')} ${colorize(statusColor, stageResult.status.toUpperCase())}  ${colorize('dim', 'Duration:')} ${formatDuration(stageResult.durationMs)}`);
  lines.push('');

  if (stageResult.status === 'completed' && stageResult.output) {
    switch (stageNum) {
      case 1:
        lines.push(...renderStage1Details(stageResult.output as IntentAnalysisResult));
        break;
      case 2:
        lines.push(...renderStage2Details(stageResult.output as ExperienceQueryResult));
        break;
      case 3:
        lines.push(...renderStage3Details(stageResult.output as ICandidatePlansOutput));
        break;
      case 4:
        lines.push(...renderStage4Details(stageResult.output as IShadowSimulationReport[]));
        break;
      case 5:
        lines.push(...renderStage5Details(stageResult.output as IEvaluationScorecard));
        break;
      case 6:
        lines.push(...renderStage6Details(stageResult.output as DecisionTrace));
        break;
      case 7:
        lines.push(...renderStage7Details(stageResult.output as PlanActivationResult));
        break;
    }
  }

  if (stageResult.error) {
    lines.push(` ${colorize('bgRed', ' ERROR ')} ${stageResult.error.slice(0, 200)}`);
  }

  lines.push(colorize('bright', '━'.repeat(72)));
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * PipelineLogger — Writes structured traces to stdout and MemoryBus
 */
export class PipelineLogger {
  private traceLogPath: string;

  constructor(config?: { traceLogPath?: string }) {
    this.traceLogPath = config?.traceLogPath ?? './data/planning/traces/pipeline-traces.jsonl';
  }

  /**
   * Log a single completed stage to stdout
   */
  logStage(stageResult: PipelineStageResult): void {
    const output = renderStage(stageResult);
    console.log(output);
  }

  /**
   * Log the complete pipeline trace to stdout
   */
  logPipelineTrace(trace: PipelineTrace): void {
    const totalDuration = trace.completedAt - trace.startedAt;

    console.log('');
    console.log(colorize('bgCyan', colorize('bright', ' ═══════════════════════════════════════════════════════════════ ')));
    console.log(colorize('bgCyan', colorize('bright', '  PIPELINE TRACE                                                     ')));
    console.log(colorize('bgCyan', colorize('bright', ' ═══════════════════════════════════════════════════════════════ ')));
    console.log(` ${colorize('cyan', 'Pipeline:')} ${trace.pipelineId}`);
    console.log(` ${colorize('cyan', 'Session:')}  ${trace.sessionId}`);
    console.log(` ${colorize('cyan', 'Exec:')}     ${trace.executionId}`);
    console.log(` ${colorize('cyan', 'Total:')}    ${formatDuration(totalDuration)}`);
    console.log(` ${colorize('cyan', 'Aborted:')}  ${trace.aborted ? colorize('bgRed', ' YES ') : colorize('green', 'no')}${trace.abortReason ? ' — ' + trace.abortReason : ''}`);
    console.log('');

    for (const stage of trace.stages) {
      console.log(renderStage(stage));
    }

    console.log('');
    console.log(colorize('bright', '═'.repeat(72)));
    console.log(colorize('bright', ` ${trace.aborted ? '⚠ PIPELINE ABORTED' : '✓ PIPELINE COMPLETE'}  (${formatDuration(totalDuration)})`));
    console.log(colorize('bright', '═'.repeat(72)));
    console.log('');
  }

  /**
   * Serialize trace to JSONL line for disk persistence
   */
  serializeTraceToJSONL(trace: PipelineTrace): string {
    return JSON.stringify({
      type: 'pipeline_trace',
      pipelineId: trace.pipelineId,
      sessionId: trace.sessionId,
      executionId: trace.executionId,
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      totalDurationMs: trace.completedAt - trace.startedAt,
      aborted: trace.aborted,
      abortReason: trace.abortReason,
      stages: trace.stages.map(s => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs,
        error: s.error,
        // For compactness, include key metrics per stage
        summary: s.status === 'completed' ? stageSummary(s) : undefined,
      })),
    }) + '\n';
  }
}

/**
 * stageSummary — Compact JSON-safe summary for each stage output
 */
function stageSummary(stage: PipelineStageResult): Record<string, unknown> {
  switch (stage.stage) {
    case 1: {
      const o = stage.output as IntentAnalysisResult;
      return { confidenceScore: o.confidenceScore, tagCount: o.tags.length, abortReason: o.abortReason };
    }
    case 2: {
      const o = stage.output as ExperienceQueryResult;
      return { positiveCount: o.positiveSamples.length, negativeCount: o.negativeSamples.length, vectorMatches: o.vectorMatches.length };
    }
    case 3: {
      const o = stage.output as ICandidatePlansOutput;
      return { validationPassed: o.validationPassed, fallbackUsed: o.fallbackTemplateUsed, profileStrategies: o.candidates.map(c => c.strategy) };
    }
    case 4: {
      const o = stage.output as IShadowSimulationReport[];
      return { profileAssessments: o.map(r => ({ strategy: r.strategy, survival: r.survivalProbability, assessment: r.overallAssessment })) };
    }
    case 5: {
      const o = stage.output as IEvaluationScorecard;
      return { winner: o.winner, winnerScore: o.winnerScore, weights: o.weightConfiguration };
    }
    case 6: {
      const o = stage.output as DecisionTrace;
      return { winner: o.winnerSelection.profile, riskAppetite: o.riskAppetite, deviationCount: o.deviationCount };
    }
    case 7: {
      const o = stage.output as PlanActivationResult;
      return { activatedProfile: o.activatedPlan.strategy, ready: o.readyForExecution, tokenCount: o.resourceTokens.length };
    }
    default:
      return {};
  }
}

/**
 * Quick one-line status for terminal-friendly monitoring
 */
export function oneLinePipelineStatus(trace: PipelineTrace): string {
  const failedStages = trace.stages.filter(s => s.status === 'failed').length;
  const skippedStages = trace.stages.filter(s => s.status === 'skipped').length;
  const totalDuration = trace.completedAt - trace.startedAt;

  let status = trace.aborted
    ? colorize('bgRed', ' ABORT ')
    : failedStages > 0
    ? colorize('bgYellow', ' DEGRADED ')
    : colorize('bgGreen', ' COMPLETE ');

  return `${status} ${colorize('dim', trace.pipelineId)} ${formatDuration(totalDuration)} [stages: 7/${7 - failedStages - skippedStages}✓ ${failedStages}✗ ${skippedStages}∼]`;
}
