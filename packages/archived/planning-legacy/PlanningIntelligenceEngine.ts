/**
 * PlanningIntelligenceEngine — Autonomous Planning Engine (v8)
 *
 * Wraps MetaPlanner to add a closed-loop self-improvement system.
 * Transforms the 7-stage pipeline from a one-shot planner into a
 * continuously learning autonomous planning engine.
 *
 * THE SELF-IMPROVEMENT LOOP:
 *   Plan (7-Stage Pipeline)
 *     → Execute (DAG execution)
 *       → Record (PlanExperienceStore)
 *         → Analyze (compare prediction vs reality)
 *           → Learn (derive actions from gaps)
 *             → Adapt (apply learning to config)
 *               → Evolve (periodic maintenance)
 *                 → NEXT execution is BETTER
 *
 * Architecture:
 *   PlanningIntelligenceEngine
 *     └── wraps MetaPlanner
 *           ├── calls executePlanningPipeline()  (existing 7-stage)
 *           ├── calls originalDAGExecution()     (existing)
 *           └── adds analyze → learn → adapt    (NEW)
 *
 * Design constraints:
 *   - Zero invasion: MetaPlanner internals are unchanged
 *   - All learning is advisory + reversible
 *   - Non-critical failures don't block execution
 *   - Persisted learning survives restarts
 *
 * @see MetaPlanner.ts — core 7-stage pipeline
 * @see PlanExperienceStore.ts — persistent record storage
 * @see PipelineTypes.ts — types for gap analysis, learning actions
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { MetaPlanner } from './MetaPlanner.js';
import type { PlanExecutionRecord } from './types.js';
import type { WeightConfiguration, DESConfig } from './types.js';
import {
  DEFAULT_PLANNING_INTELLIGENCE_CONFIG,
  DEFAULT_RISK_APPETITE_PROFILE,
} from './types.js';
import type {
  ExecutionGapAnalysis,
  LearningAction,
  ImprovementTrajectory,
  AutonomousExecutionResult,
  TemplateEvolutionReport,
  PlanningIntelligenceConfig,
} from './types.js';
// JSONL 写入已下线 — 使用 MemoryWiki/SQLite 持久化
import { MemoryWiki } from '../../../../memory/src/index.js';

/** Track type for execution count persistence */
interface IntelligenceState {
  executionCount: number;
  scoreHistory: number[];
  lastWeightTuningAt: number;
  lastTemplateEvolutionAt: number;
  appliedLearningActions: LearningAction[];
}

export class PlanningIntelligenceEngine {
  private wiki: MemoryWiki | null = null;
  private metaPlanner: MetaPlanner;
  private config: PlanningIntelligenceConfig;
  private state: IntelligenceState;
  /** JSONL 回退路径（仅用于 loadState 初始化加载） */
  private statePath: string;

  constructor(metaPlanner: MetaPlanner, config?: Partial<PlanningIntelligenceConfig>) {
    this.metaPlanner = metaPlanner;
    this.config = { ...DEFAULT_PLANNING_INTELLIGENCE_CONFIG, ...config };
    this.statePath = path.resolve('./data/planning/intelligence-state.jsonl');
    this.state = {
      executionCount: 0,
      scoreHistory: [],
      lastWeightTuningAt: 0,
      lastTemplateEvolutionAt: 0,
      appliedLearningActions: [],
    };
    // Restore persisted state on startup
    this.loadState().catch(() => {});
  }

