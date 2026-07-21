export { ExecutionFSM, ExecutionState } from './state-machine/ExecutionFSM.js';
export type { StateTransitionEvent, ExecutionAuditEntry, ExecutionFSMConfig, ExecutionSnapshot as FSMSnapshot } from './state-machine/ExecutionFSM.js';

export { DAGRuntime, TaskNode, TaskGraph, DependencyResolver, Scheduler, ParallelExecutor } from './dag/index.js';
export type { DAGResult, ExecutionTraceEntry, DAGRuntimeConfig } from './dag/DAGRuntime.js';
export type { TaskNodeStatus, TaskExecutionResult } from './dag/TaskNode.js';
export type { SchedulerConfig, SchedulerStatus } from './dag/Scheduler.js';

export { CheckpointManager, RecoveryManager, ReplayEngine } from './checkpoint/index.js';
export type { NodeState, ExecutionSnapshot, CheckpointManagerConfig } from './checkpoint/CheckpointManager.js';
export type { RecoveryAction, RecoveryPlan } from './checkpoint/RecoveryManager.js';
export type { ReplayEvent, ReplayEventType } from './checkpoint/ReplayEngine.js';

export { RuntimeKernelIntegrator } from './RuntimeKernelIntegrator.js';
export type { RuntimeKernelConfig } from './RuntimeKernelIntegrator.js';

// ── Mission Runtime (Phase 3 / MorPex v8) ──
export { MissionState, MISSION_VALID_TRANSITIONS, MissionRuntime } from './mission/index.js';
export type { MissionPlanner, MissionExecutor, MissionRuntimeConfig, MissionStateTransitionEvent } from './mission/index.js';
export type { Mission, MissionPlan, PlanStep, MissionResult, MissionContext, MissionPermissions } from './mission/index.js';

// ── Mission Runtime Adapters (P0 架构完善) ──
export { MetaPlannerAdapter, DAGExecutorAdapter } from './mission/index.js';

// ── Verification Engine (Phase 4 / MorPex v8) ──
export { VerificationEngine } from './verification/index.js';
export type { VerificationResult, VerificationCheck, VerificationIssue, VerificationEngineConfig } from './verification/index.js';

// ── Approval Engine (Phase 4 / MorPex v8) ──
export { ApprovalEngine } from './approval/index.js';
export type { ApprovalRequest, ApprovalStatus, ApprovalEngineConfig, ApprovalEventPayload, ApprovalStats } from './approval/index.js';

// ── Cognitive Runtime Loop (Phase 6 / MorPex v8.5, v8.6 Pipeline) ──
export { CognitiveLoop, CognitivePipeline } from './cognitive-loop/index.js';
export type { CognitiveStage } from './cognitive-loop/index.js';
export type { CognitiveContext, CognitivePhase, DetectedIntent, LoopStats, WorkflowCandidateEntry, BehaviorDriftEntry, TwinCandidate, EvidenceAggregation } from './cognitive-loop/index.js';

// ── v8.6 Pipeline Stages (v9.1: +ContextStage) ──
export {
  ContextStage,
  IntentStage,
  GoalStage,
  TwinStage,
  PlanningStage,
  ExecutionStage,
  LearningStage,
  EvolutionStage,
  PersistenceStage,
} from './cognitive-loop/index.js';

// ── v8.8 Sandbox ──
export { SandboxManager } from './sandbox/index.js';
export type { SandboxContext, SandboxExecutionResult } from './sandbox/index.js';

// ── v8.8 Budget ──
export { BudgetManager } from './budget/index.js';
export type { BudgetConfig, BudgetStatus } from './budget/index.js';

// ── v8.8 Compensation ──
export { CompensationEngine } from './compensation/index.js';
export type { CompensationStep, SagaDefinition, CompensationResult } from './compensation/index.js';
