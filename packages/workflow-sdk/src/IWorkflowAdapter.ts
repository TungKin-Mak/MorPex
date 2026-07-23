/**
 * IWorkflowAdapter — Workflow Adapter Interface (v11)
 *
 * Standard contract for all workflow package adapters.
 * Enables hot-pluggable workflows with lifecycle management.
 *
 * @packageDocumentation
 */

import type { WorkflowContext, WorkflowExecutionResult, OptimizationProposal } from './types.js';

/**
 * IWorkflowAdapter — Workflow lifecycle adapter
 *
 * Every workflow package must implement this interface to be
 * compatible with the MorPex v11 Workflow Runtime.
 */
export interface IWorkflowAdapter {
  /** Unique workflow identifier */
  readonly id: string;

  /** Human-readable workflow name */
  readonly name: string;

  /** Semantic version */
  readonly version: string;

  /**
   * initialize — Initialize the workflow adapter
   * Called once when the workflow is installed/loaded.
   */
  initialize(): Promise<void>;

  /**
   * validate — Validate that the workflow can execute in the given context
   * @param context - Execution context
   * @returns true if the workflow can proceed
   */
  validate(context: WorkflowContext): Promise<boolean>;

  /**
   * execute — Execute the workflow with the given context
   * @param context - Execution context with input, state, memory
   * @returns Execution result with output, metrics, and trace
   */
  execute(context: WorkflowContext): Promise<WorkflowExecutionResult>;

  /**
   * evaluateQuality — Evaluate the quality of a workflow execution result
   * @param result - The execution result to evaluate
   * @returns Quality score (0-100, higher is better)
   */
  evaluateQuality(result: WorkflowExecutionResult): Promise<number>;

  /**
   * optimize — Analyze execution history and propose optimizations
   * @param history - List of historical execution results
   * @returns Optimization proposals
   */
  optimize(history: WorkflowExecutionResult[]): Promise<OptimizationProposal[]>;
}
