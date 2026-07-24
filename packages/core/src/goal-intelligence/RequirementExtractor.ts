/**
 * RequirementExtractor — 从目标中提取能力需求
 */
import type { GoalContext } from '../contracts/goal.js';

export class RequirementExtractor {
  static async extract(ctx: GoalContext): Promise<GoalContext> {
    return { ...ctx, requiredCapabilities: RequirementExtractor.inferCapabilities(ctx.objective) };
  }

  static inferCapabilities(objective: string): string[] {
    const caps: string[] = [];
    const lower = objective.toLowerCase();
    if (lower.includes('设计') || lower.includes('design')) caps.push('design');
    if (lower.includes('开发') || lower.includes('code') || lower.includes('实现')) caps.push('code');
    if (lower.includes('测试') || lower.includes('test')) caps.push('test');
    if (lower.includes('部署') || lower.includes('deploy')) caps.push('deploy');
    if (lower.includes('分析') || lower.includes('research')) caps.push('analyze');
    if (lower.includes('销售') || lower.includes('sell') || lower.includes('发布')) caps.push('publish');
    if (caps.length === 0) caps.push('execute');
    return caps;
  }
}
