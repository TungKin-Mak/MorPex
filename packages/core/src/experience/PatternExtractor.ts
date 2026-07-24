import { CapabilityStore } from './CapabilityStore.js';
import type { CapabilityPattern } from './CapabilityStore.js';

export class PatternExtractor {
  static async extract(task: { goal: string; taskId: string; capabilities?: string[]; departmentId?: string; result: string }): Promise<CapabilityPattern> {
    const lower = task.goal.toLowerCase();
    const domains: string[] = [];
    if (lower.includes('amazon') || lower.includes('电商')) domains.push('e-commerce');
    if (lower.includes('代码') || lower.includes('开发')) domains.push('development');
    if (lower.includes('设计')) domains.push('design');
    if (domains.length === 0) domains.push('general');

    const steps = task.goal.split(/[。\n；;]/).filter(s => s.trim().length > 5);
    const patternName = `${domains[0]}_${steps[0]?.substring(0, 20) || 'task'}_pattern`;

    const pattern: CapabilityPattern = {
      name: patternName,
      steps: steps.length >= 2 ? steps : [task.goal.substring(0, 100)],
      successRate: task.result === 'success' ? 1.0 : 0.0,
      totalRuns: 1,
      domains,
      extractedFrom: [task.taskId],
    };

    CapabilityStore.save(pattern);
    return pattern;
  }
}
