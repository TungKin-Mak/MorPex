/**
 * GoalIntelligenceFacade — 目标理解引擎入口
 * v14: 用户一句话目标 → 可执行的 GoalContext
 */
import { GoalParser } from './GoalParser.js';
import { RequirementExtractor } from './RequirementExtractor.js';
import { ConstraintAnalyzer } from './ConstraintAnalyzer.js';
import { GoalValidator } from './GoalValidator.js';
import type { GoalContext } from '../contracts/goal.js';

export class GoalIntelligenceFacade {
  static async understandGoal(rawGoal: string, userContext?: Record<string, unknown>): Promise<GoalContext> {
    let ctx: Partial<GoalContext> = {
      goalId: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    ctx = await GoalParser.parse(rawGoal, ctx);
    ctx = await RequirementExtractor.extract(ctx as GoalContext);
    ctx = await ConstraintAnalyzer.analyze(ctx as GoalContext, userContext);
    const result = GoalValidator.validate(ctx as GoalContext);
    if (!result.valid) {
      (ctx as GoalContext).missingInformation = [...(ctx as GoalContext).missingInformation, ...result.issues];
    }
    return ctx as GoalContext;
  }
}
