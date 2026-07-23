/**
 * evolution — MorPex Evolution Layer Barrel
 *
 * Phase 5 / MorPex v8.5: 系统长期成长引擎。
 * v11: +ExperienceMiner, +FailureAnalyzer, +PatternExtractor
 *
 * 子模块:
 *   evolution/workflow/   — Workflow Evolution Engine (Phase 5)
 *   evolution/behavior/   — Behavior Evolution Engine (预留)
 *   evolution/decision/   — Decision Evolution Engine (预留)
 *   evolution/capability/ — Capability Evolution Engine (预留)
 */

// ── Workflow Evolution (Phase 5) ──
export { WorkflowMiner, WorkflowRegistry, WorkflowOptimizer, WorkflowExecutor, WorkflowSimulator } from './workflow/index.js';
export { ContractValidator, WorkflowTestRunner, ArtifactLineage } from './workflow/index.js';
export type {
  WorkflowStatus,
  WorkflowVersion,
  WorkflowStepDef,
  VersionPerformance,
  RegisteredWorkflow,
  WorkflowCandidate,
  EvolutionReport,
  ExecutionResult,
  OptimizationPlan,
  SimulationResult,
  SimulationMetrics,
  SimulatorConfig,
  WorkflowSimulationContext,
  WorkflowFailureMode,
  // v8.8
  WorkflowContract,
  ContractValidationResult,
  WorkflowTestCase,
  WorkflowTestResult,
  WorkflowTestSuiteResult,
  ArtifactNode,
  ArtifactEdge,
  LineageQuery,
  LineagePath,
} from './workflow/index.js';

// ── v11 Evolution Engine ──
export { ExperienceMiner } from './ExperienceMiner.js';
export type { MinedExperience, MiningConfig } from './ExperienceMiner.js';

export { FailureAnalyzer } from './FailureAnalyzer.js';
export type { FailureMode, FailureCategory, WorkflowFailureAnalysis, FailureAnalysisConfig } from './FailureAnalyzer.js';

export { PatternExtractor, PATTERN_TEMPLATES } from './PatternExtractor.js';
export type { ExtractedPattern, PatternCategory, PatternExtractorConfig } from './PatternExtractor.js';
