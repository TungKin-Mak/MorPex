/**
 * MorPex v11 — Workflow SDK Types
 *
 * Core type definitions for the Adaptive Workflow Operating System.
 * Extends and wraps existing v10 evolution/workflow types.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════
// Workflow Package Types
// ═══════════════════════════════════════════════════════════════════

/** Workflow manifest metadata (from manifest.json) */
export interface WorkflowManifest {
  name: string;
  version: string;
  description?: string;
  category: string;
  author?: string;
  license?: string;
  requiredCapabilities: string[];
  metrics?: string[];
  dependencies?: Record<string, string>;
  tags?: string[];
}

/** Workflow step definition (v11 enhanced) */
export interface WorkflowStepDefinition {
  id: string;
  name: string;
  capability: string | string[];
  input?: Record<string, unknown>;
  dependsOn?: string[];
  evaluator?: string;
  retryPolicy?: RetryPolicy;
  humanApproval?: boolean;
  timeout?: number;
  config?: Record<string, unknown>;
}

/** Workflow trigger definition */
export interface TriggerDefinition {
  type: 'manual' | 'schedule' | 'event' | 'webhook';
  config?: Record<string, unknown>;
}

/** Workflow definition (v11 declarative format) */
export interface WorkflowDefinition {
  name: string;
  version: string;
  description?: string;
  category: string;
  trigger: TriggerDefinition;
  steps: WorkflowStepDefinition[];
  capabilities: string[];
  policies?: Policy[];
  metrics?: string[];
}

/** Complete workflow package (installed) */
export interface WorkflowPackage {
  manifest: WorkflowManifest;
  definition: WorkflowDefinition;
  path: string;
  version: string;
}

/** Installed workflow record */
export interface InstalledWorkflow {
  id: string;
  package: WorkflowPackage;
  status: 'enabled' | 'disabled' | 'error';
  installedAt: number;
  lastExecutedAt?: number;
  version: string;
}

/** Retry policy for workflow steps */
export interface RetryPolicy {
  maxRetries: number;
  backoff: 'fixed' | 'exponential' | 'linear';
  baseDelayMs: number;
  maxDelayMs?: number;
}

/** Policy rule */
export interface Policy {
  id: string;
  type: 'approval' | 'constraint' | 'guardrail';
  condition: string;
  action: string;
}

// ═══════════════════════════════════════════════════════════════════
// Runtime Types
// ═══════════════════════════════════════════════════════════════════

/** Workflow execution context */
export interface WorkflowContext {
  workflowId: string;
  runId: string;
  version: string;
  input: unknown;
  state: string;
  memory: Record<string, unknown>;
  artifacts: unknown[];
  metrics: Record<string, number>;
  startedAt: number;
  metadata?: Record<string, unknown>;
}

/** Workflow execution result */
export interface WorkflowExecutionResult {
  workflowId: string;
  runId: string;
  status: 'success' | 'failed' | 'partial' | 'cancelled';
  output: unknown;
  metrics: WorkflowMetrics;
  artifacts: Artifact[];
  trace: ExecutionTrace;
  qualityScore: QualityScore;
  error?: string;
}

/** Execution trace entry */
export interface ExecutionTrace {
  entries: TraceEntry[];
  startTime: number;
  endTime: number;
  totalDuration: number;
}

/** Single trace entry */
export interface TraceEntry {
  stepId: string;
  stepName: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  startTime: number;
  endTime?: number;
  duration?: number;
  output?: unknown;
  error?: string;
}

/** Artifact produced during execution */
export interface Artifact {
  id: string;
  name: string;
  type: string;
  path?: string;
  content?: unknown;
  mimeType?: string;
  size?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Quality & Metrics
// ═══════════════════════════════════════════════════════════════════

/** Workflow quality score */
export interface QualityScore {
  correctness: number;   // 0–100
  reliability: number;   // 0–100
  cost: number;          // 0–100 (lower cost = higher score)
  speed: number;         // 0–100 (faster = higher score)
  overall: number;       // weighted composite
}

/** Workflow execution metrics */
export interface WorkflowMetrics {
  duration: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  totalTokens?: number;
  totalCost?: number;
  retries: number;
  qualityScore?: QualityScore;
}

/** Workflow status snapshot */
export interface WorkflowStatus {
  id: string;
  name: string;
  version: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  lastRun?: WorkflowMetrics;
  uptime: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Optimization & Evolution
// ═══════════════════════════════════════════════════════════════════

/** Optimization proposal from Evolution Engine */
export interface OptimizationProposal {
  workflowId: string;
  currentVersion: string;
  proposedVersion: string;
  changes: OptimizationChange[];
  expectedImprovement: {
    metric: string;
    current: number;
    expected: number;
  }[];
  risk: 'low' | 'medium' | 'high';
  confidence: number;
  generatedAt: number;
}

/** Single optimization change */
export interface OptimizationChange {
  type: 'parallelize' | 'reorder' | 'merge' | 'split' | 'add_step' | 'remove_step' | 'modify_step';
  description: string;
  targetStepIds: string[];
  justification: string;
}

/** Workflow version history entry */
export interface WorkflowVersion {
  version: string;
  createdAt: number;
  changeDescription: string;
  qualityScore?: QualityScore;
  executionCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// Execution Options
// ═══════════════════════════════════════════════════════════════════

export interface ExecutionOptions {
  timeout?: number;
  humanApproval?: boolean;
  simulation?: boolean;
  traceLevel?: 'full' | 'compact' | 'none';
  context?: Record<string, unknown>;
  onStepComplete?: (step: TraceEntry) => void;
  onError?: (error: Error) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Connector Types
// ═══════════════════════════════════════════════════════════════════

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════

export type WorkflowEventType =
  | 'workflow.installed'
  | 'workflow.enabled'
  | 'workflow.disabled'
  | 'workflow.uninstalled'
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.step.started'
  | 'workflow.step.completed'
  | 'workflow.step.failed'
  | 'workflow.optimized'
  | 'workflow.rolled_back';

export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowId: string;
  runId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}