  /**
   * executeAndLearn — The core autonomous loop.
   *
   * 1. Run the 7-stage pipeline (MetaPlanner)
   * 2. Execute the winning DAG through original orchestrate
   * 3. Build execution record
   * 4. Analyze predicted vs actual outcomes
   * 5. Derive learning actions from gaps
   * 6. Apply learning (adapt configuration)
   * 7. Periodically evolve templates and auto-tune weights
   * 8. Return execution result + improvement metadata
   */
  async executeAndLearn(
    userInput: string,
    executeFn: (dag: any) => Promise<{ result: any; record: Partial<PlanExecutionRecord> }>,
  ): Promise<AutonomousExecutionResult> {
    this.state.executionCount++;

    // ── Phase 1: Plan (existing 7-stage pipeline via MetaPlanner.wrapOrchestrate) ──
    // We call executePlanningPipeline directly (private in MetaPlanner, so we use
    // the public replanPipeline interface which wraps it)
    const replanResult = await this.metaPlanner.replanPipeline(
      `session_auto_${Date.now()}`,
      `exec_auto_${Date.now()}_${this.state.executionCount}`,
      { userInput, source: 'planning_intelligence_engine' },
    );

    // Extract the pipeline trace and activation
    const pipelineTrace = (replanResult as any)?.trace ?? null;
    const activation = (replanResult as any)?.activation ?? null;
    const winnerDAG = activation?.activatedPlan?.dag ?? { nodes: [] };

    // ── Phase 2: Execute the winning DAG ──
    const { result, record: partialRecord } = await executeFn(winnerDAG);

    // ── Phase 3: Build and persist execution record ──
    const executionRecord: PlanExecutionRecord = {
      recordId: partialRecord.recordId ?? `rec_auto_${Date.now()}`,
      executionId: partialRecord.executionId ?? `exec_auto_${Date.now()}`,
      userInput: userInput.slice(0, 200),
      inputTags: partialRecord.inputTags ?? [],
      dagNodes: partialRecord.dagNodes ?? [],
      success: partialRecord.success ?? true,
      totalDurationMs: partialRecord.totalDurationMs ?? 0,
      totalTokensUsed: partialRecord.totalTokensUsed ?? 0,
      artifactCount: partialRecord.artifactCount ?? 0,
      selfHealingRetries: partialRecord.selfHealingRetries ?? 0,
      pruningTokensSaved: partialRecord.pruningTokensSaved ?? 0,
      score: partialRecord.score ?? 0,
      createdAt: Date.now(),
    };

    // Persist to PlanExperienceStore
    await this.metaPlanner.store.saveRecord(executionRecord).catch(() => {});

    // ── Phase 4: Analyze gap ──
    const gapAnalysis = this.analyzeExecutionGap(pipelineTrace, executionRecord);

    // ── Phase 5: Learn from gaps ──
    const learningActions = this.learnFromGap(gapAnalysis);

    // ── Phase 6: Apply learning ──
    let weightAdjustments: Record<string, number> = {};
    let templateQualityChange = 0;

    for (const action of learningActions) {
      await this.applyLearningAction(action);
      this.state.appliedLearningActions.push(action);

      if (action.type === 'adjust_weight') {
        weightAdjustments[action.target] = (weightAdjustments[action.target] ?? 0) + (action.after - action.before);
      }
      if (action.type === 'update_template_quality' || action.type === 'boost_template') {
        templateQualityChange += action.after - action.before;
      }
    }

    // ── Phase 7: Periodic evolution ──
    if (this.config.enableTemplateEvolution &&
        this.state.executionCount % this.config.evolveInterval === 0) {
      await this.evolveTemplates();
    }
    if (this.config.enableWeightAutoTuning &&
        this.state.executionCount % Math.ceil(this.config.evolveInterval / 2) === 0 &&
        this.state.executionCount > 0) {
      this.autoTuneWeights();
    }

    // ── Persist state after each execution ──
    this.state.scoreHistory.push(executionRecord.score);
    const previousScore = this.state.scoreHistory.length >= 2
      ? this.state.scoreHistory[this.state.scoreHistory.length - 2]
      : executionRecord.score;
    const scoreVsPrevious = this.state.scoreHistory.length >= 2
      ? executionRecord.score - previousScore
      : 0;

    return {
      dag: winnerDAG,
      result,
      pipelineTrace,
      executionRecord,
      gapAnalysis,
      learningActions,
      improvement: {
        scoreVsPrevious,
        dimensionDeltas: {},
        templateQualityChange,
        weightAdjustments,
        learningApplied: learningActions.length > 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4: Gap Analysis
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * analyzeExecutionGap — Compare predicted vs actual outcomes.
   *
   * Extracts predictions from Stages 4-5 (DES simulation + MCDA scorecard)
   * and compares against post-execution reality.
   */
  analyzeExecutionGap(
    pipelineTrace: Record<string, any>,
    actualRecord: PlanExecutionRecord,
  ): ExecutionGapAnalysis {
    // Extract predictions from pipeline trace stages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = pipelineTrace.stages as any[] | undefined;
    const stage4 = stages?.[3];   // Stage 4: DES simulation
    const stage5 = stages?.[4];   // Stage 5: MCDA scorecard
    const stage7 = stages?.[6];   // Stage 7: activation

    const simReports = (stage4 as Record<string, unknown>)?.output as Array<Record<string, unknown>> ?? [];
    const scorecard = (stage5 as Record<string, unknown>)?.output as Record<string, unknown> | null ?? null;
    const activation = (stage7 as Record<string, unknown>)?.output as Record<string, unknown> | null ?? null;

    // Predicted survival: average across all simulated profiles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reportsArr: any[] = Array.isArray(simReports) ? simReports as any[] : [];
    const predictedSurvival = reportsArr.length > 0
      ? reportsArr.reduce((s: number, r: any) => s + (r.survivalProbability ?? 0.5), 0) / reportsArr.length
      : 0.5;

    // Actual survival: 1.0 if success, 0.0 if failed, ratio of passed dagNodes
    const actualNodeCount = actualRecord.dagNodes.length;
    const passedNodes = actualRecord.dagNodes.filter(n => n.status === 'success').length;
    const actualSurvival = actualNodeCount > 0 ? passedNodes / actualNodeCount : (actualRecord.success ? 1.0 : 0.0);

    // Predicted latency: simulated total from winner profile
    const activationRecord = activation as Record<string, unknown> | undefined;
    const winnerStrategy = (activationRecord?.['activatedPlan'] as Record<string, unknown> | undefined)?.['strategy'] as string | undefined;
    const winnerSim = reportsArr.length > 0
      ? reportsArr.find((r: any) => r.strategy === winnerStrategy)
      : null;
    const predictedLatency: number = (winnerSim as Record<string, unknown> | null)?.['totalSimulatedLatencyMs'] as number ?? 30000;
    const actualLatency = actualRecord.totalDurationMs;

    // Predicted score: MCDA winner composite
    const predictedScore = (scorecard as Record<string, unknown> | undefined)?.['winnerScore'] as number ?? 0.5;
    const actualScore = actualRecord.score;

    // Per-dimension gaps
    const dimGaps: ExecutionGapAnalysis['dimGaps'] = [];
    const significantGaps: string[] = [];
    const dims = ['stability', 'latency', 'security', 'alignment', 'healing', 'knowledge'];

    const scorecardRecord = scorecard as Record<string, unknown> | undefined;
    const winner = (scorecardRecord?.['profiles'] as Record<string, unknown> | undefined)?.[(scorecardRecord?.['winner'] as string) ?? 'defensive'] as Record<string, unknown> | undefined;
    if (winner) {
      for (const dim of dims) {
        const predicted: number = typeof winner?.[dim] === 'number' ? winner[dim] as number : 0;
        // Map actual to dimension equivalents:
        // stability → success rate, latency → 1 - (duration/maxDuration), others inferred
        let actual: number;
        switch (dim) {
          case 'stability':
            actual = actualSurvival;
            break;
          case 'latency':
            actual = Math.max(0, 1 - Math.min(actualLatency / Math.max(predictedLatency, 1), 2));
            break;
          case 'security':
            actual = actualRecord.artifactCount > 0 ? Math.min(1, actualRecord.artifactCount * 0.2) : 0.5;
            break;
          case 'alignment':
            actual = actualRecord.success ? 0.8 : 0.2;
            break;
          case 'healing':
            actual = actualRecord.selfHealingRetries > 0
              ? Math.max(0, 1 - actualRecord.selfHealingRetries * 0.2)
              : 1.0;
            break;
          case 'knowledge':
            actual = actualRecord.inputTags.length > 0 ? Math.min(1, actualRecord.inputTags.length * 0.15) : 0.3;
            break;
          default:
            actual = 0.5;
        }
        const delta = predicted - actual;
        dimGaps.push({ dimension: dim, predicted, actual, delta });
        if (Math.abs(delta) > this.config.significanceThreshold) {
          significantGaps.push(dim);
        }
      }
    }

    return {
      predictedSurvival,
      actualSurvival,
      predictedLatency,
      actualLatency,
      predictedScore,
      actualScore,
      dimGaps,
      significantGaps,
      analyzedAt: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 5: Learning from Gaps
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * learnFromGap — Derive concrete learning actions from gap analysis.
   *
   * Rules:
   *   - DES over-predicted survival → amplify volatility (DES was too optimistic)
   *   - DES under-predicted latency → timing model needs calibration
   *   - MCDA dimension over-scored → reduce that dimension's weight
   *   - MCDA dimension under-scored → increase that dimension's weight
   *   - Multiple failures in same strategy → deprioritize that strategy
   */
  learnFromGap(gap: ExecutionGapAnalysis): LearningAction[] {
    if (!this.config.enableLearning) return [];

    const actions: LearningAction[] = [];

    // ── Survival gap: DES over-predicted → increase volatility ──
    const survivalDelta = gap.predictedSurvival - gap.actualSurvival;
    if (survivalDelta > this.config.significanceThreshold) {
      const currentAmplification = (this.metaPlanner as any).desConfig?.volatilityAmplification ?? 1.0;
      const adjustment = Math.min(0.3, survivalDelta * 0.5);
      actions.push({
        type: 'amplify_volatility',
        target: 'volatilityAmplification',
        before: currentAmplification,
        after: Math.round((currentAmplification + adjustment) * 100) / 100,
        reason: `DES over-predicted survival by ${(survivalDelta * 100).toFixed(0)}% (predicted ${(gap.predictedSurvival * 100).toFixed(0)}%, actual ${(gap.actualSurvival * 100).toFixed(0)}%)`,
        appliedAt: Date.now(),
      });
    }

    // ── Dimension gaps: adjust MCDA weights ──
    for (const dimGap of gap.dimGaps) {
      if (Math.abs(dimGap.delta) > this.config.significanceThreshold) {
        // Over-predicted (predicted > actual by significant margin) → reduce weight
        // Under-predicted (actual > predicted) → increase weight
        const adjustment = Math.min(
          this.config.maxWeightAdjustment,
          Math.abs(dimGap.delta) * 0.3,
        );
        const direction = dimGap.delta > 0 ? -1 : 1; // over-predicted → reduce, under-predicted → increase
        const currentWeight = this.getCurrentWeight(dimGap.dimension);
        const newWeight = Math.max(0.01, Math.min(0.5, currentWeight + direction * adjustment));

        actions.push({
          type: 'adjust_weight',
          target: dimGap.dimension,
          before: currentWeight,
          after: newWeight,
          reason: dimGap.delta > 0
            ? `Dimension "${dimGap.dimension}" over-predicted by ${(dimGap.delta * 100).toFixed(0)}% (pred ${(dimGap.predicted * 100).toFixed(0)}%, actual ${(dimGap.actual * 100).toFixed(0)}%) → reducing weight`
            : `Dimension "${dimGap.dimension}" under-predicted by ${(Math.abs(dimGap.delta) * 100).toFixed(0)}% (pred ${(dimGap.predicted * 100).toFixed(0)}%, actual ${(dimGap.actual * 100).toFixed(0)}%) → increasing weight`,
          appliedAt: Date.now(),
        });
      }
    }

    return actions;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 6: Apply Learning Actions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * applyLearningAction — Apply a single learning action.
   *
   * For weight adjustments, updates the DEFAULT_RISK_APPETITE_PROFILE.
   * For volatility amplification, updates DES config.
   * For template changes, updates PlanExperienceStore.
   */
  async applyLearningAction(action: LearningAction): Promise<void> {
    switch (action.type) {
      case 'adjust_weight': {
        // Update the weight in all three risk appetite profiles
        const dim = action.target as keyof WeightConfiguration;
        for (const mode of ['efficiency', 'balanced', 'stability'] as const) {
          const profile = DEFAULT_RISK_APPETITE_PROFILE[mode];
          if (profile[dim] !== undefined) {
            profile[dim] = action.after;
          }
        }
        break;
      }

      case 'amplify_volatility': {
        // Update DES volatility amplification
        const desConfig = (this.metaPlanner as any).desConfig;
        if (desConfig) {
          desConfig.volatilityAmplification = action.after;
        }
        break;
      }

      case 'boost_template': {
        // Boost a template's quality score
        const templates = (this.metaPlanner.store.getAllTemplates?.() ?? []) as Record<string, unknown>[];
        const template = templates
          .find((t: Record<string, unknown>) => t.templateId === action.target);
        if (template) {
          template.qualityScore = action.after;
        }
        break;
      }

      case 'update_template_quality': {
        // Similar to boost but can go either direction
        const templates = (this.metaPlanner.store.getAllTemplates?.() ?? []) as Record<string, unknown>[];
        const template = templates
          .find((t: Record<string, unknown>) => t.templateId === action.target);
        if (template) {
          const oldScore = (template.qualityScore as number) ?? 0.5;
          template.qualityScore = Math.max(0, Math.min(1, oldScore + (action.after - action.before)));
        }
        break;
      }

      case 'deprioritize_strategy':
        // Strategy deprioritization is advisory — stored in metadata
        // In future: could affect Stage 3 generation
        console.log(`[PlanningIntelligence] Strategy "${action.target}" deprioritized: ${action.reason}`);
        break;

      case 'prune_template':
        // Template pruning happens via evolveTemplates
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 7: Evolution & Auto-Tuning
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * evolveTemplates — Periodically prune weak templates and boost strong ones.
   *
   * 1. Prune templates with qualityScore < templateQualityMin
   * 2. Boost templates in the top 10% by qualityScore
   * 3. Log evolution report
   */
  async evolveTemplates(): Promise<TemplateEvolutionReport> {
    const report: TemplateEvolutionReport = {
      prunedTemplates: [],
      boostedTemplates: [],
      mergedTemplates: [],
      beforeCount: 0,
      afterCount: 0,
    };

    const allTemplates = this.metaPlanner.store.getAllTemplates?.() ?? [];
    report.beforeCount = allTemplates.length;

    // 1. Try to fix low-quality templates via TemplateEvolutionEngine
    for (const t of allTemplates) {
      const qs = (t as any).qualityScore ?? 0.5;
      if (qs < this.config.templateQualityMin) {
        // ★ v3.0 Try TemplateEvolutionEngine fix instead of immediate delete
        const tee = (this.metaPlanner as any).templateEvolution;
        if (tee && typeof tee.fixTemplate === 'function') {
          try {
            const fixed = await tee.fixTemplate(t.templateId);
            if (fixed) {
              report.boostedTemplates.push({
                templateId: t.templateId,
                oldQuality: qs,
                newQuality: fixed.qualityScore,
              });
              continue; // Skip deletion, template was fixed
            }
          } catch { /* fall through to deletion */ }
        }
        report.prunedTemplates.push(t.templateId);
        try {
          (this.metaPlanner.store as any).deleteTemplate?.(t.templateId);
        } catch { /* non-critical */ }
      }
    }

    // 2. Boost top-tier templates (qualityScore >= topThreshold)
    const sorted = [...allTemplates]
      .filter(t => {
        const qs = (t as any).qualityScore ?? 0.5;
        return qs >= this.config.templateQualityMin; // Only consider non-pruned
      })
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.qualityScore as number) - (a.qualityScore as number));
    const top10PercentIdx = Math.max(1, Math.floor(sorted.length * 0.1));
    const topThreshold = sorted.length > 0 ? sorted[top10PercentIdx]?.qualityScore ?? 0.5 : 0.5;

    for (const t of sorted) {
      const qs = (t as any).qualityScore ?? 0.5;
      if (qs >= topThreshold && qs < 0.95) {
        const oldQuality = qs;
        const boost = Math.min(0.1, 1.0 - qs) * 0.5;
        (t as any).qualityScore = Math.min(1.0, qs + boost);
        report.boostedTemplates.push({
          templateId: t.templateId,
          oldQuality,
          newQuality: (t as any).qualityScore,
        });
      }
    }

    report.afterCount = (this.metaPlanner.store.getAllTemplates?.() ?? []).length;
    this.state.lastTemplateEvolutionAt = Date.now();

    console.log(`[PlanningIntelligence] Template evolution: ${report.beforeCount} → ${report.afterCount} (pruned ${report.prunedTemplates.length}, boosted ${report.boostedTemplates.length})`);
    return report;
  }

  /**
   * autoTuneWeights — Automatically adjust MCDA weights based on
   * which dimensions actually correlate with successful outcomes.
   *
   * Algorithm:
   *   1. Get last N execution records (config.weightTuningWindow)
   *   2. For each dimension, compute correlation with actual success score
   *   3. Higher correlation → increase weight
   *   4. Renormalize weights to sum 1.0
   *   5. Clamp each weight to [0.01, 0.50]
   */
  autoTuneWeights(): WeightConfiguration {
    const window = this.config.weightTuningWindow;
    const records: PlanExecutionRecord[] = [];

    // Collect recent records from store
    const allRecords = (this.metaPlanner.store as any).getAllRecords?.() ?? [];
    const recent = [...allRecords].slice(-window).filter((r: PlanExecutionRecord) => r.dagNodes.length > 0);
    if (recent.length < 5) {
      return { ...DEFAULT_RISK_APPETITE_PROFILE.balanced };
    }

    const dims: (keyof WeightConfiguration)[] = ['stability', 'latency', 'security', 'alignment', 'healing', 'knowledge'];

    // Compute simple correlation: for each dimension, compare its average
    // score in high-success vs low-success executions
    const highSuccessThreshold = 0.7;
    const highSuccess = recent.filter((r: PlanExecutionRecord) => r.score >= highSuccessThreshold);
    const lowSuccess = recent.filter((r: PlanExecutionRecord) => r.score < highSuccessThreshold);

    if (highSuccess.length < 2 || lowSuccess.length < 2) {
      return { ...DEFAULT_RISK_APPETITE_PROFILE.balanced };
    }

    // Compute average scores per dimension for high and low success groups
    const avgHigh = this.averageDimScores(highSuccess);
    const avgLow = this.averageDimScores(lowSuccess);

    // Correlation proxy: ratio of high-success avg to low-success avg
    // If a dimension has higher scores in successful executions, it's predictive
    const correlations: Record<string, number> = {};
    for (const dim of dims) {
      const high = avgHigh[dim] ?? 0.5;
      const low = avgLow[dim] ?? 0.5;
      correlations[dim] = low > 0 ? Math.min(2.0, high / low) : 1.0;
    }

    // Convert correlations to weights
    const rawWeights: Record<string, number> = {};
    let totalRaw = 0;
    for (const dim of dims) {
      // Square correlation to amplify signal, clamp to [0.5, 2.0]
      const corr = Math.max(0.5, Math.min(2.0, correlations[dim]));
      rawWeights[dim] = corr;
      totalRaw += corr;
    }

    // Normalize to sum 1.0, clamp each to [0.01, 0.50]
    const newWeights: WeightConfiguration = { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0 };
    if (totalRaw > 0) {
      for (const dim of dims) {
        newWeights[dim] = Math.max(0.01, Math.min(0.50, rawWeights[dim] / totalRaw));
      }
    }

    // Renormalize after clamping
    const totalClamped = dims.reduce((s, d) => s + newWeights[d], 0);
    if (totalClamped > 0) {
      for (const dim of dims) {
        newWeights[dim] = Math.round((newWeights[dim] / totalClamped) * 1000) / 1000;
      }
    }

    // Ensure exact sum to 1.0 (fix rounding)
    const finalTotal = dims.reduce((s, d) => s + newWeights[d], 0);
    if (finalTotal !== 1.0 && dims.length > 0) {
      newWeights[dims[0]] += Math.round((1.0 - finalTotal) * 1000) / 1000;
    }

    // Apply to all three risk appetite profiles
    for (const mode of ['efficiency', 'balanced', 'stability'] as const) {
      const profile = DEFAULT_RISK_APPETITE_PROFILE[mode];
      for (const dim of dims) {
        profile[dim] = newWeights[dim];
      }
    }

    this.state.lastWeightTuningAt = Date.now();

    console.log(`[PlanningIntelligence] Weights auto-tuned from ${recent.length} records: ${dims.map(d => `${d}=${newWeights[d].toFixed(3)}`).join(' | ')}`);
    return newWeights;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Reporting
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * loadState — Restore intelligence state from SQLite or JSONL on startup.
   * SQLite 优先，JSONL 回退。
   */
  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  private async loadState(): Promise<void> {
    // ★ SQLite 优先
    if (this.wiki?.ready) {
      try {
        const row = this.wiki.getIntelligenceState();
        if (row) {
          this.state.executionCount = (row.execution_count as number) ?? 0;
          this.state.scoreHistory = typeof row.score_history === 'string' ? JSON.parse(row.score_history as string) : (row.score_history as number[] ?? []);
          this.state.lastWeightTuningAt = (row.last_weight_tuning_at as number) ?? 0;
          this.state.lastTemplateEvolutionAt = (row.last_template_evolution_at as number) ?? 0;
          console.log(`[PlanningIntelligence] Restored state from SQLite: ${this.state.executionCount} executions`);
          return;
        }
      } catch { /* fallback to JSONL */ }
    }

    try {
      const content = await fsp.readFile(this.statePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return;
      const last = JSON.parse(lines[lines.length - 1]);
      this.state.executionCount = last.executionCount ?? 0;
      this.state.scoreHistory = last.scoreHistory ?? [];
      this.state.lastWeightTuningAt = last.lastWeightTuningAt ?? 0;
      this.state.lastTemplateEvolutionAt = last.lastTemplateEvolutionAt ?? 0;
      console.log(`[PlanningIntelligence] Restored state: ${last.executionCount} executions, ${(last.scoreHistory?.length ?? 0)} scores`);
    } catch { /* no persisted state */ }
  }

  /**
   * getImprovementReport — Return the improvement trajectory.
   */
  getImprovementReport(): ImprovementTrajectory {
    const timeline = [...this.state.scoreHistory];
    const total = timeline.length;

    // Determine trend: compare first half average to second half average
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (total >= 4) {
      const mid = Math.floor(total / 2);
      const firstHalf = timeline.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
      const secondHalf = timeline.slice(mid).reduce((s, v) => s + v, 0) / (total - mid);
      const delta = secondHalf - firstHalf;
      if (delta > 0.05) trend = 'improving';
      else if (delta < -0.05) trend = 'declining';
    }

    return {
      totalExecutions: total,
      avgScoreTimeline: timeline,
      learningActionsTaken: this.state.appliedLearningActions.length,
      templatesEvolved: this.state.lastTemplateEvolutionAt > 0 ? 1 : 0,
      weightsAutoTuned: this.state.lastWeightTuningAt > 0 ? 1 : 0,
      trend,
    };
  }

  /**
   * getCurrentWeight — Get the current weight for a dimension.
   */
  private getCurrentWeight(dimension: string): number {
    const defaults = DEFAULT_RISK_APPETITE_PROFILE.balanced;
    const dim = dimension as keyof WeightConfiguration;
    return defaults[dim] ?? 0.15;
  }

  /**
   * averageDimScores — Compute average per-dimension scores for a set of records.
   */
  private averageDimScores(records: PlanExecutionRecord[]): Record<string, number> {
    const dims = ['stability', 'latency', 'security', 'alignment', 'healing', 'knowledge'];
    const totals: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const dim of dims) {
      totals[dim] = 0;
      counts[dim] = 0;
    }

    for (const rec of records) {
      // Approximate dimension scores from execution record data
      const stability = rec.dagNodes.length > 0
        ? rec.dagNodes.filter(n => n.status === 'success').length / rec.dagNodes.length
        : (rec.success ? 1.0 : 0.0);
      const latency = rec.totalDurationMs > 0
        ? Math.max(0, 1 - Math.min(rec.totalDurationMs / 120000, 1))
        : 0.5;
      const security = rec.artifactCount > 0 ? Math.min(1, rec.artifactCount * 0.2) : 0.3;
      const alignment = rec.inputTags.length > 0 ? Math.min(1, rec.inputTags.length * 0.15) : 0.5;
      const healing = rec.selfHealingRetries > 0 ? Math.max(0, 1 - rec.selfHealingRetries * 0.2) : 1.0;
      const knowledge = rec.score > 0 ? Math.min(1, rec.score * 1.2) : 0.3;

      totals.stability += stability;
      totals.latency += latency;
      totals.security += security;
      totals.alignment += alignment;
      totals.healing += healing;
      totals.knowledge += knowledge;
      for (const dim of dims) counts[dim]++;
    }

    const averages: Record<string, number> = {};
    for (const dim of dims) {
      averages[dim] = counts[dim] > 0 ? totals[dim] / counts[dim] : 0.5;
    }
    return averages;
  }
}
