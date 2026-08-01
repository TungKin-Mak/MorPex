/**
 * planning/index.ts — Planning Intelligence Layer 统一入口（v2）
 *
 * Control Plane 的"大脑皮层"：
 *   - MetaPlanner:             战略规划编排器（v2 升级：插件化 + 三大认知引擎）
 *   - PlanExperienceStore:     计划经验持久化（JSONL）
 *   - PlanAnalyzer:            计划评估+优化引擎（合并自 PlanEvaluator + PlanOptimizer）
 *
 * v2 新增：
 *   - IPlanningExtension:      扩展生命周期接口
 *   - StrategicDeconstructor:  层次化战略拆解器（Engine 1）
 *   - LookAheadSimulator:      前瞻模拟与演练引擎（Engine 2）
 *   - DynamicReflexEngine:     动态反射与重规划引擎（Engine 3）
 *   - V1CapabilityAdapter:     v1 六项能力适配器
 *   - RuntimeController:       运行时影子控制句柄
 *   - DeviationGuard:          防无限规划死循环守卫
 *
 * 用法（v2 升级版）:
 *   import { MetaPlanner } from './planning/index.js';
 *
 *   const metaPlanner = new MetaPlanner(config, v2Config, {
 *     knowledgeGraph,
 *     artifactRegistry,
 *     vectorStore,
 *     memoryBus,
 *     dagEngine,
 *   });
 *   await metaPlanner.store.initialize();
 *
 *   const smartOrchestrate = metaPlanner.wrapOrchestrate(
 *     orchestrator.orchestrate.bind(orchestrator),
 *   );
 *   const { dag, result } = await smartOrchestrate(userInput, sessionCtx);
 */

// ── 主系统 ──

export { MetaPlanner } from './MetaPlanner.js';
export { PlanExperienceStore } from './PlanExperienceStore.js';
export { PlanAnalyzer } from './PlanAnalyzer.js';

// ── PipelineExecutor ──

export { PipelineExecutor } from './pipeline/PipelineExecutor.js';
export type { PipelineExecutorConfig, PipelineDeps, PipelineInput } from './pipeline/PipelineExecutor.js';

// ── v2 扩展接口 ──

export type {
  IPlanningExtension,
  PrePlanContext,
  PrePlanResult,
  PostPlanContext,
  PostPlanResult,
  RuntimeEventContext,
  RuntimeEventResult,
  IRuntimeController,
} from './types.js';

// ── v2 控制器与守卫 ──

export { RuntimeController } from './RuntimeController.js';
export { DeviationGuard } from './guards/DeviationGuard.js';

// ── v2 扩展引擎 ──

export { V1CapabilityAdapter } from './engines/V1CapabilityAdapter.js';
export { StrategicDeconstructor } from './engines/StrategicDeconstructor.js';
export { LookAheadSimulator } from './engines/LookAheadSimulator.js';
export { DynamicReflexEngine } from './engines/DynamicReflexEngine.js';
export { TopologyExplorer } from './engines/TopologyExplorer.js';
export { HierarchicalCandidateGenerator, StatisticalPlanSimulator, WeightedPlanEvaluator } from './engines/HierarchicalPlanningEngine.js';

// ── v2.6 升级模块 ──

export { SessionErrorExtractor } from './SessionErrorExtractor.js';
export type { SessionErrorReport, RawError, EnrichedError, ErrorCausalityChain, RootCause } from './SessionErrorExtractor.js';

// ── 所有类型 ──

export type {
  // v1 核心类型
  PlanTemplate,
  PlanNodeSkeleton,
  PlanExecutionRecord,
  DAGNodeRecord,
  FailureDetail,
  FailureCategory,
  PlanEvaluation,
  PlanDimensionScores,
  PlanTrend,
  PlanSuggestion,
  PlanMatchResult,
  PlanAdjustment,
  MetaPlannerConfig,

  // v2 扩展类型
  Milestone,
  SimulationReport,
  RiskNode,
  DeadlockWarning,
  SimulationRecommendation,
  DAGPatch,
  DAGPatchOperation,
  MemoryBusLogEntry,
  MemoryBusEvent,
  MetaPlannerV2Config,
  DeviationGuardConfig,
  DeviationRecord,
} from './types.js';

// ── 常量 ──

export { DEFAULT_META_PLANNER_CONFIG } from './types.js';
export type { FailurePatternReport, PlanStoreStats } from './PlanExperienceStore.js';

// ── v2.5 7-Stage Pipeline ──

export { PipelineLogger, oneLinePipelineStatus } from './PipelineLogger.js';
export type {
  // 7-Stage Pipeline Types
  IntentAnalysisResult,
  SemanticTag,
  ExperienceQueryResult,
  VectorMatch,
  ICandidatePlansOutput,
  CandidatePlanProfile,
  IShadowSimulationReport,
  DESNodeResult,
  ShadowContext,
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
  PipelineStageNumber,
  StageStatus,
  DESConfig,
  RiskAppetiteProfile,
  TopologySignature,
  TopologyVariantRecord,
  TopologyComparisonResult,
  TopologyExplorationReport,
  VariantSimulationResult,
} from './types.js';
export {
  PIPELINE_STAGE_NAMES,
  DEFAULT_DES_CONFIG,
  DEFAULT_RISK_APPETITE_PROFILE,
  PIPELINE_ABORT_THRESHOLDS,
  DEFAULT_TOPOLOGY_COMPARISON_CONFIG,
} from './types.js';

// ── v2.5 Prompt Configuration ──

export {
  STAGE1_INTENT_ANALYSIS_SYSTEM_PROMPT,
  STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT,
  FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION,
} from './prompts.config.js';

// ── v2.5 Fault Injection (Red-Team Testing) ──

export { FaultInjector, createFaultInjectionTest } from './__tests__/FaultInjector.js';
export type { ReflexLoopVerification } from './__tests__/FaultInjector.js';

// ── v8 Autonomous Planning Engine ──

export { PlanningIntelligenceEngine } from './PlanningIntelligenceEngine.js';
export type {
  ExecutionGapAnalysis,
  LearningAction,
  ImprovementTrajectory,
  AutonomousExecutionResult,
  TemplateEvolutionReport,
  PlanningIntelligenceConfig,
} from './types.js';
export {
  DEFAULT_PLANNING_INTELLIGENCE_CONFIG,
} from './types.js';

// ── v3.0 OpenSpace Fusion: ToolQualityManager ──

export { ToolQualityManager } from './ToolQualityManager.js';
export type {
  ToolQualityRecord,
  DegradationAlert,
  ToolQualityConfig,
} from './ToolQualityManager.js';
export { DEFAULT_TOOL_QUALITY_CONFIG } from './ToolQualityManager.js';

// ── v3.0 OpenSpace Fusion: TemplateManager (统一演化+文件系统) ──

export {
  TemplateManager,
  EvolutionType,
  DEFAULT_EVOLUTION_CONFIG,
} from './TemplateManager.js';
export type {
  TemplateLineage,
  TemplateChange,
  EvolutionConfig,
  TemplateStats,
  TemplateFrontmatter,
  TemplateMeta,
} from './TemplateManager.js';
