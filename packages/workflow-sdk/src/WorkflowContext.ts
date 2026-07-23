/**
 * WorkflowContext — v11 Workflow Context Helpers
 *
 * Factory functions for creating WorkflowContext and WorkflowExecutionResult
 * objects used throughout the Adaptive Workflow Runtime.
 *
 * @packageDocumentation
 */

import type { WorkflowContext, WorkflowExecutionResult, QualityScore } from './types.js';

/**
 * createWorkflowContext — Create a new workflow execution context
 *
 * @param workflowId - Workflow identifier
 * @param input - Workflow input data
 * @param options - Optional context overrides
 * @returns A new WorkflowContext
 */
export function createWorkflowContext(
  workflowId: string,
  input: unknown,
  options?: {
    runId?: string;
    version?: string;
    memory?: Record<string, unknown>;
    artifacts?: unknown[];
    metadata?: Record<string, unknown>;
  }
): WorkflowContext {
  return {
    workflowId,
    runId: options?.runId ?? `run_${Date.now()}`,
    version: options?.version ?? '1.0.0',
    input,
    state: 'initialized',
    memory: options?.memory ?? {},
    artifacts: options?.artifacts ?? [],
    metrics: {},
    startedAt: Date.now(),
    metadata: options?.metadata,
  };
}

/**
 * createExecutionResult — Create a standard execution result
 *
 * @param context - Workflow context
 * @param status - Execution status
 * @param output - Execution output
 * @param error - Optional error message
 * @returns A new WorkflowExecutionResult
 */
export function createExecutionResult(
  context: WorkflowContext,
  status: WorkflowExecutionResult['status'],
  output: unknown,
  error?: string
): WorkflowExecutionResult {
  const now = Date.now();
  const duration = now - context.startedAt;
  const completedSteps = status === 'success' ? 1 : 0;

  return {
    workflowId: context.workflowId,
    runId: context.runId,
    status,
    output,
    metrics: {
      duration,
      totalSteps: 1,
      completedSteps,
      failedSteps: status === 'failed' ? 1 : 0,
      totalTokens: 0,
      totalCost: 0,
      retries: 0,
    },
    artifacts: [],
    trace: {
      entries: [],
      startTime: context.startedAt,
      endTime: now,
      totalDuration: duration,
    },
    qualityScore: calculateQualityScore(status, duration),
    error,
  };
}

/**
 * calculateQualityScore — Calculate a basic quality score
 */
function calculateQualityScore(
  status: WorkflowExecutionResult['status'],
  durationMs: number
): QualityScore {
  const correctness = status === 'success' ? 100 : status === 'partial' ? 50 : 0;
  const reliability = status === 'success' ? 100 : status === 'partial' ? 60 : 0;
  const cost = 100; // Placeholder
  const speed = durationMs > 0 ? Math.min(100, Math.round(300_000 / durationMs * 100)) : 100;

  const overall = Math.round(
    correctness * 0.35 + reliability * 0.30 + cost * 0.15 + speed * 0.20
  );

  return { correctness, reliability, cost, speed: Math.min(100, speed), overall };
}

/**
 * mergeContexts — Merge two execution contexts
 */
export function mergeContexts(
  base: WorkflowContext,
  override: Partial<WorkflowContext>
): WorkflowContext {
  return {
    ...base,
    ...override,
    memory: { ...base.memory, ...(override.memory ?? {}) },
    artifacts: [...base.artifacts, ...(override.artifacts ?? [])],
    metrics: { ...base.metrics, ...(override.metrics ?? {}) },
  };
}
