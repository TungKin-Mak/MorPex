/**
 * Observability Plane — 统一导出
 *
 * 所有模块产生 TraceEvent → TraceBus → TraceStore → WebSocket → Debug UI
 *
 * 使用方式：
 *   import { traceBus, createObservabilityRouter, setupWebSocket } from './observability/index.js';
 *
 *   const router = createObservabilityRouter();
 *   app.use('/api/observability', router);
 *
 *   setupWebSocket(httpServer);
 */

export { type TraceEvent, type ModuleRegistration, type CoverageSnapshot, type GraphNode, type TaskTimelineEntry, type SystemStats, DEFAULT_MODULES } from './types';
export { traceBus, TraceBus } from './event-bus';
export { TraceStore } from './trace-store';
export { CoverageEngine } from './coverage-engine';
export type { ModuleHealth, ModuleStatus, CoverageReportV2 } from './coverage-engine';
export { GraphBuilder } from './graph-builder';
export { TaskGenerator, taskGenerator } from './task-generator';
export { setupWebSocket } from './ws-handler';
export { createObservabilityRouter } from './observability-api';
export { ExecutionTracer, createExecutionTracer } from './execution-tracer.js';
export type { TracerConfig, TaskSpan } from './execution-tracer.js';
export { instrumentDAGDispatcher } from './dag-tracer.js';
export { instrumentFSM } from './fsm-tracer.js';
export { instrumentAgentScheduler, instrumentCollaborationManager } from './agent-tracer.js';
export { instrumentSandbox, instrumentVerifier } from './tool-tracer.js';
export { ArchitectureAuditor } from './architecture-auditor.js';
export type { AuditFinding, ArchitectureAuditReport } from './architecture-auditor.js';
export { ReplayEngine } from './replay-engine.js';
export type { ReplaySession, ReplayTimeline, ReplayDiff } from './replay-engine.js';
export { ARCHITECTURE_CONTRACT } from './architecture-contract.js';
export type { ModuleContract } from './architecture-contract.js';
export { ObservationCollector, createExecutionContext, forkContext } from './observation.js';
export type { Observation, ObservationType, ObservationSource, ExecutionContext, ModuleState, RuntimeModuleState } from './observation.js';
export { ObservableModule } from './observable-module.js';
export { RuntimeInvoker } from './runtime-invoker.js';
export { adaptTraceEvent, wireObservationAdapter } from './observation-adapter.js';
export { exerciseAllModules, exerciseViaEvents, registerExerciseContext, getExerciseContext, exerciseAllFromGlobal } from './exercise-all.js';
export type { ExerciseContext } from './exercise-all.js';
