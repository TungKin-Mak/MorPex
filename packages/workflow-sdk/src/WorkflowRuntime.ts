/**
 * WorkflowRuntime — v11 Adaptive Workflow Runtime
 *
 * Provides the core execution engine for the Adaptive Workflow OS.
 * Wraps existing v10 MissionRuntime, DAGRuntime, and WorkflowRegistry
 * into the v11 unified runtime interface.
 *
 * @packageDocumentation
 */

import type {
  WorkflowPackage,
  InstalledWorkflow,
  WorkflowExecutionResult,
  WorkflowMetrics,
  WorkflowStatus,
  OptimizationProposal,
  WorkflowVersion as WorkflowVersionInfo,
  ExecutionOptions,
  WorkflowContext,
  TraceEntry,
  Artifact,
  QualityScore,
} from './types.js';

import { createWorkflowContext, createExecutionResult } from './WorkflowContext.js';

// ═══════════════════════════════════════════════════════════════════
// Internal imports (existing v10 modules)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference types for existing v10 modules.
 * These are duck-typed to avoid circular dependency issues.
 * In production, these are wired by the bootstrap/integration layer.
 */

interface V10MissionRuntime {
  executeMission(goal: string, context?: Record<string, unknown>): Promise<V10MissionResult>;
  simulate(goal: string): Promise<V10SimulationResult>;
}

interface V10MissionResult {
  success: boolean;
  missionId?: string;
  output?: unknown;
  error?: string;
  duration?: number;
}

interface V10SimulationResult {
  success: boolean;
  metrics?: Record<string, number>;
}

interface V10DAGRuntime {
  execute(dag: unknown, context?: unknown): Promise<{ success: boolean; output?: unknown; duration?: number }>;
  buildFromSteps(steps: unknown[]): unknown;
}

interface V10WorkflowRegistry {
  register(candidate: unknown): { id: string; name: string; status: string };
  get(id: string): { id: string; name: string; status: string; currentVersion: number; versions: { version: number }[]; executionCount: number; successRate: number; avgDuration: number; lastExecutedAt?: number } | undefined;
  activate(id: string): void;
  recordExecution(id: string, success: boolean, duration: number): void;
  getAll(): { id: string; name: string; status: string }[];
}

interface V10WorkflowExecutor {
  execute(workflowId: string, params?: Record<string, unknown>): Promise<{ success: boolean; missionId: string; duration: number; output?: unknown; error?: string }>;
}

