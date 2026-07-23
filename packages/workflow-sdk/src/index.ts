/**
 * MorPex v11 — Workflow SDK
 *
 * Adaptive Workflow Operating System SDK.
 * Provides programmatic API for workflow lifecycle management.
 *
 * @packageDocumentation
 */

// ── Types ──
export type {
  WorkflowManifest,
  WorkflowStepDefinition,
  TriggerDefinition,
  WorkflowDefinition,
  WorkflowPackage,
  InstalledWorkflow,
  RetryPolicy,
  Policy,
  WorkflowContext,
  WorkflowExecutionResult,
  ExecutionTrace,
  TraceEntry,
  Artifact,
  QualityScore,
  WorkflowMetrics,
  WorkflowStatus,
  OptimizationProposal,
  OptimizationChange,
  WorkflowVersion,
  ExecutionOptions,
  ActionResult,
  WorkflowEventType,
  WorkflowEvent,
} from './types.js';

// ── Interfaces ──
export type { IWorkflowAdapter } from './IWorkflowAdapter.js';

// ── SDK ──
export { WorkflowSDK } from './WorkflowSDK.js';
export type { CreateOptions } from './WorkflowSDK.js';

// ── Runtime ──
export { WorkflowRuntime } from './WorkflowRuntime.js';

// ── Context ──
export { createWorkflowContext, createExecutionResult, mergeContexts } from './WorkflowContext.js';

// ── Pi Agent 模型注册表 ──
export { PiModelRegistry } from './PiModelRegistry.js';
export type { GenerateParams, GenerateResult } from './PiModelRegistry.js';

// ── Bootstrap (v10 运行时集成) ──
export { createWorkflowRuntime } from './bootstrap.js';
export type { BootstrapResult } from './bootstrap.js';
