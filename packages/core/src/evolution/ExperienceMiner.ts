/**
 * ExperienceMiner — v11 Experience Mining Engine
 *
 * Mines execution history to extract reusable experiences.
 * Part of the Evolution Engine's self-optimization loop.
 *
 * Flow: Execution History → Analyze → Extract Patterns → Store Experiences
 *
 * @packageDocumentation
 */

import type { RegisteredWorkflow, WorkflowVersion, WorkflowStepDef } from './workflow/types.js';

/** A mined experience extracted from workflow execution */
export interface MinedExperience {
  /** Unique experience ID */
  id: string;
  /** Source workflow ID */
  sourceWorkflowId: string;
  /** Source workflow version */
  sourceVersion: number;
  /** Experience category */
  category: 'success_pattern' | 'failure_pattern' | 'optimization_hint' | 'performance_insight';
  /** Experience description */
  description: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Applicable contexts */
  applicableContexts: string[];
  /** The mined data */
  data: Record<string, unknown>;
  /** When this was mined */
  minedAt: number;
  /** How many times this experience has been applied */
  applicationCount: number;
}

/** Mining configuration */
export interface MiningConfig {
  /** Minimum execution count to mine from */
  minExecutions: number;
  /** Minimum success rate to consider a pattern reliable */
  minSuccessRate: number;
  /** Maximum number of experiences to keep */
  maxExperiences: number;
}

const DEFAULT_CONFIG: MiningConfig = {
  minExecutions: 5,
  minSuccessRate: 0.7,
  maxExperiences: 1000,
};

/**
 * ExperienceMiner — Extracts reusable knowledge from execution history
 *
 * Analyzes workflow execution records to identify:
 * - Successful patterns worth repeating
 * - Failure patterns to avoid
 * - Optimization opportunities
 * - Performance characteristics
 */
export class ExperienceMiner {
  private experiences: Map<string, MinedExperience> = new Map();
  private config: MiningConfig;