interface V10WorkflowOptimizer {
  optimize(workflowId: string): Promise<{ suggestions: unknown[]; expectedImprovement: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// WorkflowRuntime
// ═══════════════════════════════════════════════════════════════════

/**
 * WorkflowRuntime — Core runtime for the Adaptive Workflow OS
 *
 * Manages workflow installation, execution, versioning, and optimization.
 * Delegates to existing v10 modules for actual execution.
 */
export class WorkflowRuntime {
  /** Installed workflows: workflowId → InstalledWorkflow */
  private installed: Map<string, InstalledWorkflow> = new Map();

  /** Execution run IDs counter */
  private runCounter = 0;

  /** Runtime registry for v10 compatibility */
  private registry: V10WorkflowRegistry;

  /** Mission runtime for task execution */
  private missionRuntime: V10MissionRuntime;

  /** DAG runtime for step orchestration */
  private dagRuntime: V10DAGRuntime;

  /** Workflow executor (v10 adapter) */
  private executor: V10WorkflowExecutor;

  /** Workflow optimizer (v10 adapter) */
  private optimizer: V10WorkflowOptimizer;

  /** Execution history for metrics */
  private executionHistory: Map<string, WorkflowExecutionResult[]> = new Map();

  constructor(
    deps: {
      registry: V10WorkflowRegistry;
      missionRuntime: V10MissionRuntime;
      dagRuntime: V10DAGRuntime;
      executor: V10WorkflowExecutor;
      optimizer: V10WorkflowOptimizer;
    }
  ) {
    this.registry = deps.registry;
    this.missionRuntime = deps.missionRuntime;
    this.dagRuntime = deps.dagRuntime;
    this.executor = deps.executor;
    this.optimizer = deps.optimizer;
  }

  // ═══════════════════════════════════════════════════════════════
  // Installation & Lifecycle
  // ═══════════════════════════════════════════════════════════════

  /**
   * install — Install a workflow package
   *
   * Validates the package manifest, registers with v10 registry,
   * and stores in the installed workflows map.
   *
   * @param pkg - Workflow package to install
   * @returns Installed workflow record
   */
  async install(pkg: WorkflowPackage): Promise<InstalledWorkflow> {
    const { manifest, definition } = pkg;

    // Validate required fields
    if (!manifest.name || !manifest.version) {
      throw new Error(`Invalid workflow package: name and version are required`);
    }
    if (!definition.steps || definition.steps.length === 0) {
      throw new Error(`Invalid workflow package: at least one step is required`);
    }

    // Generate workflow ID
    const workflowId = `wf-v11_${manifest.name}_${manifest.version.replace(/\./g, '_')}`;

    // Register with v10 registry for compatibility
    try {
      const candidate = {
        name: manifest.name,
        description: manifest.description ?? `Workflow ${manifest.name} v${manifest.version}`,
        steps: definition.steps.map((s, i) => ({
          name: s.name || s.id,
          description: s.name || s.id,
          domain: s.capability ? (Array.isArray(s.capability) ? s.capability[0] : s.capability) : 'general',
          agentType: s.capability ? (Array.isArray(s.capability) ? s.capability[0] : s.capability) : 'general',
          deps: s.dependsOn ?? [],
          config: s.config as Record<string, unknown> | undefined,
          timeoutMs: s.timeout,
        })),
        confidence: 1.0,
        sourceMissionIds: [],
        detectedAt: Date.now(),
        suggestedFrequency: 'once' as const,
      };
      this.registry.register(candidate);
    } catch (err) {
      console.warn('WorkflowRuntime.install: v10 registry registration failed (may already exist)', err);
    }

    // Create installed record
    const installed: InstalledWorkflow = {
      id: workflowId,
      package: pkg,
      status: 'enabled',
      installedAt: Date.now(),
      version: manifest.version,
    };

    this.installed.set(workflowId, installed);

    return installed;
  }

  /**
   * uninstall — Remove an installed workflow
   */
  async uninstall(workflowId: string): Promise<boolean> {
    const removed = this.installed.delete(workflowId);
    this.executionHistory.delete(workflowId);
    return removed;
  }

  /**
   * enable — Enable a workflow
   */
  async enable(workflowId: string): Promise<boolean> {
    const wf = this.installed.get(workflowId);
    if (!wf) return false;
    wf.status = 'enabled';
    return true;
  }

  /**
   * disable — Disable a workflow
   */
  async disable(workflowId: string): Promise<boolean> {
    const wf = this.installed.get(workflowId);
    if (!wf) return false;
    wf.status = 'disabled';
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // Execution
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — Execute an installed workflow
   *
   * Uses the v10 MissionRuntime for actual execution, then
   * wraps the result in the v11 format.
   *
   * @param workflowId - Workflow ID to execute
   * @param input - Input data
   * @param options - Optional execution configuration
   * @returns Execution result
   */
  async execute(
    workflowId: string,
    input: unknown,
    options?: ExecutionOptions
  ): Promise<WorkflowExecutionResult> {
    const wf = this.installed.get(workflowId);
    if (!wf) {
      throw new Error(`Workflow not installed: ${workflowId}`);
    }
    if (wf.status === 'disabled') {
      throw new Error(`Workflow is disabled: ${workflowId}`);
    }

    const runId = `v11_run_${Date.now()}_${++this.runCounter}`;
    const startTime = Date.now();

    // Build context
    const context = createWorkflowContext(workflowId, input, {
      runId,
      version: wf.version,
    });

    // Create trace
    const trace: TraceEntry[] = [];

    // If simulation mode, run simulation
    if (options?.simulation) {
      return this.runSimulation(wf, context, options);
    }

    try {
      // Execute via v10 MissionRuntime
      const steps = wf.package.definition.steps;

      for (const step of steps) {
        const stepStart = Date.now();
        const traceEntry: TraceEntry = {
          stepId: step.id,
          stepName: step.name,
          status: 'running',
          startTime: stepStart,
        };

        try {
          // Create a mission goal from the step
          const goal = step.name;
          const stepInput = {
            ...(step.input as Record<string, unknown> ?? {}),
            ...(input as Record<string, unknown> ?? {}),
            workflowRunId: runId,
          };

          // Execute step via MissionRuntime
          const result = await this.missionRuntime.executeMission(goal, stepInput);

          traceEntry.status = result.success ? 'success' : 'failed';
          traceEntry.endTime = Date.now();
          traceEntry.duration = traceEntry.endTime - stepStart;
          traceEntry.output = result.output;

          if (!result.success) {
            traceEntry.error = result.error ?? 'Step execution failed';
            trace.push(traceEntry);
            break;
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          traceEntry.status = 'failed';
          traceEntry.endTime = Date.now();
          traceEntry.duration = traceEntry.endTime - stepStart;
          traceEntry.error = errorMessage;
          trace.push(traceEntry);
          break;
        }

        trace.push(traceEntry);
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      // Determine overall status
      const allSuccess = trace.every(t => t.status === 'success');
      const hasFailed = trace.some(t => t.status === 'failed');
      const status: WorkflowExecutionResult['status'] = hasFailed
        ? 'failed'
        : allSuccess
          ? 'success'
          : 'partial';

      // Extract error from first failed trace entry
      const firstFailed = trace.find(t => t.status === 'failed');
      const errorMessage = firstFailed?.error;

      // Build result
      const result = createExecutionResult(
        context,
        status,
        trace.filter(t => t.status === 'success').map(t => t.output),
        errorMessage
      );

      // Add trace
      result.trace = {
        entries: trace,
        startTime,
        endTime,
        totalDuration,
      };

      // Calculate metrics
      const totalSteps = steps.length;
      const completedSteps = trace.filter(t => t.status === 'success').length;
      const failedSteps = trace.filter(t => t.status === 'failed').length;

      result.metrics = {
        duration: totalDuration,
        totalSteps,
        completedSteps,
        failedSteps,
        totalTokens: 0,
        totalCost: 0,
        retries: 0,
      };

      // Calculate quality score
      result.qualityScore = this.calculateQualityScore(result.metrics, status);

      // Record execution in v10 registry
      this.registry.recordExecution(
        workflowId,
        status === 'success',
        totalDuration
      );

      // Store in history
      const history = this.executionHistory.get(workflowId) ?? [];
      history.push(result);
      // Keep last 100 executions
      if (history.length > 100) history.shift();
      this.executionHistory.set(workflowId, history);

      // Update workflow last executed time
      wf.lastExecutedAt = Date.now();

      return result;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const endTime = Date.now();

      return {
        workflowId,
        runId,
        status: 'failed',
        output: null,
        metrics: {
          duration: endTime - startTime,
          totalSteps: trace.length,
          completedSteps: trace.filter(t => t.status === 'success').length,
          failedSteps: trace.filter(t => t.status === 'failed').length,
          totalTokens: 0,
          totalCost: 0,
          retries: 0,
        },
        artifacts: [],
        trace: {
          entries: trace,
          startTime,
          endTime,
          totalDuration: endTime - startTime,
        },
        qualityScore: {
          correctness: 0,
          reliability: 0,
          cost: 0,
          speed: 0,
          overall: 0,
        },
        error: errorMessage,
      };
    }
  }

  /**
   * runSimulation — Execute workflow in simulation mode
   */
  private async runSimulation(
    wf: InstalledWorkflow,
    _context: WorkflowContext,
    _options?: ExecutionOptions
  ): Promise<WorkflowExecutionResult> {
    const simResult = await this.missionRuntime.simulate(wf.package.definition.name);

    const result = createExecutionResult(
      _context,
      simResult.success ? 'success' : 'failed',
      simResult.metrics
    );

    result.trace = {
      entries: [],
      startTime: Date.now(),
      endTime: Date.now(),
      totalDuration: 0,
    };

    result.metrics = {
      duration: 0,
      totalSteps: wf.package.definition.steps.length,
      completedSteps: simResult.success ? wf.package.definition.steps.length : 0,
      failedSteps: simResult.success ? 0 : 1,
      totalTokens: 0,
      totalCost: 0,
      retries: 0,
    };

    result.qualityScore = this.calculateQualityScore(result.metrics, simResult.success ? 'success' : 'failed');

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // Observability & Metrics
  // ═══════════════════════════════════════════════════════════════

  /**
   * list — List all installed workflows
   */
  async list(): Promise<InstalledWorkflow[]> {
    return [...this.installed.values()];
  }

  /**
   * getStatus — Get current workflow status
   */
  async getStatus(workflowId: string): Promise<WorkflowStatus> {
    const wf = this.installed.get(workflowId);
    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const history = this.executionHistory.get(workflowId) ?? [];
    const lastRun = history.length > 0 ? history[history.length - 1].metrics : undefined;

    return {
      id: wf.id,
      name: wf.package.manifest.name,
      version: wf.version,
      status: wf.status === 'enabled' ? 'idle' : 'paused',
      lastRun,
      uptime: Date.now() - wf.installedAt,
    };
  }

  /**
   * getMetrics — Get aggregated metrics for a workflow
   */
  async getMetrics(workflowId: string): Promise<WorkflowMetrics> {
    const history = this.executionHistory.get(workflowId) ?? [];

    if (history.length === 0) {
      return {
        duration: 0,
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        totalTokens: 0,
        totalCost: 0,
        retries: 0,
      };
    }

    const totalDuration = history.reduce((sum, r) => sum + r.metrics.duration, 0);
    const totalSteps = history.reduce((sum, r) => sum + r.metrics.totalSteps, 0);
    const completedSteps = history.reduce((sum, r) => sum + r.metrics.completedSteps, 0);
    const failedSteps = history.reduce((sum, r) => sum + r.metrics.failedSteps, 0);
    const retries = history.reduce((sum, r) => sum + r.metrics.retries, 0);

    return {
      duration: totalDuration / history.length,
      totalSteps,
      completedSteps,
      failedSteps,
      totalTokens: 0,
      totalCost: 0,
      retries,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Optimization & Evolution
  // ═══════════════════════════════════════════════════════════════

  /**
   * optimize — Trigger optimization for a workflow
   *
   * Collects execution history and delegates to the v10 optimizer.
   *
   * @param workflowId - Workflow to optimize
   * @returns Optimization proposal
   */
  async optimize(workflowId: string): Promise<OptimizationProposal> {
    const wf = this.installed.get(workflowId);
    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const history = this.executionHistory.get(workflowId) ?? [];

    try {
      const result = await this.optimizer.optimize(workflowId);

      return {
        workflowId,
        currentVersion: wf.version,
        proposedVersion: incrementVersion(wf.version),
        changes: (result.suggestions ?? []).map((s: unknown) => {
          const suggestion = s as { type?: string; description?: string; targetSteps?: string[] };
          return {
            type: (suggestion.type as OptimizationProposal['changes'][0]['type']) ?? 'modify_step',
            description: suggestion.description ?? 'Optimization suggestion',
            targetStepIds: suggestion.targetSteps ?? [],
            justification: suggestion.description ?? 'Optimization from Evolution Engine',
          };
        }),
        expectedImprovement: [
          {
            metric: 'overall_quality',
            current: this.getAggregatedQuality(history),
            expected: this.getAggregatedQuality(history) * (1 + (result.expectedImprovement ?? 0.1)),
          },
        ],
        risk: 'medium',
        confidence: result.expectedImprovement ?? 0.5,
        generatedAt: Date.now(),
      };
    } catch (err) {
      console.warn('WorkflowRuntime.optimize: optimizer failed, returning basic proposal', err);
      return {
        workflowId,
        currentVersion: wf.version,
        proposedVersion: incrementVersion(wf.version),
        changes: [],
        expectedImprovement: [],
        risk: 'low',
        confidence: 0,
        generatedAt: Date.now(),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Version Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * listVersions — List all versions of a workflow
   */
  async listVersions(workflowId: string): Promise<WorkflowVersionInfo[]> {
    const wf = this.installed.get(workflowId);
    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const history = this.executionHistory.get(workflowId) ?? [];
    const versions: WorkflowVersionInfo[] = [
      {
        version: wf.version,
        createdAt: wf.installedAt,
        changeDescription: 'Initial installation',
        executionCount: history.length,
      },
    ];

    // Add v10 registry versions if available
    const regWf = this.registry.get(workflowId);
    if (regWf) {
      for (const v of regWf.versions ?? []) {
        // Deduplicate
        if (!versions.some(ex => ex.version === `v${v.version}`)) {
          versions.push({
            version: `v${v.version}`,
            createdAt: regWf.lastExecutedAt ?? 0,
            changeDescription: `v10 version ${v.version}`,
            executionCount: 0,
          });
        }
      }
    }

    return versions;
  }

  /**
   * rollback — Rollback to a specific version
   */
  async rollback(workflowId: string, _version: string): Promise<boolean> {
    const wf = this.installed.get(workflowId);
    if (!wf) return false;

    wf.version = _version;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * calculateQualityScore — Calculate quality score from metrics
   */
  private calculateQualityScore(
    metrics: WorkflowMetrics,
    status: string
  ): QualityScore {
    const success = status === 'success' ? 100 : status === 'partial' ? 50 : 0;
    const reliability = metrics.failedSteps === 0 ? 100 : Math.max(0, 100 - (metrics.failedSteps / Math.max(1, metrics.totalSteps)) * 100);
    const cost = 100; // Placeholder — requires actual cost tracking
    const speed = metrics.duration > 0 ? Math.min(100, 300_000 / metrics.duration * 100) : 100;

    const overall = Math.round(
      success * 0.35 + reliability * 0.30 + cost * 0.15 + speed * 0.20
    );

    return {
      correctness: Math.round(success),
      reliability: Math.round(reliability),
      cost: Math.round(cost),
      speed: Math.round(Math.min(100, speed)),
      overall,
    };
  }

  /**
   * getAggregatedQuality — Get average quality from execution history
   */
  private getAggregatedQuality(history: WorkflowExecutionResult[]): number {
    if (history.length === 0) return 0;
    const sum = history.reduce((total, r) => total + (r.qualityScore?.overall ?? 0), 0);
    return sum / history.length;
  }
}

/**
 * incrementVersion — Increment a semantic version string
 */
function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return `${version}.1`;
  }
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}
