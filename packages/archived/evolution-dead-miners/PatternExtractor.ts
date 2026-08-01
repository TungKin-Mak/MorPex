/**
 * PatternExtractor — v11 Pattern Extraction Engine
 *
 * Extracts reusable workflow patterns from execution history.
 * Identifies repeating step sequences, common capability combinations,
 * and structural optimization opportunities.
 *
 * Flow: Execution History → Sequence Analysis → Pattern Recognition → Pattern Catalog
 *
 * @packageDocumentation
 */

import type { RegisteredWorkflow, WorkflowStepDef } from './workflow/types.js';

/** Extracted workflow pattern */
export interface ExtractedPattern {
  /** Pattern identifier */
  id: string;
  /** Pattern name */
  name: string;
  /** Pattern description */
  description: string;
  /** Pattern category */
  category: PatternCategory;
  /** The step sequence defining this pattern */
  stepSequence: string[];
  /** Capabilities required by this pattern */
  requiredCapabilities: string[];
  /** Source workflow IDs */
  sourceWorkflowIds: string[];
  /** Number of times this pattern has been observed */
  occurrenceCount: number;
  /** Pattern confidence (0-1) */
  confidence: number;
  /** When this pattern was first detected */
  firstDetectedAt: number;
  /** When this pattern was last observed */
  lastObservedAt: number;
  /** Whether this pattern is recommended for reuse */
  recommended: boolean;
  /** Tags for categorization */
  tags: string[];
}

/** Pattern category */
export type PatternCategory =
  | 'sequential_pipeline'
  | 'parallel_fork'
  | 'feedback_loop'
  | 'approval_gate'
  | 'data_transform'
  | 'research_analyze'
  | 'build_test_deploy'
  | 'custom';

/** Pattern extraction configuration */
export interface PatternExtractorConfig {
  /** Minimum occurrences to consider a pattern valid */
  minOccurrences: number;
  /** Minimum confidence threshold */
  minConfidence: number;
  /** Maximum patterns to track */
  maxPatterns: number;
}

const DEFAULT_CONFIG: PatternExtractorConfig = {
  minOccurrences: 2,
  minConfidence: 0.5,
  maxPatterns: 100,
};

/** Common pattern templates matched against step sequences */
const PATTERN_TEMPLATES: Array<{
  category: PatternCategory;
  name: string;
  description: string;
  tags: string[];
  match: (steps: string[]) => boolean;
}> = [
  {
    category: 'build_test_deploy',
    name: 'Build → Test → Deploy',
    description: 'Standard CI/CD pipeline: build, then test, then deploy',
    tags: ['cicd', 'engineering', 'automation'],
    match: (steps: string[]) => {
      const seq = steps.map(s => s.toLowerCase());
      const hasBuild = seq.some(s => s.includes('build') || s.includes('compile'));
      const hasTest = seq.some(s => s.includes('test') || s.includes('verify'));
      const hasDeploy = seq.some(s => s.includes('deploy') || s.includes('release') || s.includes('publish'));
      return hasBuild && hasTest && hasDeploy;
    },
  },
  {
    category: 'research_analyze',
    name: 'Research → Analyze → Report',
    description: 'Research workflow: gather information, analyze, produce report',
    tags: ['research', 'analysis', 'documentation'],
    match: (steps: string[]) => {
      const seq = steps.map(s => s.toLowerCase());
      const hasResearch = seq.some(s => s.includes('research') || s.includes('search') || s.includes('gather'));
      const hasAnalyze = seq.some(s => s.includes('analyz') || s.includes('evaluat') || s.includes('assess'));
      const hasReport = seq.some(s => s.includes('report') || s.includes('write') || s.includes('document'));
      return hasResearch && hasAnalyze && hasReport;
    },
  },
  {
    category: 'approval_gate',
    name: 'Approval Gate Pattern',
    description: 'Workflow with human approval checkpoint',
    tags: ['governance', 'approval', 'compliance'],
    match: (steps: string[]) => {
      return steps.some(s => s.toLowerCase().includes('approv') || s.includes('review'));
    },
  },
  {
    category: 'feedback_loop',
    name: 'Feedback Loop Pattern',
    description: 'Iterative workflow with feedback cycles',
    tags: ['iteration', 'feedback', 'improvement'],
    match: (steps: string[]) => {
      const stepSet = new Set(steps.map(s => s.toLowerCase()));
      // Check for repeated capability patterns
      const uniqueSteps = stepSet.size;
      return steps.length > uniqueSteps * 1.5 && steps.length > 3;
    },
  },
  {
    category: 'sequential_pipeline',
    name: 'Sequential Pipeline',
    description: 'Linear step-by-step execution pipeline',
    tags: ['pipeline', 'sequential', 'linear'],
    match: (steps: string[]) => {
      return steps.length >= 3 && steps.every(s => s.length > 0);
    },
  },
  {
    category: 'parallel_fork',
    name: 'Parallel Fork Pattern',
    description: 'Workflow with parallel execution branches',
    tags: ['parallel', 'concurrent', 'optimization'],
    match: (steps: string[]) => {
      // Detected by dependency analysis — always returns false for simple stepping
      return false;
    },
  },
];

