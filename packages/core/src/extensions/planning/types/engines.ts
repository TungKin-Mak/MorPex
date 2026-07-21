import type { DAGPatch, MemoryBusLogEntry } from './simulation.js';
import type { WeightConfiguration } from './pipeline-types.js';
import type {
  IntentAnalysisResult,
  ExperienceQueryResult,
  ICandidatePlansOutput,
  IShadowSimulationReport,
  IEvaluationScorecard,
  DecisionTrace,
  PlanActivationResult,
} from './pipeline-types.js';
import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';

// ═══════════════════════════════════════════════════════════════════════
// Section 20: Pipeline Orchestration Types (管道编排类型)
// ═══════════════════════════════════════════════════════════════════════

/** Stage numbers for the 7-stage pipeline */
export type PipelineStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Stage status values */
export type StageStatus = 'completed' | 'failed' | 'skipped';

/**
 * PipelineStageResult — Output of any single pipeline stage
 *
 * Union-discriminated by stage number for type safety.
 * Each stage produces a specific output type.
 */
export interface PipelineStageResult {
  /** Pipeline stage number 1–7 */
  stage: PipelineStageNumber;
  /** Execution status */
  status: StageStatus;
  /** Wall-clock duration for this stage in ms */
  durationMs: number;
  /** Stage output — discriminated by stage number */
  output:
    | IntentAnalysisResult       // Stage 1
    | ExperienceQueryResult      // Stage 2
    | ICandidatePlansOutput      // Stage 3
    | IShadowSimulationReport[]  // Stage 4 (one per profile)
    | IEvaluationScorecard       // Stage 5
    | DecisionTrace              // Stage 6
    | PlanActivationResult;      // Stage 7
  /** Error message if failed */
  error?: string;
}

/**
 * PipelineTrace — Complete 7-stage execution trace
 *
 * Captures the full lifecycle of a planning pipeline invocation
 * for auditability, debugging, and observability.
 */
