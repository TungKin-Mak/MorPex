import { GoalIntelligenceFacade } from '../goal-intelligence/GoalIntelligenceFacade.js';
import type { GoalContext } from '../contracts/goal.js';

export class GoalController {
  async process(rawGoal: string): Promise<{ approved: boolean; context?: GoalContext; rejection?: string }> {
    const lower = rawGoal.toLowerCase();
    const blocked = ['非法', '武器', '毒品', '黑客'];
    for (const b of blocked) {
      if (lower.includes(b)) return { approved: false, rejection: `目标包含受限内容: ${b}` };
    }
    const context = await GoalIntelligenceFacade.understandGoal(rawGoal);
    if (context.constraints.budget && context.constraints.budget < 10) {
      return { approved: false, rejection: '预算过低 ($10 最低)' };
    }
    return { approved: true, context };
  }
}
