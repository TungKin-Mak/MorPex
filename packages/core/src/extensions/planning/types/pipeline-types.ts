import type { PlanExecutionRecord } from './plan-templates.js';
import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';

// ═══════════════════════════════════════════════════════════════
// Section 12: v2 配置 & 偏差守卫类型
// ═══════════════════════════════════════════════════════════════

/**
 * MetaPlannerV2Config — MetaPlanner v2 扩展配置
 */
export interface MetaPlannerV2Config {
  /**
   * 防无限规划死循环守卫：
   * 单次 Session 连续触发重规划的最大次数
   */
  maxDeviationCount: number;

  /**
   * 前瞻模拟拒绝阈值：
   * overallRiskScore 超过此值触发 DAG 打回重构
   */
  simulationRejectionThreshold: number;

  /**
   * 战略拆解是否启用
   */
  enableStrategicDeconstructor: boolean;

  /**
   * 前瞻模拟是否启用
   */
  enableLookAheadSimulator: boolean;

  /**
   * 动态反射引擎是否启用
   */
  enableDynamicReflexEngine: boolean;

  /**
   * JSONL 追踪日志路径
   */
  traceLogPath: string;
}

/**
 * DEFAULT_META_PLANNER_V2_CONFIG — v2 扩展默认配置
 */
export const DEFAULT_META_PLANNER_V2_CONFIG: MetaPlannerV2Config = {
  maxDeviationCount: 3,
  simulationRejectionThreshold: 0.7,
  enableStrategicDeconstructor: true,
  enableLookAheadSimulator: true,
  enableDynamicReflexEngine: true,
  traceLogPath: './data/planning/traces/',
};

/**
 * DeviationRecord — 单次偏差事件的完整记录
 */
