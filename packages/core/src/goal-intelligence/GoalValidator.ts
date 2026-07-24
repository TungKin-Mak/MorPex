/**
 * GoalValidator — 目标验证器
 * 检查目标上下文的完整性和可行性
 */
import type { GoalContext } from '../contracts/goal.js';

export class GoalValidator {
  static validate(ctx: GoalContext): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    if (!ctx.objective || ctx.objective.length < 5) issues.push('目标描述太短');
    if (ctx.missingInformation.length > 3) issues.push('缺少过多关键信息');
    if (ctx.requiredCapabilities.length === 0) issues.push('无法推断所需能力');
    return { valid: issues.length === 0, issues };
  }
}
