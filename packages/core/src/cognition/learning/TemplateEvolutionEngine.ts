/**
 * TemplateEvolutionEngine — 模板进化引擎
 *
 * 基于经验反馈自动进化计划模板。
 * 追踪模板使用效果，淘汰低效模板，推荐高效模板。
 */
import type { Experience } from './ExperienceExtractor.js';
import type { PlanEvaluation } from './PlanEvaluator.js';

export interface PlanTemplate {
  id: string;
  name: string;
  goalType: string;
  nodeSequence: string[];
  successRate: number;
  avgDuration: number;
  usageCount: number;
  lastUsed: number;
  version: number;
}

export interface TemplateRecommendation {
  template: PlanTemplate;
  reason: string;
  confidence: number;
}

export class TemplateEvolutionEngine {
  private templates: Map<string, PlanTemplate> = new Map();

  /** 注册模板 */
  register(template: PlanTemplate): void {
    template.version = 1;
    this.templates.set(template.id, template);
  }

  /** 获取所有模板 */
  getAll(): PlanTemplate[] { return [...this.templates.values()]; }

  /** 根据经验更新模板 */
  updateWithExperience(experience: Experience): void {
    // Find matching template by goal type
    for (const [id, template] of this.templates) {
      if (template.goalType === experience.goalType) {
        const updated: PlanTemplate = {
          ...template,
          usageCount: template.usageCount + 1,
          successRate: this.calculateNewSuccessRate(template.successRate, experience.outcome === 'success', template.usageCount),
          avgDuration: this.calculateNewAvg(template.avgDuration, experience.duration, template.usageCount),
          lastUsed: Date.now(),
          version: template.version + 1,
        };
        this.templates.set(id, updated);
        break;
      }
    }
  }

  /** 根据评估更新模板 */
  updateWithEvaluation(evaluation: PlanEvaluation): void {
    for (const [id, template] of this.templates) {
      if (template.name.toLowerCase().includes(evaluation.goal.substring(0, 10).toLowerCase())) {
        // Update with evaluation score
        const updated: PlanTemplate = {
          ...template,
          usageCount: template.usageCount + 1,
          successRate: this.calculateNewSuccessRate(template.successRate, evaluation.score > 0.7, template.usageCount),
          lastUsed: Date.now(),
          version: template.version + 1,
        };
        this.templates.set(id, updated);
        break;
      }
    }
  }

  /** 推荐最佳模板 */
  recommend(goalType: string, topK: number = 3): TemplateRecommendation[] {
    const candidates = [...this.templates.values()]
      .filter(t => t.goalType === goalType && t.successRate > 0.3)
      .sort((a, b) => b.successRate - a.successRate);

    return candidates.slice(0, topK).map(t => ({
      template: t,
      reason: `Success rate ${(t.successRate * 100).toFixed(0)}% across ${t.usageCount} uses`,
      confidence: t.successRate * Math.min(1, t.usageCount / 5),
    }));
  }

  /** 淘汰低效模板 (successRate < threshold, usageCount > min) */
  evict(threshold: number = 0.2, minUsage: number = 3): string[] {
    const evicted: string[] = [];
    for (const [id, template] of this.templates) {
      if (template.usageCount >= minUsage && template.successRate < threshold) {
        this.templates.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }

  /** 获取模板统计 */
  getStats(): { total: number; avgSuccessRate: number; avgUsage: number } {
    const templates = [...this.templates.values()];
    if (templates.length === 0) return { total: 0, avgSuccessRate: 0, avgUsage: 0 };
    return {
      total: templates.length,
      avgSuccessRate: templates.reduce((s, t) => s + t.successRate, 0) / templates.length,
      avgUsage: templates.reduce((s, t) => s + t.usageCount, 0) / templates.length,
    };
  }

  /** 清除所有模板 */
  clear(): void { this.templates.clear(); }

  private calculateNewSuccessRate(oldRate: number, wasSuccess: boolean, usageCount: number): number {
    // Weighted update: new observation has weight 1/(count+1)
    const weight = 1 / (usageCount + 1);
    return oldRate * (1 - weight) + (wasSuccess ? 1 : 0) * weight;
  }

  private calculateNewAvg(oldAvg: number, newValue: number, count: number): number {
    return (oldAvg * count + newValue) / (count + 1);
  }
}
