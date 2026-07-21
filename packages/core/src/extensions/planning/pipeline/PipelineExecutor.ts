/**
 * PipelineExecutor.ts — 7-Stage Planning Pipeline Executor
 *
 * RESPONSIBILITY:
 *   Execute the 7-Stage deterministic planning pipeline (S1–S7) for the MetaPlanner.
 *   This module is the extracted pipeline engine from the original MetaPlanner.ts
 *   (v2.5). It handles intent analysis, experience retrieval, candidate generation,
 *   DES simulation, MCDA evaluation, decision tracing, and best plan selection.
 *
 * INPUT:
 *   PipelineInput — userInput, sessionId, executionId, tags, sessionCtx, milestones
 *   PipelineDeps — all external dependencies (pipelineLogger, modelRegistry, store, etc.)
 *
 * OUTPUT:
 *   { trace: PipelineTrace, activation: PlanActivationResult }
 *
 * DEPENDENCIES:
 *   - PipelineLogger (structured trace logging)
 *   - PlanExperienceStore (experience query)
 *   - PlanAnalyzer (MCDA topology comparison)
 *   - DeviationGuard (deviation counting)
 *   - TopologyExplorer (DAG ordering optimization)
 *   - modelRegistry (LLM provider for Stage 3)
 *   - knowledgeGraph (KG entity search for Stage 1)
 *   - vectorStore (semantic search for Stage 2)
 *   - artifactRegistry (resource token reservation for Stage 7)
 *
 * DESIGN CONSTRAINTS:
 *   - Single Responsibility: only pipeline execution, no extension lifecycle, no event bridging
 *   - One-way dependency: MetaPlanner → PipelineExecutor (no back-reference)
 *   - All stages log via PipelineLogger and emit EventBus events via MetaPlanner
 *   - Errors produce PipelineStageResult.status = 'failed' + error field (no swallowed exceptions)
 *   - No LLM calls beyond the existing Stage 3 invocation
 *
 * @see MetaPlanner.ts — orchestrator that creates and calls PipelineExecutor
 * @see types.ts — all pipeline type contracts
 * @see PipelineLogger.ts — structured trace logging
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { SessionContext } from '../../../common/types.js';
import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { DAGNode } from '../../../domains/types.js';

import type {
  MetaPlannerV2Config,
  Milestone,
  IntentAnalysisResult,
  SemanticTag,
  ExperienceQueryResult,
  VectorMatch,
  ICandidatePlansOutput,
  CandidatePlanProfile,
  IShadowSimulationReport,
  DESNodeResult,
  ShadowContext,
  ResourceContention,
  SimulatedExceptionTrace,
  ResourceBottleneck,
  IEvaluationScorecard,
  ProfileScore,
  WeightConfiguration,
  ScoreBreakdownEntry,
  DecisionTrace,
  CandidateElimination,
  WinnerSelection,
  PlanActivationResult,
  PipelineStageResult,
  PipelineTrace,
} from '../types.js';
import type { PipelineStageNumber } from '../types.js';
import {
  DEFAULT_RISK_APPETITE_PROFILE,
  PIPELINE_ABORT_THRESHOLDS,
  PIPELINE_STAGE_NAMES,
  DEFAULT_DES_CONFIG,
} from '../types.js';
import { PipelineLogger, oneLinePipelineStatus } from '../PipelineLogger.js';
import {
  STAGE1_INTENT_ANALYSIS_SYSTEM_PROMPT,
  STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT,
  FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION,
} from '../prompts.config.js';
import { PlanExperienceStore } from '../PlanExperienceStore.js';
import { PlanAnalyzer } from '../PlanAnalyzer.js';
import { MemoryWiki, MemoryRetriever, JSONLWriter } from '../../../../../memory/src/index.js';
import { DeviationGuard } from '../guards/DeviationGuard.js';
import { TopologyExplorer } from '../engines/TopologyExplorer.js';
import { HierarchicalCandidateGenerator, StatisticalPlanSimulator, WeightedPlanEvaluator } from '../engines/HierarchicalPlanningEngine.js';

// ═══════════════════════════════════════════════════════════════════════
// Module-Level Helper Functions (no `this` usage)
// ═══════════════════════════════════════════════════════════════════════

/**
 * seededRandom — Deterministic pseudo-random based on a seed string
 */
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // convert to 32bit int
  }
  // Simple multiplicative congruential generator
  const x = Math.abs(hash) % 2147483647;
  return (x * 16807) % 2147483647 / 2147483647;
}

/**
 * topologicalSort — Return node IDs in dependency order
 */
function topologicalSort(nodes: ExecutionDAG['nodes']): string[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    const id = node.taskId;
    adj.set(id, []);
    if (!inDegree.has(id)) inDegree.set(id, 0);
  }

  for (const node of nodes) {
    const id = node.taskId;
    for (const dep of node.deps ?? []) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const neighbor of adj.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return result;
}

/**
 * findDownstreamNodes — Mark downstream nodes with cascade failures
 */
function findDownstreamNodes(
  failedNodeId: string,
  nodes: ExecutionDAG['nodes'],
  topoOrder: string[],
  nodeResults: DESNodeResult[],
): void {
  const downstream = new Set<string>();
  const findDependents = (nodeId: string) => {
    for (const node of nodes) {
      if ((node.deps ?? []).includes(nodeId)) {
        const childId = node.taskId;
        if (!downstream.has(childId)) {
          downstream.add(childId);
          findDependents(childId);
        }
      }
    }
  };
  findDependents(failedNodeId);

  for (const result of nodeResults) {
    if (downstream.has(result.nodeId) && !result.cascadeFailures.includes(failedNodeId)) {
      result.cascadeFailures.push(failedNodeId);
    }
  }
}

/**
 * skippedStage — Create a "skipped" stage result (for aborted pipelines)
 */
