/**
 * FailureAnalyzer — v11 Failure Analysis Engine
 *
 * Analyzes workflow execution failures to identify root causes,
 * failure patterns, and recovery recommendations.
 *
 * Flow: Execution History → Failure Detection → Root Cause Analysis → Recommendations
 *
 * @packageDocumentation
 */

import type { RegisteredWorkflow } from './workflow/types.js';

/** Classified failure mode */
export interface FailureMode {
  /** Failure mode identifier */
  id: string;
  /** Failure category */
  category: FailureCategory;
  /** Human-readable description */
  description: string;
  /** Number of occurrences */
  occurrenceCount: number;
  /** Percentage of total failures */
  percentage: number;
  /** Confidence in this classification (0-1) */
  confidence: number;
  /** Suggested remediation */
  remediation: string;
  /** Example workflow IDs */
  exampleWorkflowIds: string[];
}

/** Failure category taxonomy */
export type FailureCategory =
  | 'capability_missing'
  | 'timeout'
  | 'invalid_input'
  | 'connector_error'
  | 'permission_denied'
  | 'agent_unavailable'
  | 'dependency_failed'
  | 'resource_exhausted'
  | 'unknown';

/** Failure analysis for a single workflow */
export interface WorkflowFailureAnalysis {
  /** Workflow ID */
  workflowId: string;
  /** Workflow name */
  workflowName: string;
  /** Total executions */
  totalExecutions: number;
  /** Failure count */
  failureCount: number;
  /** Failure rate (0-1) */
  failureRate: number;
  /** Identified failure modes */
  failureModes: FailureMode[];
  /** Overall health assessment */
  health: 'healthy' | 'degraded' | 'unhealthy';
  /** Top recommendation */
  topRecommendation: string;
}

/** Analysis configuration */
export interface FailureAnalysisConfig {
  /** Minimum failures to perform analysis */
  minFailures: number;
  /** Maximum failure modes per workflow */
  maxFailureModes: number;
}

const DEFAULT_CONFIG: FailureAnalysisConfig = {
  minFailures: 1,
  maxFailureModes: 5,
};

/**
 * FailureAnalyzer — Analyzes workflow execution failures
 *
 * Provides root cause analysis and remediation recommendations
 * for failed workflow executions.
 */
export class FailureAnalyzer {
  private config: FailureAnalysisConfig;
  private knownFailureModes: Map<string, FailureMode> = new Map();

  constructor(config?: Partial<FailureAnalysisConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * analyze — Analyze a workflow for failure patterns
   *
   * @param workflow - Registered workflow with execution history
   * @returns Failure analysis result
   */
  analyze(workflow: RegisteredWorkflow): WorkflowFailureAnalysis {
    const failureCount = Math.round(workflow.executionCount * (1 - workflow.successRate));
    const failureRate = workflow.executionCount > 0
      ? 1 - workflow.successRate
      : 0;

    let health: WorkflowFailureAnalysis['health'] = 'healthy';
    if (failureRate > 0.3) health = 'unhealthy';
    else if (failureRate > 0.1) health = 'degraded';

    // Identify failure modes from available data
    const failureModes = this.identifyFailureModes(workflow);

    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      totalExecutions: workflow.executionCount,
      failureCount,
      failureRate,
      failureModes,
      health,
      topRecommendation: this.generateTopRecommendation(failureModes, failureRate),
    };
  }

  /**
   * analyzeAll — Analyze all provided workflows
   *
   * @param workflows - Array of registered workflows
   * @returns Array of analyses sorted by health (worst first)
   */
  analyzeAll(workflows: RegisteredWorkflow[]): WorkflowFailureAnalysis[] {
    const analyses = workflows
      .filter(w => w.executionCount >= this.config.minFailures)
      .map(w => this.analyze(w));

    return analyses.sort((a, b) => {
      // Sort by health (unhealthy first)
      const healthOrder = { unhealthy: 0, degraded: 1, healthy: 2 };
      return (healthOrder[a.health] ?? 3) - (healthOrder[b.health] ?? 3);
    });
  }

  /**
   * getFailureModes — Get all identified failure modes
   */
  getFailureModes(): FailureMode[] {
    return [...this.knownFailureModes.values()];
  }