export interface PipelineTrace {
  /** Unique pipeline invocation ID */
  pipelineId: string;
  /** Session ID */
  sessionId: string;
  /** Execution ID */
  executionId: string;
  /** Pipeline start timestamp */
  startedAt: number;
  /** Pipeline completion timestamp */
  completedAt: number;
  /** Exactly 7 stage results in order */
  stages: [
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
  ];
  /** Whether the pipeline was aborted */
  aborted: boolean;
  /** Reason for abort (if aborted) */
  abortReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 21: DES Config — 离散事件模拟配置
// ═══════════════════════════════════════════════════════════════════════

/**
 * DESConfig — Configuration for the Discrete Event Simulation engine
 */
export interface DESConfig {
  /** Maximum micro-retries per node (default 3) */
  maxRetriesPerNode: number;
  /** Volatility matrix amplification factor for stochastic checks */
  volatilityAmplification: number;
  /** Time step granularity in ms for virtual clock advancement */
  timeStepMs: number;
  /** Whether to simulate file-system locking heatmaps */
  enableLockHeatmapSimulation: boolean;
  /** Resource contention probability multiplier */
  contentionMultiplier: number;
  /** Number of shadow context runs for stochastic averaging */
  numberOfShadowContexts: number;
  /** Max attempts for corrective action before escalation */
  maxCorrectiveActionAttempts: number;
  /** Max total attempts (initial + corrective) across all stages */
  maxTotalAttempts: number;
  /** Weight decay factor for experience learning rate */
  weightDecayFactor: number;
}

/** Default DES configuration */
export const DEFAULT_DES_CONFIG: DESConfig = {
  maxRetriesPerNode: 3,
  volatilityAmplification: 1.0,
  timeStepMs: 10,
  enableLockHeatmapSimulation: true,
  contentionMultiplier: 1.0,
  numberOfShadowContexts: 3,
  maxCorrectiveActionAttempts: 3,
  maxTotalAttempts: 5,
  weightDecayFactor: 0.95,
};

// ═══════════════════════════════════════════════════════════════════════
// Section 22: MCDA Config — 多准则决策配置
// ═══════════════════════════════════════════════════════════════════════

/**
 * RiskAppetiteProfile — Weight configuration per risk appetite mode
 */
export interface RiskAppetiteProfile {
  /** Weights for efficiency-oriented mode (deviationCount === 0) */
  efficiency: WeightConfiguration;
  /** Balanced default weights */
  balanced: WeightConfiguration;
  /** Weights for stability-oriented mode (deviationCount > 0) */
  stability: WeightConfiguration;
}

/** Default MCDA weight configurations for each risk appetite */
export const DEFAULT_RISK_APPETITE_PROFILE: RiskAppetiteProfile = {
  efficiency: {
    stability: 0.10,
    latency: 0.30,
    security: 0.10,
    alignment: 0.20,
    healing: 0.10,
    knowledge: 0.20,
  },
  balanced: {
    stability: 0.20,
    latency: 0.20,
    security: 0.15,
    alignment: 0.15,
    healing: 0.15,
    knowledge: 0.15,
  },
  stability: {
    stability: 0.30,
    latency: 0.05,
    security: 0.25,
    alignment: 0.15,
    healing: 0.15,
    knowledge: 0.10,
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Section 23: Pipeline Abort Thresholds & Stage Names
// ═══════════════════════════════════════════════════════════════════════

/** Thresholds that trigger pipeline abort */
export const PIPELINE_ABORT_THRESHOLDS = {
  /** Stage 1: minimum confidence to proceed */
  intentConfidenceMin: 0.3,
  /** Stage 3: minimum survival probability to consider a plan viable */
  survivalProbabilityMin: 0.2,
  /** Stage 4: minimum survival probability across all profiles */
  simulationSurvivalMin: 0.15,
  /** Stage 5: minimum winner score to proceed to activation */
  winnerScoreMin: 0.3,
} as const;

/** Human-readable names for pipeline stages */
export const PIPELINE_STAGE_NAMES: Record<PipelineStageNumber, string> = {
  1: 'Intent Analysis',
  2: 'Experience Retrieval',
  3: 'Candidate Plan Generation',
  4: 'Plan Simulation (DES)',
  5: 'Plan Evaluation (MCDA)',
  6: 'Decision Trace',
  7: 'Best Plan Selection & Activation',
};

// ═══════════════════════════════════════════════════════════════════════
// Section 24: Topology Explorer — 拓扑探索与变体比较
// ═══════════════════════════════════════════════════════════════════════

/**
 * VariantSimulationResult — DES result for a single topological permutation
 */
export interface VariantSimulationResult {
  /** Topological ordering description */
  ordering: string;
  /** The DAG with nodes in this ordering */
  dag: ExecutionDAG;
  /** Simulated survival probability 0-1 */
  survivalProbability: number;
  /** Simulated total latency in ms */
  totalSimulatedLatencyMs: number;
  /** Passed node count */
  passedNodes: number;
  /** Failed node count */
  failedNodes: number;
  /** Composite score: survival × 0.6 + (1 − latency/maxLatency) × 0.4 */
  compositeScore: number;
}

/**
 * TopologyExplorationReport — Full report from zero-token topology exploration
 */
export interface TopologyExplorationReport {
  originalDAG: ExecutionDAG;
  totalVariantsGenerated: number;
  totalVariantsSimulated: number;
  variantsSimulated: VariantSimulationResult[];
  bestVariant: VariantSimulationResult;
  originalScore: number;
  bestScore: number;
  improvement: number;
  selectedDAG: ExecutionDAG;
  explorationTimeMs: number;
  wasOptimized: boolean;
}

/**
 * TopologySignature — A hashable representation of a DAG's topological ordering.
 * Two DAGs with identical node roles executed in different orders will have
 * different topologySignatures.
 */
export interface TopologySignature {
  /** Canonical string: "domain:role1→domain:role2→domain:role3" */
  signature: string;
  /** The ordered sequence of (domain, role) pairs */
  nodeSequence: Array<{ domain: string; role: string }>;
}

/**
 * TopologyVariantRecord — Historical success/failure stats for a specific
 * DAG topological ordering.
 */
export interface TopologyVariantRecord {
  /** The topology signature this record tracks */
  signature: TopologySignature;
  /** Number of times this ordering was attempted */
  totalAttempts: number;
  /** Number of successful executions */
  successes: number;
  /** Number of failed executions */
  failures: number;
  /** Success rate 0-1 */
  successRate: number;
  /** Average execution duration in ms */
  avgDurationMs: number;
  /** Average token consumption */
  avgTokensUsed: number;
  /** Last attempted timestamp */
  lastAttemptedAt: number;
  /** Source record IDs for traceability */
  sourceRecordIds: string[];
}

/**
 * TopologyComparisonResult — Result of comparing topological variants
 * to determine the optimal execution order for a given set of node roles.
 */
export interface TopologyComparisonResult {
  /** All known variants for this node set */
  variants: TopologyVariantRecord[];
  /** Best variant by success rate */
  bestVariant: TopologyVariantRecord | null;
  /** Worst variant by success rate */
  worstVariant: TopologyVariantRecord | null;
  /** How many variants were compared */
  totalVariants: number;
  /** The recommended ordering (nodeRoles in recommended order) */
  recommendedOrdering: string[];
  /** Confidence in the recommendation 0-1 */
  confidence: number;
  /** Whether the recommendation is statistically significant */
  isSignificant: boolean;
}

/**
 * DEFAULT_TOPOLOGY_COMPARISON_CONFIG — Default thresholds for topology comparison
 */
export const DEFAULT_TOPOLOGY_COMPARISON_CONFIG = {
  /** Minimum total attempts across all variants to consider comparison significant */
  minTotalAttempts: 5,
  /** Minimum success difference between best and worst to recommend reorder */
  minSuccessGap: 0.3,
  /** Minimum successes the best variant must have */
  minBestSuccesses: 3,
} as const;

// ═══════════════════════════════════════════════════════════════════════
// Section 25: Autonomous Planning Engine — v8 自我改进回路
// ═══════════════════════════════════════════════════════════════════════

/**
 * ExecutionGapAnalysis — Comparison of predicted vs actual execution outcomes.
 *
 * The self-improvement loop compares what Stages 4-5 predicted against
 * what actually happened during execution. Gaps > 20% drive learning actions.
 */
export interface ExecutionGapAnalysis {
  /** Predicted survival probability from DES Stage 4 */
  predictedSurvival: number;
  /** Actual survival from real execution */
  actualSurvival: number;
  /** Predicted total latency from DES Stage 4 */
  predictedLatency: number;
  /** Actual wall-clock duration from execution */
  actualLatency: number;
  /** Predicted MCDA composite score from Stage 5 */
  predictedScore: number;
  /** Actual PlanEvaluator score from post-execution evaluation */
  actualScore: number;
  /** Per-dimension gap breakdown */
  dimGaps: Array<{
    dimension: string;
    predicted: number;
    actual: number;
    delta: number;
  }>;
  /** Dimensions where gap exceeded the significance threshold */
  significantGaps: string[];
  /** When the gap analysis was performed */
  analyzedAt: number;
}

/**
 * LearningAction — A concrete action derived from gap analysis.
 *
 * Each significant gap generates one or more learning actions that
 * adapt the planning system for better future predictions.
 */
export interface LearningAction {
  /** Type of learning action */
  type: 'adjust_weight' | 'update_template_quality' | 'amplify_volatility'
      | 'deprioritize_strategy' | 'prune_template' | 'boost_template';
  /** The target of the action (dimension name, template ID, etc.) */
  target: string;
  /** Value before the adjustment */
  before: number;
  /** Value after the adjustment */
  after: number;
  /** Human-readable reason this action was taken */
  reason: string;
  /** When the action was applied */
  appliedAt: number;
}

/**
 * ImprovementTrajectory — Score progression over multiple executions.
 *
 * Tracks whether the system is actually improving over time.
 * If the trend is 'declining', the system may need intervention.
 */
export interface ImprovementTrajectory {
  /** Total number of executions tracked */
  totalExecutions: number;
  /** Per-execution score timeline (oldest first) */
  avgScoreTimeline: number[];
  /** Number of learning actions taken */
  learningActionsTaken: number;
  /** Number of template evolution cycles completed */
  templatesEvolved: number;
  /** Number of weight auto-tuning cycles completed */
  weightsAutoTuned: number;
  /** Overall trend direction */
  trend: 'improving' | 'stable' | 'declining';
}

/**
 * AutonomousExecutionResult — Full result from the autonomous planning loop.
 *
 * Returned by PlanningIntelligenceEngine.executeAndLearn().
 * Contains both the execution output and the improvement metadata.
 */
export interface AutonomousExecutionResult {
  /** The executed DAG */
  dag: Record<string, unknown>;
  /** The execution output */
  result: Record<string, unknown>;
  /** The full pipeline trace from the planning phase */
  pipelineTrace: Record<string, unknown>;
  /** The persistent execution record */
  executionRecord: Record<string, unknown>;
  /** Gap analysis comparing prediction vs reality */
  gapAnalysis: ExecutionGapAnalysis;
  /** Learning actions derived from gaps */
  learningActions: LearningAction[];
  /** Improvement metrics vs previous execution */
  improvement: {
    scoreVsPrevious: number;
    dimensionDeltas: Record<string, number>;
    templateQualityChange: number;
    weightAdjustments: Record<string, number>;
    learningApplied: boolean;
  };
}

/**
 * TemplateEvolutionReport — Result of a template evolution cycle.
 */
export interface TemplateEvolutionReport {
  /** Templates that were pruned (removed) */
  prunedTemplates: string[];
  /** Templates whose quality was boosted */
  boostedTemplates: Array<{ templateId: string; oldQuality: number; newQuality: number }>;
  /** Template pairs that were merged */
  mergedTemplates: Array<{ target: string; source: string }>;
  /** Total templates before evolution */
  beforeCount: number;
  /** Total templates after evolution */
  afterCount: number;
}

/**
 * PlanningIntelligenceConfig — Configuration for the autonomous planning engine
 */
export interface PlanningIntelligenceConfig {
  /** Gap threshold (0-1) above which a gap is considered significant */
  significanceThreshold: number;
  /** Number of executions between auto-evolve cycles */
  evolveInterval: number;
  /** Number of recent records to use for weight auto-tuning */
  weightTuningWindow: number;
  /** Maximum weight adjustment per cycle (to prevent oscillation) */
  maxWeightAdjustment: number;
  /** Minimum template quality score before it gets pruned */
  templateQualityMin: number;
  /** Whether to enable learning actions */
  enableLearning: boolean;
  /** Whether to run periodic template evolution */
  enableTemplateEvolution: boolean;
  /** Whether to auto-tune MCDA weights */
  enableWeightAutoTuning: boolean;
}

/** Default config for the planning intelligence engine */
export const DEFAULT_PLANNING_INTELLIGENCE_CONFIG: PlanningIntelligenceConfig = {
  significanceThreshold: 0.20,    // 20% gap is significant
  evolveInterval: 10,              // evolve templates every 10 executions
  weightTuningWindow: 20,          // use last 20 records for weight tuning
  maxWeightAdjustment: 0.05,       // adjust weights by max 0.05 per cycle
  templateQualityMin: 0.30,        // prune templates below 0.30 quality
  enableLearning: true,
  enableTemplateEvolution: true,
  enableWeightAutoTuning: true,
};
