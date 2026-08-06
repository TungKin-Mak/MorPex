/**
 * evolution — MorPex Evolution Layer Barrel
 *
 * Phase 5 / MorPex v8.5: 系统长期成长引擎。
 * v11: +ExperienceMiner, +FailureAnalyzer, +PatternExtractor
 *
 * v16 Phase 4.7 新增:
 *   ActiveEvolutionTrigger — 主动进化触发器（事件驱动权威入口）
 *
 * 子模块:
 *   evolution/workflow/   — Workflow Evolution Engine (Phase 5)
 *   evolution/behavior/   — Behavior Evolution Engine (预留)
 *   evolution/decision/   — Decision Evolution Engine (预留)
 *   evolution/capability/ — Capability Evolution Engine (预留)
 */

// ── Workflow Evolution (Phase 5) ──
export { WorkflowRegistry, WorkflowSimulator, WorkflowOptimizer, WorkflowExecutor } from './workflow/index.js';
export { ContractValidator } from './workflow/index.js';
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
} from './workflow/index.js';

// ── v11 Evolution Engine ──

export { ExperienceMiner } from './ExperienceMiner.js';
export { PatternExtractor } from './PatternExtractor.js';
export { LearningEventDetector } from './LearningEventDetector.js';
export type { LearningEvent, LearningEventType, StepStats } from './LearningEventDetector.js';
export { ExperienceInjectionService } from './ExperienceInjectionService.js';
export type { ExperienceSource } from './ExperienceInjectionService.js';
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

// ── Wave 3a 迁入（自 cognition/，L4 纯度剥离）：提案生命周期 ──
// Wave 5：SIL 已收紧为只产提案（不自动审批/晋升，未审批只能是 pending）。
export { SelfImprovementLoop } from './SelfImprovementLoop.js';
export { ImprovementAnalyzer } from './ImprovementAnalyzer.js';
export { EvolutionProposal } from './EvolutionProposal.js';
export type { ImprovementInsight } from './ImprovementAnalyzer.js';
export type { Proposal } from './EvolutionProposal.js';