  /**
   * getFailureModesByCategory — Get failure modes by category
   */
  getFailureModesByCategory(category: FailureCategory): FailureMode[] {
    return [...this.knownFailureModes.values()]
      .filter(m => m.category === category);
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Analysis Methods
  // ═══════════════════════════════════════════════════════════════

  private identifyFailureModes(workflow: RegisteredWorkflow): FailureMode[] {
    const modes: FailureMode[] = [];

    // Analyze step-level patterns from versions
    const allSteps = this.collectAllSteps(workflow);

    // Check for capability mismatch
    const capabilityIssues = this.detectCapabilityIssues(allSteps);
    if (capabilityIssues) modes.push(capabilityIssues);

    // Check for dependency issues
    const depIssues = this.detectDependencyIssues(allSteps);
    if (depIssues) modes.push(depIssues);

    // Check timeout risk
    const timeoutRisk = this.detectTimeoutRisk(workflow);
    if (timeoutRisk) modes.push(timeoutRisk);

    // Truncate to max failure modes
    const truncated = modes.slice(0, this.config.maxFailureModes);

    // Update global registry
    for (const mode of truncated) {
      this.knownFailureModes.set(mode.id, mode);
    }

    return truncated;
  }

  private collectAllSteps(workflow: RegisteredWorkflow): WorkflowStepLike[] {
    const steps: WorkflowStepLike[] = [];
    for (const version of workflow.versions) {
      for (const step of version.steps) {
        steps.push({
          name: step.name,
          description: step.description,
          domain: step.domain,
          agentType: step.agentType,
          deps: step.deps,
          config: step.config,
        });
      }
    }
    return steps;
  }

  private detectCapabilityIssues(steps: WorkflowStepLike[]): FailureMode | null {
    // Detect if steps require capabilities that might not be available
    const uniqueDomains = new Set(steps.map(s => s.domain).filter(Boolean));
    const uniqueAgents = new Set(steps.map(s => s.agentType).filter(Boolean));

    if (uniqueDomains.size > 3 || uniqueAgents.size > 3) {
      return {
        id: `fm_cap_${Date.now()}`,
        category: 'capability_missing',
        description: `Workflow requires ${uniqueDomains.size} domains and ${uniqueAgents.size} agent types which may cause capability gaps`,
        occurrenceCount: 1,
        percentage: 100,
        confidence: 0.5,
        remediation: 'Reduce the number of distinct capabilities or ensure agents cover all required domains',
        exampleWorkflowIds: [],
      };
    }

    return null;
  }

  private detectDependencyIssues(steps: WorkflowStepLike[]): FailureMode | null {
    // Check for circular or complex dependencies
    const deps = steps.flatMap(s => s.deps ?? []);
    const uniqueDeps = new Set(deps);

    if (deps.length > steps.length * 1.5) {
      return {
        id: `fm_dep_${Date.now()}`,
        category: 'dependency_failed',
        description: `Complex dependency chain: ${deps.length} dependencies across ${steps.length} steps`,
        occurrenceCount: 1,
        percentage: 100,
        confidence: 0.4,
        remediation: 'Simplify the dependency graph by merging or parallelizing independent steps',
        exampleWorkflowIds: [],
      };
    }

    return null;
  }

  private detectTimeoutRisk(workflow: RegisteredWorkflow): FailureMode | null {
    // Check if avg duration suggests timeout risk
    if (workflow.avgDuration > 120_000) {
      // > 2 minutes
      return {
        id: `fm_to_${workflow.id}_${Date.now()}`,
        category: 'timeout',
        description: `High average duration (${Math.round(workflow.avgDuration / 1000)}s) suggests timeout risk`,
        occurrenceCount: Math.round(workflow.executionCount * (1 - workflow.successRate)),
        percentage: Math.round((1 - workflow.successRate) * 100),
        confidence: 0.6,
        remediation: 'Break down long-running steps or increase timeout thresholds',
        exampleWorkflowIds: [workflow.id],
      };
    }

    return null;
  }

  private generateTopRecommendation(
    failureModes: FailureMode[],
    failureRate: number
  ): string {
    if (failureModes.length === 0) {
      return 'No significant failure patterns detected';
    }

    if (failureRate > 0.3) {
      return `Critical: Address "${failureModes[0]?.description ?? 'unknown issue'}" — failure rate is ${Math.round(failureRate * 100)}%`;
    }

    if (failureRate > 0.1) {
      return `Warning: "${failureModes[0]?.description ?? 'unknown issue'}" contributing to ${Math.round(failureRate * 100)}% failure rate`;
    }

    return `Minor: "${failureModes[0]?.description ?? 'unknown issue'}" — monitor for degradation`;
  }
}

/** Internal step type for analysis */
interface WorkflowStepLike {
  name: string;
  description?: string;
  domain?: string;
  agentType?: string;
  deps?: string[];
  config?: Record<string, unknown>;
}
