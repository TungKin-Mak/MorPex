/**
 * PatternExtractor — 模式提取器 (v16)
 * 从完成任务提取模式，写入合并后的 CapabilityRegistry
 */
import { CapabilityRegistry } from '../capability/CapabilityRegistry.js';

export class PatternExtractor {
  static async extract(task: { goal: string; taskId: string; capabilities?: string[]; departmentId?: string; result: string }): Promise<void> {
    const lower = task.goal.toLowerCase();
    const domains: string[] = [];
    if (lower.includes('amazon') || lower.includes('电商')) domains.push('ecommerce');
    if (lower.includes('代码') || lower.includes('开发')) domains.push('software');
    if (lower.includes('设计')) domains.push('design');
    if (domains.length === 0) domains.push('general');

    const steps = task.goal.split(/[。\n；;]/).filter(s => s.trim().length > 5);

    if (task.capabilities) {
      for (const capName of task.capabilities) {
        CapabilityRegistry.updateSuccessRate(capName, task.result === 'success');
        steps.forEach(s => CapabilityRegistry.addStep(capName, s.trim().substring(0, 100)));
        CapabilityRegistry.addExtraction(capName, task.taskId);
      }
    }
  }
}
