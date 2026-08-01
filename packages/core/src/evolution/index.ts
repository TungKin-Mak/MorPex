/**
 * evolution — MorPex Evolution Layer Barrel
 *
 * Phase 5 / MorPex v8.5: 系统长期成长引擎。
 * v11: +ExperienceMiner, +FailureAnalyzer, +PatternExtractor
 *
 * v16 Phase 4.7 新增:
 *   ActiveEvolutionTrigger — 主动进化触发器
 *   PatternMigrationEngine — 跨部门模式迁移引擎
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
export { PatternExtractor } from './PatternExtractor.js';
export { FailureAnalyzer } from './FailureAnalyzer.js';
export type { FailureMode, FailureCategory, WorkflowFailureAnalysis, FailureAnalysisConfig } from './FailureAnalyzer.js';


// ── v16+ 主动进化 ──
export { ActiveEvolutionTrigger } from './ActiveEvolutionTrigger.js';
export type {
  ActiveTriggerEvent,
  TriggerReason,
  TriggerConfig,
  DeptFailureTracker,
  TriggerStats,
} from './ActiveEvolutionTrigger.js';

export { PatternMigrationEngine } from './PatternMigrationEngine.js';
export type {
  PatternMigrationRecord,
  MigrationStatus,
  MigrationTemplate,
  MigrationStats,
  WorkflowRegistryLike,
} from './PatternMigrationEngine.js';

// ── vNext+: 知识缺失监听器（QueryMiss → Feedback → Evolution）──
export { KnowledgeGapListener } from './KnowledgeGapListener.js';
export type {
  KnowledgeGapRecord,
  KnowledgeGapStats,
  EventBusLike,
  FeedbackServiceLike,
} from './KnowledgeGapListener.js';

// ── vNext+ L8: 演化安全沙箱（Verifiable Evolution）──
export { EvolutionSandbox } from './EvolutionSandbox.js';
export type { EvolutionChangeRecord, EvolutionChangeInput, EvolutionSandboxOptions } from './EvolutionSandbox.js';
