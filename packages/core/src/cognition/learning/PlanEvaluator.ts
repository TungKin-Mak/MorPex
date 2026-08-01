/**
 * PlanEvaluator — 计划评估器
 *
 * 评估计划的执行效果，生成评估报告和优化建议。
 */
import type { ExecutionRecord, Experience } from './ExperienceExtractor.js';

export interface PlanEvaluation {
  planId: string;
  goal: string;
  score: number; // 0-1
  dimensions: {
    accuracy: number;
    efficiency: number;
    resilience: number;
    completeness: number;
  };
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export class PlanEvaluator {
  /** 评估计划执行效果 */
  evaluate(experience: Experience, record?: ExecutionRecord): PlanEvaluation {
    // Accuracy: success rate vs error rate
    const accuracy = experience.successRate ?? (experience.outcome === 'success' ? 0.9 : 0.3);

    // Efficiency: time per node
    const nodes = record?.nodes ?? [{ id: 'default', name: 'default', status: 'success', duration: 1000 }];
    const errors = record?.errors ?? [];
    const avgTimePerNode = nodes.length > 0 ? (record?.duration ?? 60000) / nodes.length : 0;
    const efficiency = Math.max(0, Math.min(1, 1 - avgTimePerNode / 120000)); // 2min per node = 0

    // Resilience: recovery from errors
    const resilience = errors.length === 0 ? 1 : Math.max(0, 1 - errors.length * 0.2);

    // Completeness: nodes completed vs total
    const totalNodes = nodes.length;
    const completedNodes = nodes.filter(n => n.status === 'success').length;
    const completeness = totalNodes > 0 ? completedNodes / totalNodes : 0;

    const score = accuracy * 0.30 + efficiency * 0.20 + resilience * 0.25 + completeness * 0.25;

    const strengths = this.identifyStrengths(nodes, errors);
    const weaknesses = this.identifyWeaknesses(nodes, errors, accuracy, efficiency, resilience);
    const suggestions = this.generateSuggestions(weaknesses, errors);

    return {
      planId: record?.planId ?? experience.id ?? 'unknown',
      goal: record?.goal ?? experience.goal,
      score,
      dimensions: { accuracy, efficiency, resilience, completeness },
      strengths, weaknesses, suggestions,
    };
  }

  private identifyStrengths(nodes: ExecutionRecord['nodes'], errors: string[]): string[] {
    const s: string[] = [];
    const completed = nodes.filter(n => n.status === 'success').length;
    const ratio = nodes.length > 0 ? completed / nodes.length : 1;
    if (ratio > 0.8) s.push('High execution accuracy');
    if (errors.length === 0) s.push('Zero errors');
    return s;
  }

  private identifyWeaknesses(nodes: ExecutionRecord['nodes'], errors: string[], accuracy: number, efficiency: number, resilience: number): string[] {
    const w: string[] = [];
    if (accuracy < 0.5) w.push('Low accuracy — too many failed nodes');
    if (efficiency < 0.3) w.push('Slow execution — consider parallelizing');
    if (resilience < 0.5) w.push('Poor error recovery — add fallback plans');
    if (errors.length > 3) w.push(`Many errors (${errors.length}) — review error patterns`);
    return w;
  }

  private generateSuggestions(weaknesses: string[], errors: string[]): string[] {
    const suggestions: string[] = [];
    if (weaknesses.some(w => w.includes('accuracy'))) suggestions.push('Add validation steps between critical nodes');
    if (weaknesses.some(w => w.includes('parallel'))) suggestions.push('Use parallel execution for independent nodes');
    if (weaknesses.some(w => w.includes('recovery'))) suggestions.push('Implement fallback nodes for critical paths');
    if (weaknesses.some(w => w.includes('errors'))) {
      suggestions.push(`Review top errors: ${[...new Set(errors)].slice(0, 3).join(', ')}`);
    }
    // Default improvement suggestion when no critical issues
    if (suggestions.length === 0) {
      suggestions.push('Execution successful — consider extracting patterns for future reuse');
    }
    return suggestions;
  }
}
