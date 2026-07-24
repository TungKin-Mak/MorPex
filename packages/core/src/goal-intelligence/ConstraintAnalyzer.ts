/**
 * ConstraintAnalyzer — 约束分析器
 * 从目标文本中提取预算/期限/平台等约束
 */
import type { GoalContext } from '../contracts/goal.js';

export class ConstraintAnalyzer {
  static async analyze(ctx: GoalContext, _userContext?: Record<string, unknown>): Promise<GoalContext> {
    const constraints: GoalContext['constraints'] = { ...ctx.constraints };
    const missing: string[] = [...ctx.missingInformation];
    const lower = ctx.objective.toLowerCase();

    if (lower.includes('amazon')) constraints.platform = 'amazon';
    else if (lower.includes('shopify')) constraints.platform = 'shopify';
    else if (lower.includes('淘宝') || lower.includes('taobao')) constraints.platform = 'taobao';

    const budgetMatch = ctx.objective.match(/预算[约大概]?(\d+)/);
    if (budgetMatch) constraints.budget = parseInt(budgetMatch[1], 10);
    else missing.push('预算信息');

    const deadLineMatch = ctx.objective.match(/(\d+)[天日内]/);
    if (deadLineMatch) {
      constraints.deadline = new Date(Date.now() + parseInt(deadLineMatch[1], 10) * 86400000).toISOString();
    }

    return { ...ctx, constraints, missingInformation: missing };
  }
}