  constructor(config?: Partial<MiningConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * mine — Mine experiences from a workflow's execution history
   *
   * @param workflow - The registered workflow with execution history
   * @returns Array of mined experiences
   */
  mine(workflow: RegisteredWorkflow): MinedExperience[] {
    const mined: MinedExperience[] = [];

    // Check minimum execution count
    if (workflow.executionCount < this.config.minExecutions) {
      return mined;
    }

    // Mine success patterns
    if (workflow.successRate >= this.config.minSuccessRate) {
      mined.push(this.mineSuccessPattern(workflow));
    }

    // Mine failure patterns (if any failures exist)
    if (workflow.executionCount > 0 && workflow.successRate < 1.0) {
      mined.push(this.mineFailurePattern(workflow));
    }

    // Mine performance insights
    mined.push(this.minePerformanceInsight(workflow));

    // Mine optimization hints from version history
    if (workflow.versions.length > 1) {
      mined.push(this.mineOptimizationHint(workflow));
    }

    // Store mined experiences
    for (const exp of mined) {
      this.experiences.set(exp.id, exp);
    }

    // Enforce max limit
    this.enforceMaxLimit();

    return mined;
  }

  /**
   * mineAll — Mine experiences from all provided workflows
   *
   * @param workflows - Array of registered workflows
   * @returns All mined experiences
   */
  mineAll(workflows: RegisteredWorkflow[]): MinedExperience[] {
    const allMined: MinedExperience[] = [];
    for (const wf of workflows) {
      const mined = this.mine(wf);
      allMined.push(...mined);
    }
    return allMined;
  }

  /**
   * getExperience — Get a specific experience
   */
  getExperience(id: string): MinedExperience | undefined {
    return this.experiences.get(id);
  }

  /**
   * listExperiences — List all mined experiences
   */
  listExperiences(category?: MinedExperience['category']): MinedExperience[] {
    const all = [...this.experiences.values()];
    if (category) return all.filter(e => e.category === category);
    return all;
  }

  /**
   * findByContext — Find experiences applicable to a given context
   *
   * @param context - Context identifier (e.g., capability name)
   * @returns Matching experiences sorted by confidence
   */
  findByContext(context: string): MinedExperience[] {
    return [...this.experiences.values()]
      .filter(e => e.applicableContexts.includes(context) || e.applicableContexts.includes('*'))
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * getStats — Get mining statistics
   */
  getStats(): {
    totalExperiences: number;
    successPatterns: number;
    failurePatterns: number;
    optimizationHints: number;
    performanceInsights: number;
  } {
    const all = [...this.experiences.values()];
    return {
      totalExperiences: all.length,
      successPatterns: all.filter(e => e.category === 'success_pattern').length,
      failurePatterns: all.filter(e => e.category === 'failure_pattern').length,
      optimizationHints: all.filter(e => e.category === 'optimization_hint').length,
      performanceInsights: all.filter(e => e.category === 'performance_insight').length,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Mining Methods
  // ═══════════════════════════════════════════════════════════════

  private mineSuccessPattern(workflow: RegisteredWorkflow): MinedExperience {
    return {
      id: `exp_success_${workflow.id}_${Date.now()}`,
      sourceWorkflowId: workflow.id,
      sourceVersion: workflow.currentVersion,
      category: 'success_pattern',
      description: `Workflow "${workflow.name}" has ${Math.round(workflow.successRate * 100)}% success rate over ${workflow.executionCount} executions`,
      confidence: workflow.successRate,
      applicableContexts: [workflow.name, ...this.extractDomains(workflow)],
      data: {
        name: workflow.name,
        successRate: workflow.successRate,
        executionCount: workflow.executionCount,
        avgDuration: workflow.avgDuration,
        steps: workflow.versions[workflow.versions.length - 1]?.steps ?? [],
      },
      minedAt: Date.now(),
      applicationCount: 0,
    };
  }

  private mineFailurePattern(workflow: RegisteredWorkflow): MinedExperience {
    const failureRate = 1 - workflow.successRate;
    return {
      id: `exp_failure_${workflow.id}_${Date.now()}`,
      sourceWorkflowId: workflow.id,
      sourceVersion: workflow.currentVersion,
      category: 'failure_pattern',
      description: `Workflow "${workflow.name}" has ${Math.round(failureRate * 100)}% failure rate`,
      confidence: Math.min(failureRate * 2, 1.0), // Scale up rare failures
      applicableContexts: [workflow.name, ...this.extractDomains(workflow)],
      data: {
        name: workflow.name,
        successRate: workflow.successRate,
        failureCount: Math.round(workflow.executionCount * failureRate),
        totalExecutions: workflow.executionCount,
      },
      minedAt: Date.now(),
      applicationCount: 0,
    };
  }

  private minePerformanceInsight(workflow: RegisteredWorkflow): MinedExperience {
    const performanceLevel = workflow.avgDuration > 0
      ? Math.min(100, Math.round(300_000 / workflow.avgDuration * 100))
      : 50;

    return {
      id: `exp_perf_${workflow.id}_${Date.now()}`,
      sourceWorkflowId: workflow.id,
      sourceVersion: workflow.currentVersion,
      category: 'performance_insight',
      description: `Workflow "${workflow.name}" avg duration ${workflow.avgDuration}ms (performance level: ${performanceLevel})`,
      confidence: 0.6,
      applicableContexts: [workflow.name],
      data: {
        name: workflow.name,
        avgDuration: workflow.avgDuration,
        performanceLevel,
        executionCount: workflow.executionCount,
      },
      minedAt: Date.now(),
      applicationCount: 0,
    };
  }

  private mineOptimizationHint(workflow: RegisteredWorkflow): MinedExperience {
    const versionCount = workflow.versions.length;
    return {
      id: `exp_opt_${workflow.id}_${Date.now()}`,
      sourceWorkflowId: workflow.id,
      sourceVersion: workflow.currentVersion,
      category: 'optimization_hint',
      description: `Workflow "${workflow.name}" has undergone ${versionCount} version changes, indicating active evolution`,
      confidence: Math.min(versionCount / 10, 1.0),
      applicableContexts: [workflow.name],
      data: {
        name: workflow.name,
        versionCount,
        versions: workflow.versions.map(v => ({
          version: v.version,
          changeDescription: v.changeDescription,
        })),
      },
      minedAt: Date.now(),
      applicationCount: 0,
    };
  }

  private extractDomains(workflow: RegisteredWorkflow): string[] {
    const domains = new Set<string>();
    for (const version of workflow.versions) {
      for (const step of version.steps) {
        if (step.domain) domains.add(step.domain);
        if (step.agentType) domains.add(step.agentType);
      }
    }
    return [...domains];
  }

  private enforceMaxLimit(): void {
    if (this.experiences.size > this.config.maxExperiences) {
      // Remove oldest experiences
      const sorted = [...this.experiences.entries()]
        .sort(([, a], [, b]) => a.minedAt - b.minedAt);

      const toRemove = this.experiences.size - this.config.maxExperiences;
      for (let i = 0; i < toRemove; i++) {
        const [id] = sorted[i]!;
        this.experiences.delete(id);
      }
    }
  }
}
