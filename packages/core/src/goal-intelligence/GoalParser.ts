/**
 * GoalParser — 目标解析器
 * 将用户原始语句解析为目标+领域+子目标
 */
import type { GoalContext, GoalParseResult } from '../contracts/goal.js';

export class GoalParser {
  static async parse(rawGoal: string, partialCtx: Partial<GoalContext>): Promise<GoalContext> {
    const result = GoalParser.ruleBasedParse(rawGoal);
    return {
      ...partialCtx,
      objective: result.objective,
      domain: result.domain,
      requiredCapabilities: [],
      missingInformation: [],
      riskLevel: 'LOW',
      constraints: {},
    } as GoalContext;
  }

  static ruleBasedParse(raw: string): GoalParseResult {
    const lower = raw.toLowerCase();
    const subGoals: string[] = raw.split(/[。\n；;]/).filter(s => s.trim().length > 5);
    let domain = 'general';
    if (lower.includes('amazon') || lower.includes('电商') || lower.includes('销售')) domain = 'e-commerce';
    else if (lower.includes('代码') || lower.includes('开发') || lower.includes('编程')) domain = 'development';
    else if (lower.includes('设计') || lower.includes('硬件') || lower.includes('产品')) domain = 'product-design';
    return {
      objective: raw.substring(0, 200),
      domain,
      subGoals: subGoals.length >= 2 ? subGoals : [raw],
      confidence: 0.8,
    };
  }
}