function skippedStage(stage: PipelineStageNumber): PipelineStageResult {
  return {
    stage,
    status: 'skipped',
    durationMs: 0,
    output: null as any,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════

export interface PipelineExecutorConfig {
  /** DES configuration overrides */
  desConfig: Partial<typeof DEFAULT_DES_CONFIG>;
  /** Base path for trace logs */
  traceLogPath: string;
}

export interface PipelineDeps {
  pipelineLogger: PipelineLogger;
  /** LLM provider for Stage 3 candidate generation */
  modelRegistry: ModelRegistry;
  /** DES config (merged with defaults) */
  desConfig: typeof DEFAULT_DES_CONFIG;
  /** Plan experience store */
  store: PlanExperienceStore;
  /** Knowledge graph for Stage 1 intent analysis */
  knowledgeGraph: KnowledgeGraphService;
  /** Vector store for Stage 2 experience retrieval */
  vectorStore: VectorStoreService;
  /** Topology explorer (DAG ordering optimization) */
  topologyExplorer: TopologyExplorer | null;
  /** Plan analyzer for MCDA topology comparison */
  analyzer: PlanAnalyzer;
  /** Deviation guard for counting deviations per session */
  deviationGuard: DeviationGuard;
  /** Base path for trace logs */
  traceLogPath: string;
  /** Artifact registry for resource token reservation */
  artifactRegistry: ArtifactRegistryService;
  /** ★ v2.6 Optional: HierarchicalPlanningEngine components for statistical candidate generation (replaces LLM S3) */
  hierarchicalPlanner?: { candidateGenerator: HierarchicalCandidateGenerator; simulator: StatisticalPlanSimulator; evaluator: WeightedPlanEvaluator } | null;
  /** ★ Phase 4: MemoryWiki for SQLite-first reads */
  wiki?: MemoryWiki | null;
  /** ★ Agent 记忆优先检索 */
  memoryRetriever?: MemoryRetriever | null;
}

// ── External service types (opaque: external lib APIs, unpinned types) ──
// These services are injected at runtime from pi-ai/pi-agent-core.
// The `unknown` base prevents unsound access while eslint-disable allows
// the dynamic property access that the external API requires.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelRegistry = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnowledgeGraphService = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VectorStoreService = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArtifactRegistryService = any;

export interface PipelineInput {
  userInput: string;
  sessionId: string;
  executionId: string;
  tags: string[];
  sessionCtx?: SessionContext;
  milestones: Milestone[];
}

// ═══════════════════════════════════════════════════════════════════════
// PipelineExecutor Class
// ═══════════════════════════════════════════════════════════════════════

export class PipelineExecutor {
  // ── Dependencies (assigned in constructor) ──
  private pipelineLogger: PipelineLogger;
  private modelRegistry: ModelRegistry;
  private desConfig: typeof DEFAULT_DES_CONFIG;
  private store: PlanExperienceStore;
  private knowledgeGraph: KnowledgeGraphService;
  private vectorStore: VectorStoreService;
  private topologyExplorer: TopologyExplorer | null;
  private hierarchicalPlanner: { candidateGenerator: HierarchicalCandidateGenerator; simulator: StatisticalPlanSimulator; evaluator: WeightedPlanEvaluator } | null;
  private analyzer: PlanAnalyzer;
  private deviationGuard: DeviationGuard;
  private traceLogPath: string;
  private artifactRegistry: ArtifactRegistryService;
  /** ★ MemoryWiki 实例（SQLite 优先读取） */
  private wiki: MemoryWiki | null = null;
  /** ★ Agent 记忆优先检索 */
  private memoryRetriever: MemoryRetriever | null = null;
  /** ★ 当前 pipeline 的记忆上下文（S3 可注入 LLM） */
  memoryContext: string = '';
  /** JSONLWriter 微批处理写入器 */
  private traceWriter: JSONLWriter | null = null;
  private decisionWriter: JSONLWriter | null = null;

  constructor(deps: PipelineDeps) {
    this.pipelineLogger = deps.pipelineLogger;
    this.modelRegistry = deps.modelRegistry;
    this.desConfig = deps.desConfig;
    this.store = deps.store;
    this.knowledgeGraph = deps.knowledgeGraph;
    this.vectorStore = deps.vectorStore;
    this.topologyExplorer = deps.topologyExplorer;
    this.hierarchicalPlanner = deps.hierarchicalPlanner ?? null;
    this.analyzer = deps.analyzer;
    this.deviationGuard = deps.deviationGuard;
    this.traceLogPath = deps.traceLogPath;
    this.artifactRegistry = deps.artifactRegistry;
    this.wiki = deps.wiki ?? null;
    this.memoryRetriever = deps.memoryRetriever ?? null;
    // 初始化 JSONLWriter（微批处理）
    const traceDir = path.dirname(this.traceLogPath + 'pipeline-traces.jsonl');
    this.traceWriter = new JSONLWriter({ filePath: path.join(traceDir, 'pipeline-traces.jsonl') });
    this.decisionWriter = new JSONLWriter({ filePath: path.join(traceDir, 'decision-traces.jsonl') });
  }

  /** ★ MemoryWiki 注入（SQLite 双写后端） */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * execute — Execute the full 7-Stage planning pipeline
   *
   * Stages are executed sequentially. If a stage fails, the pipeline attempts
   * to continue using fallback/empty data unless the failure crosses the
   * abort threshold. Returns a complete PipelineTrace + PlanActivationResult.
   *
   * @param params - Pipeline input parameters
   * @returns Full pipeline trace and activation result
   */
  async execute(params: PipelineInput): Promise<{ trace: PipelineTrace; activation: PlanActivationResult }> {
    const { userInput, sessionId, executionId, tags, sessionCtx, milestones } = params;
    const pipelineId = `pl_${executionId}_${Date.now()}`;
    const startedAt = Date.now();
    let aborted = false;
    let abortReason: string | undefined;

    // Storage for stage results (exactly 7)
    const stages: PipelineStageResult[] = [];

    // Stage outputs carried forward
    let intentResult: IntentAnalysisResult | null = null;
    let experienceResult: ExperienceQueryResult | null = null;
    let candidatesOutput: ICandidatePlansOutput | null = null;
    let simulationReports: IShadowSimulationReport[] | null = null;
    let scorecard: IEvaluationScorecard | null = null;
    let decisionTrace: DecisionTrace | null = null;
    let activationResult: PlanActivationResult | null = null;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 1: Intent Analysis
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const sStart = Date.now();
      try {
        intentResult = await this.stage1IntentAnalysis(userInput, tags, sessionCtx, milestones);
        const sResult: PipelineStageResult = {
          stage: 1, status: 'completed', durationMs: Date.now() - sStart, output: intentResult,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);

        // Abort check
        if (intentResult.confidenceScore < PIPELINE_ABORT_THRESHOLDS.intentConfidenceMin) {
          aborted = true;
          abortReason = intentResult.abortReason ?? `Intent confidence ${intentResult.confidenceScore.toFixed(3)} below threshold ${PIPELINE_ABORT_THRESHOLDS.intentConfidenceMin}`;
        }
      } catch (err: unknown) {
        const sResult: PipelineStageResult = {
          stage: 1, status: 'failed', durationMs: Date.now() - sStart,
          output: {
            intentId: `int_${executionId}`,
            rawInput: userInput,
            tags: tags.map(t => ({ tag: t, score: 0.5, category: 'domain' as const, source: 'regex' as const })),
            targetStateMatrix: {},
            explicitConstraints: {},
            implicitConstraints: [],
            confidenceScore: 0.2,
            abortReason: (err as Error).message,
            analyzedAt: Date.now(),
          } as IntentAnalysisResult,
          error: (err as Error).message,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
        aborted = true;
        abortReason = (err as Error).message;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 2: Experience Retrieval
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!aborted) {
      const sStart = Date.now();
      try {
        experienceResult = await this.stage2ExperienceRetrieval(userInput, tags, intentResult!);
        const sResult: PipelineStageResult = {
          stage: 2, status: 'completed', durationMs: Date.now() - sStart, output: experienceResult,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      } catch (err: unknown) {
        experienceResult = {
          positiveSamples: [],
          negativeSamples: [],
          vectorMatches: [],
          totalCandidates: 0,
          queriedAt: Date.now(),
        };
        const sResult: PipelineStageResult = {
          stage: 2, status: 'failed', durationMs: Date.now() - sStart,
          output: experienceResult,
          error: (err as Error).message,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      }
    } else {
      stages.push(skippedStage(2));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 3: Candidate Plan Generation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!aborted) {
      const sStart = Date.now();
      try {
        candidatesOutput = await this.stage3CandidateGeneration(
          userInput, tags, intentResult!, experienceResult!, sessionCtx,
        );
        const sResult: PipelineStageResult = {
          stage: 3, status: 'completed', durationMs: Date.now() - sStart, output: candidatesOutput,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);

        // Abort if no valid candidates
        if (!candidatesOutput.validationPassed && !candidatesOutput.fallbackTemplateUsed) {
          aborted = true;
          abortReason = `Candidate generation validation failed: ${(candidatesOutput.validationErrors ?? ['unknown']).join('; ')}`;
        }
      } catch (err: unknown) {
        // Fallback: generate a minimal defensive template
        candidatesOutput = await this.generateFallbackCandidates(userInput, tags, executionId);
        const sResult: PipelineStageResult = {
          stage: 3, status: 'completed', durationMs: Date.now() - sStart,
          output: candidatesOutput,
          error: `LLM generation failed, using fallback: ${(err as Error).message}`,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      }
    } else {
      stages.push(skippedStage(3));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 4: Plan Simulation (DES)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!aborted && candidatesOutput) {
      const sStart = Date.now();
      try {
        simulationReports = await this.stage4PlanSimulation(candidatesOutput, experienceResult);
        const sResult: PipelineStageResult = {
          stage: 4, status: 'completed', durationMs: Date.now() - sStart, output: simulationReports,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);

        // Check if any profile has acceptable survival probability
        const viableProfiles = simulationReports.filter(r => r.survivalProbability >= PIPELINE_ABORT_THRESHOLDS.simulationSurvivalMin);
        if (viableProfiles.length === 0) {
          aborted = true;
          abortReason = `No profile meets minimum survival threshold (${PIPELINE_ABORT_THRESHOLDS.simulationSurvivalMin})`;
        }
      } catch (err: unknown) {
        const sResult: PipelineStageResult = {
          stage: 4, status: 'failed', durationMs: Date.now() - sStart,
          output: [] as IShadowSimulationReport[],
          error: (err as Error).message,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
        aborted = true;
        abortReason = (err as Error).message;
      }
    } else {
      stages.push(skippedStage(4));
      simulationReports = [];
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 5: Plan Evaluation (MCDA)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!aborted && simulationReports && simulationReports.length > 0) {
      const sStart = Date.now();
      try {
        scorecard = await this.stage5PlanEvaluation(
          simulationReports,
          candidatesOutput!,
          intentResult!,
          experienceResult,
          sessionId,
        );
        const sResult: PipelineStageResult = {
          stage: 5, status: 'completed', durationMs: Date.now() - sStart, output: scorecard,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);

        // Abort if winner score is too low
        if (scorecard.winnerScore < PIPELINE_ABORT_THRESHOLDS.winnerScoreMin) {
          aborted = true;
          abortReason = `Winner score ${scorecard.winnerScore.toFixed(3)} below threshold ${PIPELINE_ABORT_THRESHOLDS.winnerScoreMin}`;
        }
      } catch (err: unknown) {
        const sResult: PipelineStageResult = {
          stage: 5, status: 'failed', durationMs: Date.now() - sStart,
          output: {
            evaluationId: `eval_${executionId}`,
            evaluatedAt: Date.now(),
            profiles: {
              aggressive: { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0, composite: 0 },
              defensive: { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0, composite: 0 },
              fallback: { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0, composite: 0 },
            },
            weightConfiguration: DEFAULT_RISK_APPETITE_PROFILE.balanced,
            winner: 'defensive',
            winnerScore: 0,
            scoreBreakdown: [],
          } as IEvaluationScorecard,
          error: (err as Error).message,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
        aborted = true;
        abortReason = (err as Error).message;
      }
    } else {
      stages.push(skippedStage(5));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 6: Decision Trace
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!aborted && scorecard) {
      const sStart = Date.now();
      try {
        decisionTrace = await this.stage6DecisionTrace(
          scorecard,
          simulationReports!,
          candidatesOutput!,
          sessionId,
          executionId,
        );
        const sResult: PipelineStageResult = {
          stage: 6, status: 'completed', durationMs: Date.now() - sStart, output: decisionTrace,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      } catch (err: unknown) {
        const sResult: PipelineStageResult = {
          stage: 6, status: 'failed', durationMs: Date.now() - sStart,
          output: {
            traceId: `trace_${executionId}`,
            sessionId,
            executionId,
            evaluatedAt: Date.now(),
            candidateEliminations: [],
            winnerSelection: { profile: scorecard.winner, rationale: 'Fallback due to trace error', riskAdjustedWeights: {} },
            deviationCount: this.deviationGuard.getDeviationCount(sessionId),
            riskAppetite: 'balanced',
            writtenToDisk: false,
          } as DecisionTrace,
          error: (err as Error).message,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      }
    } else {
      stages.push(skippedStage(6));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Stage 7: Best Plan Selection & Activation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!aborted && scorecard && decisionTrace) {
      const sStart = Date.now();
      try {
        activationResult = await this.stage7BestPlanSelection(
          scorecard,
          decisionTrace,
          candidatesOutput!,
          simulationReports!,
          sessionId,
          executionId,
        );
        const sResult: PipelineStageResult = {
          stage: 7, status: 'completed', durationMs: Date.now() - sStart, output: activationResult,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      } catch (err: unknown) {
        // Last resort: pick defensive profile
        activationResult = this.buildFallbackActivation(candidatesOutput!, decisionTrace, executionId);
        const sResult: PipelineStageResult = {
          stage: 7, status: 'completed', durationMs: Date.now() - sStart,
          output: activationResult,
          error: `Selection failed, using fallback: ${(err as Error).message}`,
        };
        stages.push(sResult);
        this.pipelineLogger.logStage(sResult);
      }
    } else {
      // If aborted or missing data, build a minimal fallback activation
      const fallbackDecisionTrace: DecisionTrace = decisionTrace ?? {
        traceId: `trace_fb_${executionId}`,
        sessionId,
        executionId,
        evaluatedAt: Date.now(),
        candidateEliminations: [],
        winnerSelection: { profile: 'defensive', rationale: 'Fallback due to pipeline abort', riskAdjustedWeights: {} },
        deviationCount: this.deviationGuard.getDeviationCount(sessionId),
        riskAppetite: 'stability',
        writtenToDisk: false,
      };
      activationResult = this.buildFallbackActivation(candidatesOutput, fallbackDecisionTrace, executionId);
      const sResult: PipelineStageResult = {
        stage: 7, status: 'completed' as const, durationMs: 0,
        output: activationResult,
        error: aborted ? `Pipeline aborted: ${abortReason}` : 'Missing evaluation data',
      };
      stages.push(sResult);
      this.pipelineLogger.logStage(sResult);
    }

    // ── Fill missing stages (if pipeline aborted early) ──
    while (stages.length < 7) {
      stages.push(skippedStage((stages.length + 1) as any));
    }

    // ── Build full pipeline trace ──
    const completedAt = Date.now();
    const trace: PipelineTrace = {
      pipelineId,
      sessionId,
      executionId,
      startedAt,
      completedAt,
      stages: stages as unknown as PipelineTrace['stages'],
      aborted,
      abortReason,
    };

    // ── Persist trace to JSONL（微批处理）──
    try {
      this.traceWriter!.append(JSON.parse(this.pipelineLogger.serializeTraceToJSONL(trace)));
    } catch { /* non-critical */ }

    // ── Render full pipeline trace to terminal ──
    this.pipelineLogger.logPipelineTrace(trace);

    return { trace, activation: activationResult! };
  }

  /**
   * simulateDES — Run DES simulation on candidate plans (public, reusable)
   *
   * This method is exposed for TopologyExplorer and other consumers to
   * run DES simulations independently. It runs topology exploration,
   * volatility matrix computation, and stochastic simulation runs.
   *
   * @param candidates - Array of candidate plan profiles to simulate
   * @param experience - Historical experience data (for volatility calibration)
   * @param config - Optional DES config overrides
   * @returns Array of simulation reports
   */
  async simulateDES(
    candidates: CandidatePlanProfile[],
    experience: ExperienceQueryResult | null,
    config?: Partial<typeof DEFAULT_DES_CONFIG>,
  ): Promise<IShadowSimulationReport[]> {
    const localDesConfig = config ? { ...this.desConfig, ...config } : this.desConfig;
    const reports: IShadowSimulationReport[] = [];

    // Build volatility matrix from negative samples
    const volatilityMatrix = this.buildVolatilityMatrix(experience);

    for (const candidate of candidates) {
      const simulations: IShadowSimulationReport[] = [];

      // Run 3 shadow contexts for stochastic averaging
      for (let runSeed = 0; runSeed < 3; runSeed++) {
        const shadowCtx: ShadowContext = {
          contextId: `shadow_${candidate.profileId}_run${runSeed}`,
          sourceSessionId: 'pipeline',
          clonedAt: Date.now(),
          stateSnapshot: new Map(),
          resourceLocks: new Set(),
          isDirty: false,
        };

        const report = this.simulateSingleRun(candidate, volatilityMatrix, shadowCtx, runSeed, localDesConfig);
        simulations.push(report);
      }

      // Average the 3 simulation runs
      const averaged = this.averageSimulations(simulations, candidate.profileId, candidate.strategy);
      reports.push(averaged);
    }

    return reports;
  }

  /**
   * evaluateMCDA — Multi-Criteria Decision Analysis scoring (public, reusable)
   *
   * Exposed for PlanAnalyzer and other consumers to evaluate plans using
   * the same weighted MCDA framework as the pipeline.
   *
   * @param simulations - Simulation reports for each candidate
   * @param candidates - Candidate plan profiles
   * @param intent - Intent analysis result
   * @param experience - Historical experience data
   * @param deviationCount - Current session deviation count (for risk appetite)
   * @returns Evaluation scorecard with winner
   */
  evaluateMCDA(
    simulations: IShadowSimulationReport[],
    candidates: CandidatePlanProfile[],
    intent: IntentAnalysisResult,
    experience: ExperienceQueryResult | null,
    deviationCount: number,
  ): IEvaluationScorecard {
    // Same logic as private stage5PlanEvaluation but accepting pre-computed data
    const riskAppetite: 'efficiency' | 'balanced' | 'stability' = deviationCount === 0 ? 'efficiency' : 'stability';
    const weights = { ...DEFAULT_RISK_APPETITE_PROFILE[riskAppetite] };

    const maxLatency = Math.max(...simulations.map(r => r.totalSimulatedLatencyMs), 1);
    const maxNodes = Math.max(...candidates.map(c => c.riskProfile.nodeCount), 1);
    const maxSecurity = Math.max(...candidates.map(c => c.riskProfile.securityCheckpoints + c.riskProfile.visionAlignmentNodes), 1);
    const maxRetries = this.desConfig.maxRetriesPerNode;

    const profileScores: Record<string, ProfileScore> = {};
    const scoreBreakdown: ScoreBreakdownEntry[] = [];

    for (const report of simulations) {
      const candidate = candidates.find(c => c.profileId === report.profileId);
      if (!candidate) continue;

      const totalNodes = report.nodeResults.length;
      const totalRetries = report.nodeResults.reduce((s, n) => s + n.retryCount, 0);

      // Dimension scores (0-1)
      const stability = totalNodes > 0 ? 1 - report.failedNodes / totalNodes : 0.5;
      const latency = maxLatency > 0 ? 1 - Math.min(report.totalSimulatedLatencyMs / maxLatency, 1) : 0.5;
      const security = maxSecurity > 0 ? Math.min((candidate.riskProfile.securityCheckpoints + candidate.riskProfile.visionAlignmentNodes) / maxSecurity, 1) : 0.3;
      const alignment = this.computeAlignmentScore(candidate, intent);
      const healing = maxRetries > 0 ? 1 - Math.min(totalRetries / (totalNodes * maxRetries), 1) : 0.5;
      const knowledge = this.computeKnowledgeScore(candidate, experience);

      // Weight composite
      const composite =
        weights.stability * stability +
        weights.latency * latency +
        weights.security * security +
        weights.alignment * alignment +
        weights.healing * healing +
        weights.knowledge * knowledge;

      profileScores[report.strategy] = { stability, latency, security, alignment, healing, knowledge, composite };

      // Build breakdown entries
      const dims = ['stability', 'latency', 'security', 'alignment', 'healing', 'knowledge'] as const;
      for (const dim of dims) {
        scoreBreakdown.push({
          profile: report.strategy,
          dimension: dim,
          rawScore: profileScores[report.strategy][dim],
          weightedScore: profileScores[report.strategy][dim] * weights[dim],
        });
      }
    }

    // ── Topology Variant Comparison — historical ordering optimization ──
    let topologyMetadata: Record<string, unknown> | undefined;
    try {
      const winnerProfile = candidates.find(c => c.strategy === (Object.entries(profileScores).sort((a, b) => b[1].composite - a[1].composite)[0]?.[0] ?? 'defensive'));
      if (winnerProfile) {
        const nodeRoles = winnerProfile.dag.nodes.map(n => n.taskId);
        const domains = winnerProfile.dag.nodes.map(n => n.domain || 'general');
        const topologyComparison = this.analyzer.compareTopologyVariants(nodeRoles, domains);
        if (topologyComparison.isSignificant && topologyComparison.bestVariant) {
          const currentSig = this.analyzer.computeTopologySignature(nodeRoles, domains);
          if (currentSig.signature !== topologyComparison.bestVariant.signature.signature) {
            topologyMetadata = {
              topologyRecommendation: {
                currentOrdering: nodeRoles,
                recommendedOrdering: topologyComparison.recommendedOrdering,
                bestHistoricalSuccessRate: topologyComparison.bestVariant.successRate,
                confidence: topologyComparison.confidence,
                variants: topologyComparison.variants.map(v => ({
                  ordering: v.signature.nodeSequence.map(n => n.role).join('→'),
                  successRate: v.successRate,
                  attempts: v.totalAttempts,
                })),
              },
            };
          }
        }
      }
    } catch { /* topology comparison is non-critical */ }

    // Determine winner
    const sorted = Object.entries(profileScores).sort((a, b) => b[1].composite - a[1].composite);
    const winner = sorted[0][0] as 'aggressive' | 'defensive' | 'fallback';
    const winnerScore = sorted[0][1].composite;

    return {
      metadata: topologyMetadata,
      evaluationId: `eval_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      evaluatedAt: Date.now(),
      profiles: {
        aggressive: profileScores['aggressive'] ?? { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0, composite: 0 },
        defensive: profileScores['defensive'] ?? { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0, composite: 0 },
        fallback: profileScores['fallback'] ?? { stability: 0, latency: 0, security: 0, alignment: 0, healing: 0, knowledge: 0, composite: 0 },
      },
      weightConfiguration: weights,
      winner,
      winnerScore,
      scoreBreakdown,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 1: Intent Analysis Implementation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage1IntentAnalysis — Analyze user intent and produce structured intent
   *
   * Converts simple regex tags to semantic tags, cross-references with
   * KnowledgeGraph if available, infers target state matrix, parses explicit
   * and implicit constraints, and computes a confidence score.
   */
  private async stage1IntentAnalysis(
    userInput: string,
    tags: string[],
    sessionCtx?: SessionContext,
    milestones?: Milestone[],
  ): Promise<IntentAnalysisResult> {
    const analyzedAt = Date.now();
    const intentId = `int_${analyzedAt}_${crypto.randomBytes(4).toString('hex')}`;

    // Convert simple regex tags to semantic tags
    const semanticTags: SemanticTag[] = tags.map(t => ({
      tag: t,
      score: 0.5,
      category: this.categorizeTag(t),
      source: 'regex',
    }));

    // Cross-reference with KnowledgeGraph if available
    if (this.knowledgeGraph) {
      try {
        const kgEntities = this.knowledgeGraph.searchEntities({ text: userInput, limit: 5 });
        if (kgEntities?.length > 0) {
          for (const entity of kgEntities) {
            const tagName = entity.type?.toLowerCase() ?? entity.domain?.toLowerCase();
            if (tagName && !semanticTags.find(st => st.tag === tagName)) {
              semanticTags.push({
                tag: tagName,
                score: entity.relevance ?? 0.7,
                category: 'domain',
                source: 'kg',
              });
            }
          }
        }
      } catch { /* KG query is non-critical */ }
    }

    // Infer target state matrix
    const targetStateMatrix: Record<string, any> = {
      complexity: userInput.length > 200 ? 'high' : userInput.length > 80 ? 'medium' : 'low',
      expectedNodes: Math.min(Math.max(Math.ceil(userInput.length / 100), 3), 12),
    };

    // Parse explicit constraints
    const explicitConstraints: Record<string, any> = {};
    const constraintPatterns: Array<[RegExp, string]> = [
      [/(?:within|in|under|less than)\s+(\d+)\s*(?:min|mins|minute)/i, 'maxDurationMs'],
      [/(?:use|using|with)\s+(python|javascript|typescript|rust|go)\b/i, 'preferredLanguage'],
      [/(?:avoid|no|without)\s+(\w+)/i, 'avoidFeatures'],
    ];
    for (const [re, key] of constraintPatterns) {
      const match = userInput.match(re);
      if (match) {
        if (key === 'maxDurationMs') explicitConstraints[key] = parseInt(match[1], 10) * 60000;
        else explicitConstraints[key] = match[1];
      }
    }

    // Infer implicit constraints
    const implicitConstraints: string[] = [];
    if (userInput.includes('interrupt') || userInput.includes('risk') || milestones?.some(m => m.priority >= 8)) {
      implicitConstraints.push('high_stability_required');
    }
    if (userInput.includes('resource') || userInput.includes('memory') || userInput.includes('limited')) {
      implicitConstraints.push('resource_constrained');
    }
    if (userInput.includes('test') || userInput.includes('qa') || userInput.includes('quality')) {
      implicitConstraints.push('testing_required');
    }

    // Compute confidence score
    let confidenceScore = 0.3;
    if (semanticTags.length >= 2) confidenceScore += 0.15;
    if (semanticTags.length >= 4) confidenceScore += 0.1;
    if (Object.keys(explicitConstraints).length > 0) confidenceScore += 0.1;
    if (userInput.length >= 50) confidenceScore += 0.1;
    if (this.knowledgeGraph) confidenceScore += 0.05;
    if (milestones && milestones.length > 0) confidenceScore += 0.1;
    if (userInput.includes('plan') || userInput.includes('strategy')) confidenceScore += 0.05;
    confidenceScore = Math.min(1, Math.max(0.1, confidenceScore));

    // Abort check
    let abortReason: string | undefined;
    if (confidenceScore < PIPELINE_ABORT_THRESHOLDS.intentConfidenceMin) {
      abortReason = `Intent confidence ${confidenceScore.toFixed(3)} < threshold ${PIPELINE_ABORT_THRESHOLDS.intentConfidenceMin}`;
    }

    return {
      intentId,
      rawInput: userInput,
      tags: semanticTags,
      targetStateMatrix,
      explicitConstraints,
      implicitConstraints,
      confidenceScore,
      abortReason,
      analyzedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 2: Experience Retrieval Implementation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage2ExperienceRetrieval — Query historical experience for similar plans
   *
   * Queries PlanExperienceStore for structural layout matches and VectorStore
   * for cosine similarity matches. Combines results into a unified experience
   * query result.
   */
  private async stage2ExperienceRetrieval(
    userInput: string,
    tags: string[],
    intent?: IntentAnalysisResult,
  ): Promise<ExperienceQueryResult> {
    const queriedAt = Date.now();
    const positiveSamples: ExperienceQueryResult['positiveSamples'] = [];
    const negativeSamples: ExperienceQueryResult['negativeSamples'] = [];
    const vectorMatches: VectorMatch[] = [];

    // ★ Agent 记忆优先检索：查 docs + past plans + KG
    this.memoryContext = '';
    if (this.memoryRetriever) {
      try {
        const retrieval = this.memoryRetriever.retrieveForTask(userInput, tags);
        if (retrieval.found) {
          this.memoryContext = retrieval.context;
          console.log(`[MemoryRetriever] ✅ ${retrieval.source}: ${retrieval.snippets.length} snippets`);
        }
      } catch (err: unknown) {
        console.warn(`[MemoryRetriever] ⚠️ ${(err as Error).message}`);
      }
    }

    // ★ P3: 并行查询 PlanExperienceStore + VectorStore
    const [queryResult, vectorIds] = await Promise.all([
      // Query PlanExperienceStore for structural layout matches
      this.store
        ? Promise.resolve(this.store.queryByTags?.(tags, 20) ?? []).then(allRecords => {
            const pos: typeof positiveSamples = [];
            const neg: typeof negativeSamples = [];
            for (const record of allRecords) {
              const dagNodes = (record as any).dagNodes ?? [];
              if (dagNodes.length === 0) continue;
              if (record.success) {
                pos.push({
                  executionId: record.executionId,
                  templateId: record.inputTags?.join('_') ?? 'unknown',
                  dagNodes: dagNodes.map((n: Record<string, unknown>) => ({
                    role: n.role,
                    domain: n.domain,
                    dependsOn: [] as string[],
                  })),
                  totalDurationMs: record.totalDurationMs ?? 0,
                  totalTokensUsed: record.totalTokensUsed ?? 0,
                } as any);
              } else {
                neg.push({
                  executionId: record.executionId,
                  templateId: record.inputTags?.join('_') ?? 'unknown',
                  dagNodes: dagNodes.map((n: Record<string, unknown>) => ({
                    role: n.role,
                    domain: n.domain,
                    dependsOn: [] as string[],
                  })),
                  errorCategory: record.failureDetails?.[0]?.category ?? 'unknown',
                  failedAt: Date.now(),
                } as any);
              }
            }
            return { pos, neg };
          }).catch(() => ({ pos: [], neg: [] } as { pos: typeof positiveSamples; neg: typeof negativeSamples }))
        : Promise.resolve({ pos: [], neg: [] } as { pos: typeof positiveSamples; neg: typeof negativeSamples }),

      // Query VectorStore for cosine similarity
      this.vectorStore?.search
        ? this.vectorStore.search(userInput, 15).then((ids: string[]) => {
            const matches: VectorMatch[] = [];
            if (ids?.length) {
              for (let i = 0; i < ids.length; i++) {
                matches.push({
                  recordId: ids[i],
                  similarity: Math.max(0, 1 - i / ids.length),
                  keyInsight: '',
                });
              }
            }
            return matches;
          }).catch(() => [] as VectorMatch[])
        : Promise.resolve([] as VectorMatch[]),
    ]);

    positiveSamples.push(...queryResult.pos);
    negativeSamples.push(...queryResult.neg);
    vectorMatches.push(...vectorIds);

    // Deduplicate by executionId
    const seenExIds = new Set<string>();
    const dedupedPositive = positiveSamples.filter(s => {
      if (seenExIds.has(s.executionId)) return false;
      seenExIds.add(s.executionId);
      return true;
    });
    const dedupedNegative = negativeSamples.filter(s => {
      if (seenExIds.has(s.executionId)) return false;
      seenExIds.add(s.executionId);
      return true;
    });

    return {
      positiveSamples: dedupedPositive,
      negativeSamples: dedupedNegative,
      vectorMatches,
      totalCandidates: dedupedPositive.length + dedupedNegative.length,
      queriedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 3: Candidate Plan Generation Implementation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage3CandidateGeneration — Generate candidate plan profiles
   *
   * Attempts LLM structured generation for 3 profiles (aggressive, defensive,
   * fallback). If LLM fails, falls back to pre-compiled defensive template.
   */
  private async stage3CandidateGeneration(
    userInput: string,
    tags: string[],
    intent: IntentAnalysisResult,
    experience: ExperienceQueryResult | null,
    sessionCtx?: SessionContext,
  ): Promise<ICandidatePlansOutput> {
    // ★ v2.6 Upgrade: 已知任务（有历史数据）→ 统计引擎（零 LLM）；新任务 → LLM 生成
    const historicalRecords = this.store.queryByTags(tags, 5);
    const hasData = historicalRecords.length > 0;

    if (this.hierarchicalPlanner && hasData) {
      const hp = this.hierarchicalPlanner;
      try {
        const candidates = hp.candidateGenerator.generateAllCandidates(userInput, tags);
        if (candidates.length > 0) {
          const results = hp.simulator.simulateAll(candidates);
          const evaluation = hp.evaluator.evaluate(results);
          // Convert top candidates to standard CandidatePlanProfile format
          const executionId = `exec_hierarchical_${Date.now()}`;
          const strategies: Array<'aggressive' | 'defensive' | 'fallback'> = ['aggressive', 'defensive', 'fallback'];
          const profileCandidates: CandidatePlanProfile[] = evaluation.candidates.slice(0, 3).map((c, i) => ({
            profileId: `profile_hier_${i}_${executionId}`,
            strategy: strategies[i] ?? 'defensive',
            dag: c.plan.dag,
            rationale: `${c.plan.strategy.name} :: ${c.plan.mutationLabel} (composite=${c.scores.compositeScore.toFixed(3)})`,
            estimatedLatencyMs: c.plan.estimatedLatencyMs,
            riskProfile: {
              nodeCount: c.plan.dag.nodes.length,
              criticalPathLength: c.plan.phases.filter(p => !p.optional).length,
              externalDependencies: 0,
              securityCheckpoints: c.plan.phases.filter(p => p.domain === 'security').length,
              visionAlignmentNodes: 0,
              fridaHooksCount: 0,
            },
            metadata: {
              source: 'hierarchical_planning_engine',
              mutationLabel: c.plan.mutationLabel,
              compositeScore: c.scores.compositeScore,
            },
          }));
          return {
            candidates: profileCandidates as unknown as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
            planRequestId: `hier_${executionId}`,
            generationMetadata: {
              modelUsed: 'HierarchicalPlanningEngine (statistical)',
              tokensUsed: 0,
              generationTimeMs: 250,
            },
            validationPassed: true,
            validationErrors: [],
            fallbackTemplateUsed: false,
          };
        }
      } catch (hErr: unknown) {
        console.warn(`[PipelineExecutor] HierarchicalPlanningEngine failed: ${hErr instanceof Error ? hErr.message : String(hErr)}`);
      }
      // 统计引擎无结果 → 继续走 LLM
    }

    // LLM 生成（新任务 或 统计引擎无结果）
    if (this.modelRegistry?.generate) {
      const prompt = this.buildStage3Prompt(userInput, tags, intent, experience, sessionCtx);
      try {
        const llmResponse = await this.modelRegistry.generate({
          prompt,
          system: STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT,
          temperature: 0.4,
          maxTokens: 4000,
          responseFormat: 'json_object',
        });
        const content = typeof llmResponse === 'string' ? llmResponse : llmResponse?.content ?? llmResponse?.text ?? '';
        // Parse and validate
        const parsed = this.parseAndValidateCandidates(content, userInput, tags, intent, experience);
        if (parsed.validationPassed || parsed.candidates.length > 0) {
          return parsed;
        }
      } catch { /* LLM failed, fall through to fallback */ }
    }

    // Fallback: use pre-compiled defensive template
    return this.generateFallbackCandidates(userInput, tags, `exec_fallback_${Date.now()}`);
  }

  /**
   * buildStage3Prompt — Build the structured prompt for Stage 3 LLM call
   */
  private buildStage3Prompt(
    userInput: string,
    tags: string[],
    intent: IntentAnalysisResult,
    experience: ExperienceQueryResult | null,
    sessionCtx?: SessionContext,
  ): string {
    const positiveExamples = experience?.positiveSamples?.slice(0, 3) ?? [];
    const negativeExamples = experience?.negativeSamples?.slice(0, 3) ?? [];

    let prompt = `## Task Description\n${userInput}\n\n`;
    prompt += `## Tags\n${tags.join(', ')}\n\n`;

    if (intent.targetStateMatrix) {
      prompt += `## Target State\n${JSON.stringify(intent.targetStateMatrix, null, 2)}\n\n`;
    }

    if (positiveExamples.length > 0) {
      prompt += `## Historical Success Patterns\n${JSON.stringify(positiveExamples.map((e: unknown) => ({
        dagNodes: ((e as unknown as Record<string, unknown>).dagNodes as Array<Record<string, unknown>>).map((n: Record<string, unknown>) => ({ role: n.role as string, domain: n.domain as string })),
        durationMs: ((e as unknown as Record<string, unknown>).totalDurationMs ?? 0) as number,
      })), null, 2)}\n\n`;
    }

    if (negativeExamples.length > 0) {
      prompt += `## Historical Failure Patterns\n${JSON.stringify(negativeExamples.map((e: unknown) => ({
        dagNodes: ((e as Record<string, unknown>).dagNodes as Array<Record<string, unknown>>).map((n: Record<string, unknown>) => ({ role: n.role as string, domain: n.domain as string })),
        errorCategory: ((e as unknown as Record<string, unknown>).errorCategory ?? 'unknown') as string,
      })), null, 2)}\n\n`;
    }

    prompt += `## Response Format (JSON only)
{
  "candidates": [
    {
      "strategy": "aggressive | defensive | fallback",
      "rationale": "...",
      "estimatedLatencyMs": 12345,
      "dag": {
        "nodes": [
          {
            "taskId": "node_1",
            "type": "action",
            "domain": "web_dev",
            "description": "...",
            "deps": [],
            "requires": ["resource_name"]
          }
        ],
        "involvedDomains": ["web_dev"],
        "domainDependencies": [],
        "isMultiDomain": false,
        "globalIntent": "...",
        "reasoning": "..."
      },
      "riskProfile": {
        "nodeCount": 1,
        "criticalPathLength": 1,
        "externalDependencies": 0,
        "securityCheckpoints": 0,
        "visionAlignmentNodes": 0,
        "fridaHooksCount": 0
      }
    }
  ],
  "validationPassed": true,
  "validationErrors": []
}
`;
    return prompt;
  }

  /**
   * parseAndValidateCandidates — Parse LLM JSON response into ICandidatePlansOutput
   */
  private parseAndValidateCandidates(
    content: string,
    userInput: string,
    tags: string[],
    intent: IntentAnalysisResult,
    experience: ExperienceQueryResult | null,
  ): ICandidatePlansOutput {
    const errors: string[] = [];

    // Try to find JSON in the response
    let jsonStr = content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try to repair common issues
      const repaired = jsonStr
        .replace(/(['"])?([a-zA-Z_]\w*)(['"])?\s*:/g, '"$2":')
        .replace(/,\s*([}\]])/g, '$1');
      try {
        parsed = JSON.parse(repaired);
      } catch {
        errors.push('Failed to parse LLM response as JSON');
        return {
          candidates: [] as unknown as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
          validationPassed: false,
          validationErrors: errors,
          planRequestId: `gen_${Date.now()}`,
          generationMetadata: {
            modelUsed: this.modelRegistry?.modelName ?? 'unknown',
            tokensUsed: 0,
            generationTimeMs: 0,
          },
          fallbackTemplateUsed: false,
        };
      }
    }

    const candidates: CandidatePlanProfile[] = [];
    const rawCandidates = parsed.candidates ?? parsed.plans ?? [];

    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
      errors.push('No candidate plans found in LLM response');
    }

    for (const raw of rawCandidates) {
      if (!raw.dag || !raw.dag.nodes || raw.dag.nodes.length === 0) {
        errors.push(`Candidate "${raw.strategy ?? 'unknown'}": missing DAG nodes`);
        continue;
      }

      // Basic structural validation
      const nodeIds = new Set<string>();
      let hasDanglingDep = false;

      for (const node of raw.dag.nodes) {
        if (!node.taskId) {
          errors.push(`Candidate "${raw.strategy ?? 'unknown'}": node missing taskId`);
          continue;
        }
        if (nodeIds.has(node.taskId)) {
          errors.push(`Candidate "${raw.strategy ?? 'unknown'}": duplicate taskId "${node.taskId}"`);
          continue;
        }
        nodeIds.add(node.taskId);

        if (node.deps) {
          for (const dep of node.deps) {
            if (!nodeIds.has(dep) && !hasDanglingDep) {
              // Could be a forward reference
            }
          }
        }
      }

      // Validate deps reference existing nodes (after all nodes collected)
      for (const node of raw.dag.nodes) {
        if (node.deps) {
          for (const dep of node.deps) {
            if (!nodeIds.has(dep)) {
              errors.push(`Candidate "${raw.strategy ?? 'unknown'}": dep "${dep}" not found in nodes`);
              hasDanglingDep = true;
            }
          }
        }
      }

      if (hasDanglingDep) continue;

      const profileId = `profile_${raw.strategy ?? 'fallback'}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      candidates.push({
        profileId,
        strategy: raw.strategy ?? 'defensive',
        dag: {
          nodes: raw.dag.nodes.map((n: Record<string, unknown>, idx: number) => ({
            taskId: n.taskId,
            type: n.type ?? 'action',
            domain: n.domain ?? 'general',
            description: n.description ?? '',
            deps: n.deps ?? [],
            requires: n.requires ?? [],
            agentHints: n.agentHints,
            agentConstraint: n.agentConstraint,
          })),
          isMultiDomain: raw.dag.isMultiDomain ?? (raw.dag.involvedDomains?.length > 1),
          involvedDomains: raw.dag.involvedDomains ?? [...new Set(raw.dag.nodes.map((n: Record<string, unknown>) => n.domain ?? 'general'))],
          domainDependencies: raw.dag.domainDependencies ?? [],
          globalIntent: raw.dag.globalIntent ?? userInput.slice(0, 200),
          reasoning: raw.dag.reasoning ?? raw.rationale ?? '',
        },
        rationale: raw.rationale ?? raw.dag.reasoning ?? '',
        estimatedLatencyMs: raw.estimatedLatencyMs ?? 60000,
        riskProfile: {
          nodeCount: raw.riskProfile?.nodeCount ?? raw.dag.nodes.length,
          criticalPathLength: raw.riskProfile?.criticalPathLength ?? 1,
          externalDependencies: raw.riskProfile?.externalDependencies ?? 0,
          securityCheckpoints: raw.riskProfile?.securityCheckpoints ?? 0,
          visionAlignmentNodes: raw.riskProfile?.visionAlignmentNodes ?? 0,
          fridaHooksCount: raw.riskProfile?.fridaHooksCount ?? 0,
        },
        metadata: { modelUsed: this.modelRegistry?.modelName ?? 'unknown' },
      });
    }

    return {
      candidates: candidates as [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile],
      validationPassed: errors.length === 0,
      validationErrors: errors,
      planRequestId: `gen_${Date.now()}`,
      generationMetadata: {
        modelUsed: this.modelRegistry?.modelName ?? 'unknown',
        tokensUsed: 0,
        generationTimeMs: 0,
      },
      fallbackTemplateUsed: false,
    };
  }

  /**
   * generateFallbackCandidates — Generate fallback defensive candidate
   *
   * When LLM generation fails, this builds a safe, universal defensive DAG
   * with analysis-first, gradual complexity approach.
   */
  private async generateFallbackCandidates(
    userInput: string,
    tags: string[],
    executionId: string,
  ): Promise<ICandidatePlansOutput> {
    const baseDomain = tags.find(t => ['ai_ml', 'web_dev', 'mobile', 'data_engineering', 'devops', 'hardware', 'security', 'testing', 'startup'].includes(t)) ?? 'general';

    // Build three candidate profiles using the fallback node factory
    type FallbackNode = { taskId: string; type: string; domain: string; description: string; deps: string[]; requires: string[] };

    const makeNode = (taskId: string, description: string, deps: string[] = [], requires: string[] = []): FallbackNode => ({
      taskId, type: 'action', domain: baseDomain, description, deps, requires,
    });

    const makePlan = (profileId: string, strategy: 'aggressive' | 'defensive' | 'fallback', nodes: FallbackNode[], reasoning: string, latencyMs: number, source: string): CandidatePlanProfile => ({
      profileId, strategy,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dag: { nodes, isMultiDomain: false, involvedDomains: [baseDomain], domainDependencies: [], globalIntent: userInput.slice(0, 200), reasoning } as any,
      rationale: reasoning,
      estimatedLatencyMs: latencyMs,
      riskProfile: { nodeCount: nodes.length, criticalPathLength: nodes.length, externalDependencies: 0, securityCheckpoints: 0, visionAlignmentNodes: 0, fridaHooksCount: 0 },
      metadata: { source },
    });

    const defensiveNodes = [
      makeNode('analyze_input', 'Analyze the user input', [], ['context']),
      makeNode('generate_plan', 'Generate a structured DAG plan', ['analyze_input'], ['context', 'kg']),
      makeNode('implement_core', 'Implement the core functionality', ['generate_plan'], ['toolset']),
      makeNode('verify_output', 'Verify the output', ['implement_core'], ['validation']),
      makeNode('finalize', 'Finalize and return the result', ['verify_output']),
    ];

    const aggressiveNodes = defensiveNodes.slice(0, 3);

    const fallbackNodes = [
      makeNode('execute_direct', 'Execute the request directly with minimal planning'),
    ];

    const candidates: [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile] = [
      makePlan(`profile_defensive_${executionId}`, 'defensive', defensiveNodes, FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION, defensiveNodes.length * 15000, 'fallback_defensive'),
      makePlan(`profile_aggressive_${executionId}`, 'aggressive', aggressiveNodes, 'Aggressive fallback: minimal nodes for faster execution', aggressiveNodes.length * 12000, 'fallback_aggressive'),
      makePlan(`profile_fallback_${executionId}`, 'fallback', fallbackNodes, 'Minimal fallback: single direct execution node', 60000, 'fallback_minimal'),
    ];

    return {
      candidates,
      validationPassed: true,
      validationErrors: [],
      planRequestId: `fallback_${executionId}`,
      generationMetadata: { modelUsed: 'none (fallback)', tokensUsed: 0, generationTimeMs: 0 },
      fallbackTemplateUsed: true,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 4: Plan Simulation (DES) — Private Wrapper
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage4PlanSimulation — Private wrapper for pipeline stage 4
   *
   * Extracts candidates from ICandidatePlansOutput and delegates to
   * the public simulateDES method with topology exploration integration.
   */
  private async stage4PlanSimulation(
    candidates: ICandidatePlansOutput,
    experience: ExperienceQueryResult | null,
  ): Promise<IShadowSimulationReport[]> {
    // ── Zero-Token Topology Exploration ──
    // Before running full DES, explore topological variants of each candidate's DAG
    // to find the best predicted ordering. This is pure computation — no LLM calls,
    // no real execution. Only the best ordering proceeds to DES.
    if (this.topologyExplorer) {
      const volatilityMatrix = this.buildVolatilityMatrix(experience);
      for (const candidate of candidates.candidates) {
        try {
          const report = this.topologyExplorer.exploreAndOptimize(
            candidate.dag,
            volatilityMatrix,
            this.desConfig,
          );
          if (report.wasOptimized) {
            candidate.dag = report.selectedDAG;
            console.log(`[TopologyExplorer] ${candidate.strategy}: ${report.totalVariantsSimulated} variants → improved ${(report.improvement * 100).toFixed(1)}% (${report.bestVariant.ordering})`);
          }
        } catch (err: unknown) {
          console.warn(`[TopologyExplorer] ${candidate.strategy} 探索失败: ${(err as Error).message}`);
        }
      }
    }

    // Delegate to public simulateDES
    return this.simulateDES(candidates.candidates, experience);
  }

  /**
   * buildVolatilityMatrix — Compute failure probabilities per domain/role
   * from negative samples for stochastic DES seeding.
   */
  private buildVolatilityMatrix(experience: ExperienceQueryResult | null): Map<string, number> {
    const matrix = new Map<string, number>();

    // Default base failure rates per domain
    const domainDefaults: Record<string, number> = {
      security: 0.15,
      hardware: 0.20,
      ai_ml: 0.12,
      devops: 0.10,
      data_engineering: 0.08,
      web_dev: 0.05,
      testing: 0.03,
      general: 0.07,
    };

    for (const [domain, rate] of Object.entries(domainDefaults)) {
      matrix.set(domain, rate);
    }

    // Adjust based on negative samples
    if (experience?.negativeSamples) {
      const domainFailureCount = new Map<string, number>();
      const domainTotalCount = new Map<string, number>();

      for (const sample of experience.negativeSamples) {
        for (const node of sample.dagNodes) {
          const d = node.domain ?? 'general';
          domainFailureCount.set(d, (domainFailureCount.get(d) ?? 0) + 1);
        }
      }

      // Also count positives for rate calculation
      for (const sample of experience.positiveSamples) {
        for (const node of sample.dagNodes) {
          const d = node.domain ?? 'general';
          domainTotalCount.set(d, (domainTotalCount.get(d) ?? 0) + 1);
        }
      }

      for (const [domain, failures] of domainFailureCount) {
        const total = (domainTotalCount.get(domain) ?? 0) + failures;
        if (total > 0) {
          const empiricalRate = failures / total;
          // Blend empirical rate with default (weighted 60/40)
          const defaultRate = domainDefaults[domain] ?? 0.07;
          const blended = empiricalRate * 0.6 + defaultRate * 0.4;
          matrix.set(domain, Math.min(0.5, Math.max(0.01, blended)));
        }
      }
    }

    return matrix;
  }

  /**
   * simulateSingleRun — Run DES on one profile within one ShadowContext
   */
  private simulateSingleRun(
    candidate: CandidatePlanProfile,
    volatilityMatrix: Map<string, number>,
    shadowCtx: ShadowContext,
    runSeed: number,
    localDesConfig?: typeof DEFAULT_DES_CONFIG,
  ): IShadowSimulationReport {
    const effectiveConfig = localDesConfig ?? this.desConfig;
    const simulationId = `sim_${candidate.profileId}_run${runSeed}_${Date.now()}`;
    const nodes = candidate.dag.nodes;
    const startedAt = Date.now();

    // Topological order from deps
    const topoOrder = topologicalSort(nodes);
    const nodeResults: DESNodeResult[] = [];
    const simulatedExceptionTraces: SimulatedExceptionTrace[] = [];
    const failedNodes = new Set<string>();
    let totalSimulatedLatencyMs = 0;
    let cascadeFailureCount = 0;

    // Resource contention tracking
    const resourceLocks = new Map<string, { locked: boolean; waitTimeMs: number; contentionCount: number }>();

    for (const nodeId of topoOrder) {
      const node = nodes.find(n => n.taskId === nodeId);
      if (!node) continue;

      const domain = node.domain ?? 'general';
      const baseFailureRate = volatilityMatrix.get(domain) ?? 0.07;

      // Check for cascade from upstream failures
      const deps = node.deps ?? [];
      const upstreamFailures = deps.filter(d => failedNodes.has(d));

      if (upstreamFailures.length > 0) {
        // Cascade failure: this node fails due to upstream
        cascadeFailureCount++;
        nodeResults.push({
          nodeId,
          passed: false,
          simulatedLatencyMs: 0,
          retryCount: 0,
          failureReason: `Cascade from upstream failures: ${upstreamFailures.join(', ')}`,
          cascadeFailures: [],
          resourceContention: [],
        });
        failedNodes.add(nodeId);
        continue;
      }

      // Simulate resource contention
      const resourceContention: ResourceContention[] = [];
      for (const req of (node as any).requires ?? []) {
        const lock = resourceLocks.get(req);
        if (lock?.locked) {
          const waitMs = Math.round(Math.random() * 200 + 50);
          resourceContention.push({ resourceId: req, waitTimeMs: waitMs });
          totalSimulatedLatencyMs += waitMs;
          lock.contentionCount++;
          lock.waitTimeMs += waitMs;
        } else {
          resourceLocks.set(req, { locked: true, waitTimeMs: 0, contentionCount: 1 });
        }
      }

      // Stochastic probability roll
      const sRandom = seededRandom(`${nodeId}_${runSeed}`);
      let passed = sRandom >= baseFailureRate * effectiveConfig.volatilityAmplification;

      // Micro-retry loop
      let retryCount = 0;
      let failureReason: string | undefined;
      const maxRetries = effectiveConfig.maxRetriesPerNode;

      while (!passed && retryCount < maxRetries) {
        retryCount++;
        const retryRandom = seededRandom(`${nodeId}_retry${retryCount}_${runSeed}`);
        passed = retryRandom >= baseFailureRate * effectiveConfig.volatilityAmplification + retryCount * 0.15;
        totalSimulatedLatencyMs += Math.round(200 + Math.random() * 800); // retry delay
      }

      if (!passed) {
        failureReason = `Failed after ${retryCount} retries (domain=${domain}, baseRate=${baseFailureRate.toFixed(3)})`;
        simulatedExceptionTraces.push({
          nodeId,
          exceptionType: 'NodeExecutionFailed',
          message: failureReason,
          timestamp: Date.now() + Math.round(totalSimulatedLatencyMs),
        });
        failedNodes.add(nodeId);
      }

      // Simulated execution latency
      const nodeLatency = Math.round(500 + Math.random() * 4500 * (passed ? 1 : 2));
      totalSimulatedLatencyMs += nodeLatency + resourceContention.reduce((s, c) => s + c.waitTimeMs, 0);

      nodeResults.push({
        nodeId,
        passed,
        simulatedLatencyMs: nodeLatency,
        retryCount,
        failureReason,
        cascadeFailures: [],
        resourceContention,
      });
    }

    // Compute cascade failure propagation
    for (const nr of nodeResults) {
      if (!nr.passed) {
        // Find downstream nodes affected
        findDownstreamNodes(nr.nodeId, nodes, topoOrder, nodeResults);
      }
    }

    const passedNodes = nodeResults.filter(n => n.passed).length;
    const failedNodeCount = nodeResults.filter(n => !n.passed).length;

    // Compute survival probability
    const totalNodes = nodeResults.length;
    const survivalProbability = totalNodes > 0
      ? Math.max(0, Math.min(1,
        (passedNodes / totalNodes) * (1 - cascadeFailureCount / Math.max(totalNodes * 2, 1))
      ))
      : 0;

    // Resource bottlenecks
    const resourceBottlenecks: ResourceBottleneck[] = [];
    for (const [resourceId, info] of resourceLocks) {
      if (info.contentionCount > 1) {
        resourceBottlenecks.push({
          resourceId,
          contentionCount: info.contentionCount,
          avgWaitTimeMs: info.contentionCount > 0 ? info.waitTimeMs / info.contentionCount : 0,
        });
      }
    }

    const overallAssessment: IShadowSimulationReport['overallAssessment'] =
      survivalProbability >= 0.7 ? 'PASS'
        : survivalProbability >= 0.4 ? 'CONDITIONAL_PASS'
        : 'FAIL';

    return {
      simulationId,
      profileId: candidate.profileId,
      strategy: candidate.strategy,
      startedAt,
      completedAt: Date.now(),
      totalSimulatedLatencyMs,
      survivalProbability,
      nodeResults,
      passedNodes,
      failedNodes: failedNodeCount,
      cascadeFailureCount,
      resourceBottlenecks,
      simulatedExceptionTraces,
      overallAssessment,
    };
  }

  /**
   * averageSimulations — Average 3 ShadowContext runs into one report
   */
  private averageSimulations(
    simulations: IShadowSimulationReport[],
    profileId: string,
    strategy: 'aggressive' | 'defensive' | 'fallback',
  ): IShadowSimulationReport {
    if (simulations.length === 0) {
      return {
        simulationId: `sim_avg_${profileId}`,
        profileId, strategy,
        startedAt: Date.now(), completedAt: Date.now(),
        totalSimulatedLatencyMs: 0, survivalProbability: 0,
        nodeResults: [], passedNodes: 0, failedNodes: 0,
        cascadeFailureCount: 0, resourceBottlenecks: [],
        simulatedExceptionTraces: [],
        overallAssessment: 'FAIL',
      };
    }

    const avgSurvival = simulations.reduce((s, r) => s + r.survivalProbability, 0) / simulations.length;
    const avgLatency = Math.round(simulations.reduce((s, r) => s + r.totalSimulatedLatencyMs, 0) / simulations.length);
    const avgPassed = Math.round(simulations.reduce((s, r) => s + r.passedNodes, 0) / simulations.length);
    const avgFailed = Math.round(simulations.reduce((s, r) => s + r.failedNodes, 0) / simulations.length);
    const avgCascade = Math.round(simulations.reduce((s, r) => s + r.cascadeFailureCount, 0) / simulations.length);

    return {
      simulationId: `sim_avg_${profileId}`,
      profileId, strategy,
      startedAt: Math.min(...simulations.map(r => r.startedAt)),
      completedAt: Date.now(),
      totalSimulatedLatencyMs: avgLatency,
      survivalProbability: avgSurvival,
      nodeResults: simulations[0].nodeResults, // use first run's node results as representative
      passedNodes: avgPassed,
      failedNodes: avgFailed,
      cascadeFailureCount: avgCascade,
      resourceBottlenecks: this.mergeBottlenecks(simulations),
      simulatedExceptionTraces: simulations.flatMap(r => r.simulatedExceptionTraces).slice(0, 20),
      overallAssessment: avgSurvival >= 0.7 ? 'PASS' : avgSurvival >= 0.4 ? 'CONDITIONAL_PASS' : 'FAIL',
    };
  }

  /**
   * mergeBottlenecks — Merge resource bottleneck info across runs
   */
  private mergeBottlenecks(simulations: IShadowSimulationReport[]): ResourceBottleneck[] {
    const merged = new Map<string, { contentionCount: number; waitTimeMs: number }>();
    for (const sim of simulations) {
      for (const b of sim.resourceBottlenecks) {
        const existing = merged.get(b.resourceId) ?? { contentionCount: 0, waitTimeMs: 0 };
        existing.contentionCount += b.contentionCount;
        existing.waitTimeMs += b.avgWaitTimeMs * b.contentionCount;
        merged.set(b.resourceId, existing);
      }
    }
    return Array.from(merged.entries()).map(([resourceId, info]) => ({
      resourceId,
      contentionCount: info.contentionCount,
      avgWaitTimeMs: info.contentionCount > 0 ? info.waitTimeMs / info.contentionCount : 0,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 5: Plan Evaluation (MCDA) — Private Wrapper
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage5PlanEvaluation — Private wrapper for pipeline stage 5
   *
   * Extracts inputs from pipeline state and delegates to public evaluateMCDA.
   */
  private async stage5PlanEvaluation(
    simulationReports: IShadowSimulationReport[],
    candidates: ICandidatePlansOutput,
    intent: IntentAnalysisResult,
    experience: ExperienceQueryResult | null,
    sessionId: string,
  ): Promise<IEvaluationScorecard> {
    const deviationCount = this.deviationGuard.getDeviationCount(sessionId);
    return this.evaluateMCDA(
      simulationReports,
      candidates.candidates,
      intent,
      experience,
      deviationCount,
    );
  }

  /**
   * computeAlignmentScore — How well does the candidate plan align with the intent?
   */
  private computeAlignmentScore(candidate: CandidatePlanProfile, intent: IntentAnalysisResult): number {
    const intentDomains = intent.tags.filter(t => t.category === 'domain').map(t => t.tag);
    const planDomains = candidate.dag.involvedDomains ?? [];

    if (intentDomains.length === 0) return 0.5;

    const overlap = intentDomains.filter(d => planDomains.includes(d)).length;
    const domainScore = overlap / intentDomains.length;

    // Bonus for matching complexity level
    const intentComplexity = intent.targetStateMatrix.complexity as string;
    const planComplexity = candidate.dag.nodes.length > 5 ? 'high' : candidate.dag.nodes.length > 3 ? 'medium' : 'low';
    const complexityScore = intentComplexity === planComplexity ? 0.2 : 0;

    return Math.min(1, domainScore * 0.8 + complexityScore);
  }

  /**
   * computeKnowledgeScore — How well does the candidate leverage historical experience?
   */
  private computeKnowledgeScore(candidate: CandidatePlanProfile, experience: ExperienceQueryResult | null): number {
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

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 6: Decision Trace Implementation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage6DecisionTrace — Serialize rationale and write to MemoryBus + JSONL
   */
  private async stage6DecisionTrace(
    scorecard: IEvaluationScorecard,
    simulations: IShadowSimulationReport[],
    candidates: ICandidatePlansOutput,
    sessionId: string,
    executionId: string,
  ): Promise<DecisionTrace> {
    const deviationCount = this.deviationGuard.getDeviationCount(sessionId);
    const riskAppetite: 'efficiency' | 'balanced' | 'stability' =
      deviationCount === 0 ? 'efficiency'
        : deviationCount <= 2 ? 'balanced'
        : 'stability';

    const traceId = `trace_${executionId}_${Date.now()}`;

    // Build elimination records for non-winners
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

    // Build winner selection rationale
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

    // Write to JSONL (decision trace persistence)
    let writtenToDisk = false;
    {
      try {
        this.decisionWriter!.append({
          type: 'decision_trace',
          traceId,
          sessionId,
          executionId,
          evaluatedAt: Date.now(),
          winner: scorecard.winner,
          winnerScore: scorecard.winnerScore,
          riskAppetite,
          deviationCount,
          candidateEliminations,
          winnerSelection,
        });
        writtenToDisk = true;
      } catch { /* non-critical */ }
    }

    // ★ MemoryWiki 持久化 DecisionTrace
    if (this.wiki?.ready) {
      this.wiki.remember({
        id: traceId,
        type: 'DecisionTrace',
        name: `trace_${executionId}`,
        data: {
          execution_id: executionId,
          winner_strategy: scorecard.winner,
          winner_score: scorecard.winnerScore,
          eliminated_candidates: JSON.stringify(candidateEliminations),
          selection_reason: winnerSelection.rationale,
          risk_appetite: riskAppetite,
          timestamp: Date.now(),
        },
      }).catch(() => {});
    }

    return {
      traceId,
      sessionId,
      executionId,
      evaluatedAt: Date.now(),
      candidateEliminations,
      winnerSelection,
      deviationCount,
      riskAppetite,
      writtenToDisk,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stage 7: Best Plan Selection & Activation Implementation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * stage7BestPlanSelection — Final gatekeeper, risk appetite regulator
   */
  private async stage7BestPlanSelection(
    scorecard: IEvaluationScorecard,
    decisionTrace: DecisionTrace,
    candidates: ICandidatePlansOutput,
    simulations: IShadowSimulationReport[],
    sessionId: string,
    executionId: string,
  ): Promise<PlanActivationResult> {
    // Read deviation count for risk appetite regulation
    const deviationCount = this.deviationGuard.getDeviationCount(sessionId);

    // Risk Appetite Regulator as per spec
    if (deviationCount > 0) {
      // Aggressively re-balance weights to stability/security
      // If the winner is aggressive, override to defensive or fallback
      if (scorecard.winner === 'aggressive') {
        // Check if defensive is viable
        const defensiveScore = scorecard.profiles.defensive.composite;
        const fallbackScore = scorecard.profiles.fallback.composite;

        // If defensive or fallback has a reasonable score, override
        if (defensiveScore >= scorecard.winnerScore * 0.7) {
          // Override winner to defensive
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

    // Find the winner candidate
    const winnerCandidate = candidates.candidates.find(c => c.strategy === scorecard.winner);
    if (!winnerCandidate) {
      throw new Error(`Winner profile "${scorecard.winner}" not found in candidates`);
    }

    // Register resource tokens with ArtifactRegistry
    const resourceTokens: string[] = [];
    if (this.artifactRegistry) {
      try {
        for (const domain of winnerCandidate.dag.involvedDomains ?? []) {
          const token = `token_${domain}_${executionId}_${Date.now()}`;
          if (typeof this.artifactRegistry.reserveToken === 'function') {
            await this.artifactRegistry.reserveToken(token);
          }
          resourceTokens.push(token);
        }
      } catch { /* non-critical */ }
    }

    return {
      activatedPlan: winnerCandidate,
      decisionTrace,
      resourceTokens,
      readyForExecution: true,
    };
  }

  /**
   * buildFallbackActivation — Emergency fallback activation
   */
  private buildFallbackActivation(
    candidates: ICandidatePlansOutput | null,
    decisionTrace: DecisionTrace,
    executionId: string,
  ): PlanActivationResult {
    // Pick defensive if available, otherwise first candidate
    let winner = candidates?.candidates.find(c => c.strategy === 'defensive')
      ?? candidates?.candidates[0];

    // If no candidates at all, create a minimal one
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

  /**
   * categorizeTag — Determine the category of a tag
   */
  private categorizeTag(tag: string): SemanticTag['category'] {
    const domainTags = ['ai_ml', 'web_dev', 'mobile', 'data_engineering', 'devops', 'hardware', 'security', 'testing', 'startup'];
    const actionTags = ['build', 'analyze', 'fix', 'optimize', 'design', 'deploy'];
    const complexityTags = ['low_complexity', 'high_complexity'];

    if (domainTags.includes(tag)) return 'domain';
    if (actionTags.includes(tag)) return 'action';
    if (complexityTags.includes(tag)) return 'complexity';
    return 'constraint';
  }
}