export interface DeviationRecord {
  /** Session ID */
  sessionId: string;
  /** 事件唯一 ID */
  eventId: string;
  /** 偏差事件类型 */
  type: string;
  /** 偏差描述 */
  description: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否触发了重规划 */
  triggeredReplan?: boolean;
  /** 关联的修补 ID（如果有） */
  patchId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * DeviationGuardConfig — 偏差守卫配置
 */
export interface DeviationGuardConfig {
  /** 单次 Session 最大允许偏差次数 */
  maxDeviationsPerSession: number;
  /** JSONL 追踪日志路径 */
  traceLogPath: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 13: Pipeline Stage 1 — Intent Analysis (意图分析)
// ═══════════════════════════════════════════════════════════════════════

/**
 * SemanticTag — A parsed intent tag with confidence scoring
 *
 * Each tag carries a score indicating how confidently it was matched,
 * a category for downstream filtering, and its provenance.
 */
export interface SemanticTag {
  /** Tag value (e.g. "ai_ml", "web_dev", "build", "low_complexity") */
  tag: string;
  /** Match confidence 0–1 */
  score: number;
  /** Functional category */
  category: 'domain' | 'action' | 'complexity' | 'constraint';
  /** Where this tag was derived from */
  source: 'regex' | 'kg' | 'llm';
}

/**
 * IntentAnalysisResult — Stage 1 output
 *
 * Intercepts raw user intent, invokes extractTags(), cross-references
 * with KnowledgeGraph to infer the target state matrix (S_target).
 * Aborts if confidenceScore < 0.3.
 */
export interface IntentAnalysisResult {
  /** Unique intent analysis ID */
  intentId: string;
  /** The raw user input string */
  rawInput: string;
  /** Parsed semantic tags (from regex + KG + LLM) */
  tags: SemanticTag[];
  /** Inferred target state matrix (S_target) for knowledge alignment */
  targetStateMatrix: Record<string, unknown>;
  /** Explicit environmental constraints parsed from input */
  explicitConstraints: {
    workspacePath?: string;
    windowHandle?: number;
    pinLockRequired?: boolean;
    [key: string]: unknown;
  };
  /** Implicit constraints inferred from context */
  implicitConstraints: string[];
  /** Overall confidence score 0–1. Abort if < 0.3 */
  confidenceScore: number;
  /** If aborted, the reason */
  abortReason?: string;
  /** Timestamp of analysis completion */
  analyzedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 14: Pipeline Stage 2 — Experience Retrieval (经验检索)
// ═══════════════════════════════════════════════════════════════════════

/**
 * VectorMatch — A single vector store match result
 */
export interface VectorMatch {
  /** Record ID from the experience store */
  recordId: string;
  /** Cosine similarity score 0–1 */
  similarity: number;
  /** Key takeaway from this historical execution */
  keyInsight: string;
}

/**
 * ExperienceQueryResult — Stage 2 output
 *
 * Queries both PlanExperienceStore (structural layout matches) AND
 * VectorStore (cosine similarity on vectorized input). Returns both
 * Positive Samples (successful DAGs) AND Negative Samples (cases that
 * generated STATE_DEVIATION or failed micro-self-healing).
 */
export interface ExperienceQueryResult {
  /** Positive (successful) execution records */
  positiveSamples: PlanExecutionRecord[];
  /** Negative (failed/deviated) execution records */
  negativeSamples: PlanExecutionRecord[];
  /** Vector similarity matches with insights */
  vectorMatches: VectorMatch[];
  /** Total candidate records considered */
  totalCandidates: number;
  /** Query timestamp */
  queriedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 15: Pipeline Stage 3 — Candidate Plan Generation (候选生成)
// ═══════════════════════════════════════════════════════════════════════

/**
 * RiskProfile — Summary risk characteristics of a candidate plan
 */
export interface RiskProfile {
  /** Total node count in the plan DAG */
  nodeCount: number;
  /** Number of nodes on the critical path */
  criticalPathLength: number;
  /** Number of external tool/hook dependencies */
  externalDependencies: number;
  /** Number of environmental safety checkpoints inserted */
  securityCheckpoints: number;
  /** Number of Florence-2 UI vision alignment nodes */
  visionAlignmentNodes: number;
  /** Number of Frida/MinHook dynamic instrumentation hooks */
  fridaHooksCount: number;
}

/**
 * CandidatePlanProfile — One of three strategic profiles
 *
 * Generated by Stage 3 LLM structured output. Exactly three profiles
 * are produced: aggressive, defensive, and fallback.
 */
export interface CandidatePlanProfile {
  /** Unique profile identifier */
  profileId: string;
  /** Strategic orientation */
  strategy: 'aggressive' | 'defensive' | 'fallback';
  /** The proposed DAG topology for this profile */
  dag: ExecutionDAG;
  /** Strategic rationale for this profile */
  rationale: string;
  /** Projected execution latency in ms */
  estimatedLatencyMs: number;
  /** Risk characteristics summary */
  riskProfile: RiskProfile;
  /** Additional metadata extracted during generation */
  metadata: Record<string, unknown>;
}

/**
 * ICandidatePlansOutput — Stage 3 LLM structured output
 *
 * Uses strict JSON Schema / Structured Outputs to force the model
 * to synthesize exactly three distinct strategic profiles leveraging
 * contrastive attention within a single context window.
 */
export interface ICandidatePlansOutput {
  /** Plan request identifier */
  planRequestId: string;
  /** Exactly three candidate profiles (aggressive, defensive, fallback) */
  candidates: [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile];
  /** Generation metadata */
  generationMetadata: {
    /** Model identifier used for generation */
    modelUsed: string;
    /** Token consumption */
    tokensUsed: number;
    /** Wall-clock generation time */
    generationTimeMs: number;
  };
  /** Zod/local validation result */
  validationPassed: boolean;
  /** Validation errors if validation failed */
  validationErrors?: string[];
  /** Whether fallback was triggered due to validation/truncation failure */
  fallbackTemplateUsed?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 16: Pipeline Stage 4 — Plan Simulation / DES (离散事件模拟)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ShadowContext — A pure in-memory clone of MemoryBus state
 *
 * Completely isolated, side-effect-free, used for stochastic DES.
 */
export interface ShadowContext {
  /** Unique context ID */
  contextId: string;
  /** Shadow run identifier (e.g. '1', '2', '3') */
  shadowId: string;
  /** Source session ID */
  sourceSessionId: string;
  /** Clone timestamp */
  clonedAt: number;
  /** Cloned MemoryBus Local Map Cache state */
  stateSnapshot: Map<string, unknown>;
  /** Currently held resource locks in this shadow */
  resourceLocks: Set<string>;
  /** Whether this context has been modified */
  isDirty: boolean;
}

/**
 * ResourceContention — Record of simulated resource contention
 */
export interface ResourceContention {
  /** Resource identifier that was contended */
  resourceId: string;
  /** Simulated wait time in ms */
  waitTimeMs: number;
}

/**
 * DESNodeResult — Single node simulation result from DES
 *
 * Each node is stepped through along a virtual time axis. A stochastic
 * probability check is rolled using the volatility matrix seeded by
 * Stage 2's negative samples and file-system locking heatmaps.
 */
export interface DESNodeResult {
  /** Node ID in the DAG */
  nodeId: string;
  /** Whether this node simulation passed */
  passed: boolean;
  /** Simulated latency in ms */
  simulatedLatencyMs: number;
  /** Number of micro-retries attempted (0–3) */
  retryCount: number;
  /** If failed, the reason after exhausting retries */
  failureReason?: string;
  /** Downstream node IDs that failed due to cascade from this node */
  cascadeFailures: string[];
  /** Resource contention events during this node's execution */
  resourceContention: ResourceContention[];
}

/**
 * SimulatedExceptionTrace — A simulated exception trace entry
 */
export interface SimulatedExceptionTrace {
  /** Node where exception occurred */
  nodeId: string;
  /** Exception type */
  exceptionType: string;
  /** Exception message */
  message: string;
  /** Timestamp of simulated exception */
  timestamp: number;
}

/**
 * ResourceBottleneck — Simulated resource bottleneck summary
 */
export interface ResourceBottleneck {
  /** Resource identifier */
  resourceId: string;
  /** Number of contention events on this resource */
  contentionCount: number;
  /** Average wait time in ms */
  avgWaitTimeMs: number;
}

/**
 * IShadowSimulationReport — Full DES simulation output for one profile
 *
 * Constructed by stepping through each candidate DAG topology along a
 * virtual time axis, rolling stochastic probability checks, simulating
 * Self-Healing Runtime buffers, and propagating cascade failures.
 */
export interface IShadowSimulationReport {
  /** Simulation identifier */
  simulationId: string;
  /** Associated profile ID */
  profileId: string;
  /** Strategic profile being simulated */
  strategy: 'aggressive' | 'defensive' | 'fallback';
  /** Simulation start timestamp */
  startedAt: number;
  /** Simulation completion timestamp */
  completedAt: number;
  /** Total simulated wall-clock latency in ms */
  totalSimulatedLatencyMs: number;
  /** Probability of survival 0–1 */
  survivalProbability: number;
  /** Per-node simulation results */
  nodeResults: DESNodeResult[];
  /** Number of nodes that passed */
  passedNodes: number;
  /** Number of nodes that failed */
  failedNodes: number;
  /** Total cascade failure count */
  cascadeFailureCount: number;
  /** Resource bottlenecks identified during simulation */
  resourceBottlenecks: ResourceBottleneck[];
  /** Simulated exception traces */
  simulatedExceptionTraces: SimulatedExceptionTrace[];
  /** Overall assessment */
  overallAssessment: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL';
}

// ═══════════════════════════════════════════════════════════════════════
// Section 17: Pipeline Stage 5 — Plan Evaluation / MCDA (多准则决策)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ProfileScore — MCDA dimension scores for a single profile
 *
 * Each dimension is scored 0–1 and weighted according to the current
 * risk appetite configuration.
 */
export interface ProfileScore {
  /** Stability score 0–1 */
  stability: number;
  /** Latency efficiency score 0–1 */
  latency: number;
  /** Security score 0–1 */
  security: number;
  /** Intent alignment score 0–1 */
  alignment: number;
  /** Self-healing capability score 0–1 */
  healing: number;
  /** Knowledge leverage score 0–1 */
  knowledge: number;
  /** Weighted composite score 0–1 */
  composite: number;
}

/**
 * WeightConfiguration — MCDA weights that must sum to 1.0
 */
export interface WeightConfiguration {
  /** Weight for stability dimension */
  stability: number;
  /** Weight for latency dimension */
  latency: number;
  /** Weight for security dimension */
  security: number;
  /** Weight for intent alignment dimension */
  alignment: number;
  /** Weight for self-healing dimension */
  healing: number;
  /** Weight for knowledge leverage dimension */
  knowledge: number;
}

/**
 * ScoreBreakdownEntry — Single dimension score breakdown
 */
export interface ScoreBreakdownEntry {
  /** Profile name being scored */
  profile: string;
  /** Dimension being evaluated */
  dimension: string;
  /** Raw (unweighted) score 0–1 */
  rawScore: number;
  /** Weighted score that contributed to composite */
  weightedScore: number;
}

/**
 * IEvaluationScorecard — Multi-Criteria Decision Analysis scorecard
 *
 * Implements a weighted linear combination scoring model:
 *   Score = Σ(w_i · S_i)
 *   where weights normalize to 1.0 and S_i are the dimension scores.
 *
 * Applies risk appetite regulation based on deviationCount.
 */
export interface IEvaluationScorecard {
  /** Evaluation identifier */
  evaluationId: string;
  /** Evaluation timestamp */
  evaluatedAt: number;
  /** Scores for all three profiles */
  profiles: {
    aggressive: ProfileScore;
    defensive: ProfileScore;
    fallback: ProfileScore;
  };
  /** The weight configuration used for this evaluation */
  weightConfiguration: WeightConfiguration;
  /** Winning profile strategy */
  winner: 'aggressive' | 'defensive' | 'fallback';
  /** Winner's composite score */
  winnerScore: number;
  /** Full score breakdown for auditability */
  scoreBreakdown: ScoreBreakdownEntry[];
  /** Optional metadata for topology recommendations and other extras */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 18: Pipeline Stage 6 — Decision Trace (决策追踪)
// ═══════════════════════════════════════════════════════════════════════

/**
 * CandidateElimination — Record of why a candidate was eliminated
 */
export interface CandidateElimination {
  /** Profile that was eliminated */
  profile: string;
  /** Human-readable elimination rationale */
  reason: string;
  /** The composite score that led to elimination */
  score: number;
}

/**
 * WinnerSelection — Record of the winning selection rationale
 */
export interface WinnerSelection {
  /** Winning profile strategy */
  profile: string;
  /** Detailed rationale for why this profile was chosen */
  rationale: string;
  /** The risk-adjusted weights used in the final evaluation */
  riskAdjustedWeights: Record<string, number>;
}

/**
 * DecisionTrace — Stage 6 output
 *
 * Serializes the precise rationale for candidate elimination and
 * winning selection into a structured semantic block.
 *
 * Synchronously written to MemoryBus Local Map Cache AND appended
 * to the persistent JSONL file for lineage auditing.
 */
export interface DecisionTrace {
  /** Trace identifier */
  traceId: string;
  /** Session ID */
  sessionId: string;
  /** Execution ID */
  executionId: string;
  /** Evaluation timestamp */
  evaluatedAt: number;
  /** Elimination records for non-winning candidates */
  candidateEliminations: CandidateElimination[];
  /** The winning selection rationale */
  winnerSelection: WinnerSelection;
  /** Deviation count at decision time */
  deviationCount: number;
  /** Risk appetite mode active during this evaluation */
  riskAppetite: 'efficiency' | 'balanced' | 'stability';
  /** Whether the trace was successfully written to disk */
  writtenToDisk: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 19: Pipeline Stage 7 — Best Plan Selection & Activation (计划激活)
// ═══════════════════════════════════════════════════════════════════════

/**
 * PlanActivationResult — Stage 7 output
 *
 * Final gatekeeper. Registers the winner DAG's required physical
 * resource tokens inside ArtifactRegistry to prevent workspace collisions,
 * then returns the finalized Winner DAG topology.
 */
export interface PlanActivationResult {
  /** The activated (winning) plan profile */
  activatedPlan: CandidatePlanProfile;
  /** The complete decision trace from Stage 6 */
  decisionTrace: DecisionTrace;
  /** ArtifactRegistry resource tokens acquired to prevent collisions */
  resourceTokens: string[];
  /** Whether plan is ready for downstream ExecutionOrchestrator */
  readyForExecution: boolean;
}

