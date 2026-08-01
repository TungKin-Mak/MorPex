/**
 * StrategyOptimizer — 策略优化器
 *
 * 基于历史评估数据优化执行策略。
 */
import type { PlanEvaluation } from './PlanEvaluator.js';

export interface OptimizationSuggestion {
  type: 'parallelism' | 'checkpoint' | 'error-handling' | 'decomposition' | 'resource-allocation';
  description: string;
  expectedImpact: number; // 0-1
  priority: 'high' | 'medium' | 'low';
}

export class StrategyOptimizer {
  private history: PlanEvaluation[] = [];

  /** 添加评估记录 */
  addEvaluation(evaluation: PlanEvaluation): void {
    this.history.push(evaluation);
  }

  /** 获取历史记录 */
  getHistory(): PlanEvaluation[] { return [...this.history]; }

  /** 基于历史数据生成优化建议 */
  optimize(): OptimizationSuggestion[] {
    if (this.history.length === 0) return [];

    const suggestions: OptimizationSuggestion[] = [];

    // Analyze accuracy trends
    const avgAccuracy = this.history.reduce((s, e) => s + e.dimensions.accuracy, 0) / this.history.length;
    if (avgAccuracy < 0.6) {
      suggestions.push({
        type: 'error-handling',
        description: 'Low average accuracy — add pre-validation steps and error recovery',
        expectedImpact: 0.3,
        priority: 'high',
      });
    }

    // Analyze efficiency trends
    const avgEfficiency = this.history.reduce((s, e) => s + e.dimensions.efficiency, 0) / this.history.length;
    if (avgEfficiency < 0.4) {
      suggestions.push({
        type: 'parallelism',
        description: 'Low efficiency — increase parallel execution for independent nodes',
        expectedImpact: 0.25,
        priority: 'high',
      });
    }

    // Analyze resilience
    const avgResilience = this.history.reduce((s, e) => s + e.dimensions.resilience, 0) / this.history.length;
    if (avgResilience < 0.5) {
      suggestions.push({
        type: 'error-handling',
        description: 'Poor resilience — implement fallback plans and retry logic',
        expectedImpact: 0.35,
        priority: 'high',
      });
    }

    // Check for decomposition opportunities
    const highDurationPlans = this.history.filter(e => e.dimensions.efficiency < 0.3);
    if (highDurationPlans.length > 1) {
      suggestions.push({
        type: 'decomposition',
        description: `${highDurationPlans.length} plans inefficient — consider finer task decomposition`,
        expectedImpact: 0.2,
        priority: 'medium',
      });
    }

    // Checkpoint frequency optimization
    const lowResiliencePlans = this.history.filter(e => e.dimensions.resilience < 0.4);
    if (lowResiliencePlans.length > 1) {
      suggestions.push({
        type: 'checkpoint',
        description: 'Increase checkpoint frequency for better failure recovery',
        expectedImpact: 0.2,
        priority: 'medium',
      });
    }

    // Default suggestion when no specific issues trigger
    if (suggestions.length === 0) {
      suggestions.push({
        type: 'resource-allocation',
        description: 'Execution patterns stable — consider adjusting resource allocation for cost optimization',
        expectedImpact: 0.15,
        priority: 'low',
      });
    }

    return suggestions;
  }

  /** 重置历史 */
  reset(): void { this.history = []; }

  /** 历史记录数 */
  get historySize(): number { return this.history.length; }
}
