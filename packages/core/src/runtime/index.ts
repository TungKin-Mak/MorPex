// ── Runtime Kernel (Phase 1 / MorPex v8) ──
export { ExecutionFSM, ExecutionState } from './state-machine/ExecutionFSM.js';
export type {
  StateTransitionEvent, ExecutionAuditEntry, ExecutionFSMConfig, ExecutionSnapshot as FSMSnapshot,
} from './state-machine/ExecutionFSM.js';

export { DAGRuntime, TaskNode, TaskGraph, DependencyResolver, Scheduler, ParallelExecutor } from './dag/index.js';
export type { DAGResult, ExecutionTraceEntry, DAGRuntimeConfig } from './dag/DAGRuntime.js';
export type { TaskNodeStatus, TaskExecutionResult } from './dag/TaskNode.js';
export type { SchedulerConfig, SchedulerStatus } from './dag/Scheduler.js';

export { CheckpointManager, RecoveryManager, ReplayEngine } from './checkpoint/index.js';
export type {
  NodeState, ExecutionSnapshot, CheckpointManagerConfig,
  RecoveryAction, RecoveryPlan, ReplayEvent, ReplayEventType,
} from './checkpoint/index.js';

export { RuntimeKernelIntegrator } from './RuntimeKernelIntegrator.js';
export type { RuntimeKernelConfig } from './RuntimeKernelIntegrator.js';

// ── Mission Runtime (Phase 3 / MorPex v8) ──
export { MissionState, MISSION_VALID_TRANSITIONS, MissionRuntime } from './mission/index.js';
export type {
  MissionPlanner, MissionExecutor, MissionRuntimeConfig, MissionStateTransitionEvent,
  Mission, MissionPlan, PlanStep, MissionResult, MissionContext, MissionPermissions,
} from './mission/index.js';

// ── Mission Runtime Adapters ──
export { MetaPlannerAdapter, DAGExecutorAdapter } from './mission/index.js';

// ── Verification Engine (Phase 4) ──
export { VerificationEngine } from './verification/index.js';
export type { VerificationResult, VerificationCheck, VerificationIssue, VerificationEngineConfig } from './verification/index.js';

// ── Approval Engine (Phase 4) ──
export { ApprovalEngine } from './approval/index.js';
export type { ApprovalRequest, ApprovalStatus, ApprovalEngineConfig, ApprovalEventPayload, ApprovalStats } from './approval/index.js';

// ── Cognitive Runtime Loop (Phase 6) ──
export { CognitiveLoop, CognitivePipeline } from './cognitive-loop/index.js';
export type {
  CognitiveStage, CognitiveContext, CognitivePhase, DetectedIntent, LoopStats,
  WorkflowCandidateEntry, BehaviorDriftEntry, TwinCandidate, EvidenceAggregation,
} from './cognitive-loop/index.js';

// ── Pipeline Stages ──
export {
  ContextStage, IntentStage, GoalStage, TwinStage, PlanningStage,
  ExecutionStage, LearningStage, EvolutionStage, PersistenceStage,
} from './cognitive-loop/index.js';

// ── Sandbox / Budget / Compensation ──
export { SandboxManager } from './sandbox/index.js';
export type { SandboxContext, SandboxExecutionResult } from './sandbox/index.js';
export { BudgetManager } from './budget/index.js';
export type { BudgetConfig, BudgetStatus } from './budget/index.js';
export { CompensationEngine } from './compensation/index.js';

// ── Resilience (re-export from common)
export { RetryPolicy, CircuitBreaker, CircuitOpenError, ErrorHandlerService } from '../common/resilience/index.js';
export type { RetryPolicyConfig, BackoffStrategy, CircuitState, CircuitBreakerConfig, ExecutionContext as ErrorHandlerContext, ErrorRecord } from '../common/resilience/index.js';

// ═══════════════════════════════════════════════════════════
// v15 Integration: Runtime Wiring Layer
// ═══════════════════════════════════════════════════════════
export { MorPexRuntime } from './MorPexRuntime.js';
export type { RunResult } from './MorPexRuntime.js';
export { PipelineOrchestrator } from './PipelineOrchestrator.js';
export { ServiceContainer } from './ServiceContainer.js';
export type { ExecutionContext } from './ExecutionContext.js';
export type { WorkflowContext } from './ExecutionContext.js';