/**
 * PatternExtractor — Extracts reusable patterns from workflow definitions
 *
 * Analyzes workflow step sequences to identify common structural patterns
 * that can be reused, optimized, or templated.
 */
export class PatternExtractor {
  private patterns: Map<string, ExtractedPattern> = new Map();
  private config: PatternExtractorConfig;

  constructor(config?: Partial<PatternExtractorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * extract — Extract patterns from a workflow
   *
   * @param workflow - Registered workflow
   * @param workflows - All workflows for cross-reference
   * @returns Extracted patterns
   */
  extract(workflow: RegisteredWorkflow, workflows: RegisteredWorkflow[]): ExtractedPattern[] {
    const extracted: ExtractedPattern[] = [];

    // Extract step names for pattern matching
    const latestVersion = workflow.versions[workflow.versions.length - 1];
    if (!latestVersion) return extracted;

    const stepNames = latestVersion.steps.map(s => s.name);
    const stepDomains = latestVersion.steps.map(s => s.domain);
    const capabilities = [...new Set([...stepDomains, ...latestVersion.steps.map(s => s.agentType)])];

    // Match against pattern templates
    for (const template of PATTERN_TEMPLATES) {
      if (template.match(stepNames)) {
        const existing = this.findExistingPattern(template.name, workflow.id);

        if (existing) {
          // Update existing pattern
          existing.occurrenceCount++;
          existing.lastObservedAt = Date.now();
          if (!existing.sourceWorkflowIds.includes(workflow.id)) {
            existing.sourceWorkflowIds.push(workflow.id);
          }
          existing.confidence = Math.min(1.0, existing.confidence + 0.1);
          existing.recommended = existing.confidence >= this.config.minConfidence;
          extracted.push(existing);
        } else {
          // Create new pattern
          const pattern: ExtractedPattern = {
            id: `pattern_${template.category}_${Date.now()}`,
            name: template.name,
            description: template.description,
            category: template.category,
            stepSequence: stepNames,
            requiredCapabilities: capabilities,
            sourceWorkflowIds: [workflow.id],
            occurrenceCount: 1,
            confidence: 0.3, // Start low, increase with repetition
            firstDetectedAt: Date.now(),
            lastObservedAt: Date.now(),
            recommended: false,
            tags: template.tags,
          };
          this.patterns.set(pattern.id, pattern);
          extracted.push(pattern);
        }
      }
    }

    // Enforce max limit
    this.enforceMaxLimit();

    return extracted;
  }

  /**
   * extractAll — Extract patterns from all workflows
   *
   * @param workflows - Array of registered workflows
   * @returns All extracted patterns
   */
  extractAll(workflows: RegisteredWorkflow[]): ExtractedPattern[] {
    const allExtracted: ExtractedPattern[] = [];

    for (let i = 0; i < workflows.length; i++) {
      const extracted = this.extract(workflows[i]!, workflows);
      allExtracted.push(...extracted);
    }

    // Recalculate confidence based on cross-workflow occurrences
    for (const pattern of this.patterns.values()) {
      if (pattern.occurrenceCount >= this.config.minOccurrences) {
        pattern.confidence = Math.min(1.0, pattern.occurrenceCount / 10);
        pattern.recommended = pattern.confidence >= this.config.minConfidence;
      }
    }

    return allExtracted;
  }

  /**
   * getPattern — Get a specific pattern
   */
  getPattern(id: string): ExtractedPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * listPatterns — List all extracted patterns
   */
  listPatterns(category?: PatternCategory): ExtractedPattern[] {
    const all = [...this.patterns.values()];
    if (category) return all.filter(p => p.category === category);
    return all.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * getRecommendedPatterns — Get patterns recommended for reuse
   */
  getRecommendedPatterns(): ExtractedPattern[] {
    return [...this.patterns.values()]
      .filter(p => p.recommended)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * getStats — Get pattern extraction statistics
   */
  getStats(): {
    totalPatterns: number;
    recommendedPatterns: number;
    categories: Record<string, number>;
  } {
    const all = [...this.patterns.values()];
    const categories: Record<string, number> = {};
    for (const p of all) {
      categories[p.category] = (categories[p.category] ?? 0) + 1;
    }

    return {
      totalPatterns: all.length,
      recommendedPatterns: all.filter(p => p.recommended).length,
      categories,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════

  private findExistingPattern(name: string, workflowId: string): ExtractedPattern | undefined {
    // Find a pattern with the same name that already includes this workflow
    for (const pattern of this.patterns.values()) {
      if (pattern.name === name && pattern.sourceWorkflowIds.includes(workflowId)) {
        return pattern;
      }
    }
    return undefined;
  }

  private enforceMaxLimit(): void {
    if (this.patterns.size > this.config.maxPatterns) {
      // Remove least confident patterns
      const sorted = [...this.patterns.entries()]
        .sort(([, a], [, b]) => a.confidence - b.confidence);

      const toRemove = this.patterns.size - this.config.maxPatterns;
      for (let i = 0; i < toRemove; i++) {
        const [id] = sorted[i]!;
        this.patterns.delete(id);
      }
    }
  }
}

export { PATTERN_TEMPLATES };
