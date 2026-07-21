/**
 * PriorityEngine — 优先级引擎
 *
 * 根据目标类型、约束强度、用户 urgency 等因子计算任务优先级。
 */

import type { StructuredGoal } from './GoalExtractor.js';
import type { Constraints } from './ConstraintAnalyzer.js';

export interface PriorityResult {
  /** 1 (最高) - 10 (最低) */
  score: number;
  label: 'critical' | 'high' | 'medium' | 'low' | 'backlog';
  factors: PriorityFactor[];
}

export interface PriorityFactor {
  name: string;
  impact: number; // -2 to +2
  reason: string;
}

export class PriorityEngine {
  /** 计算优先级 */
  calculate(goal: StructuredGoal, constraints: Constraints): PriorityResult {
    const factors: PriorityFactor[] = [];
    let score = 5; // 默认中等

    // 目标类型因子
    const typeFactor = this.goalTypeFactor(goal.type);
    score += typeFactor.impact;
    factors.push(typeFactor);

    // 时间约束因子
    if (constraints.time.length > 0) {
      const urgent = constraints.time.some(t => /urgent|asap|immediately/.test(t));
      if (urgent) {
        score -= 3;
        factors.push({ name: 'urgency', impact: -3, reason: 'Urgency detected in request' });
      } else {
        score += 0;
        factors.push({ name: 'timeline', impact: 0, reason: `Time constraints: ${constraints.time.join(', ')}` });
      }
    }

    // 安全/合规因子
    if (constraints.quality.some(q => /secure|security/.test(q))) {
      score -= 1;
      factors.push({ name: 'security', impact: -1, reason: 'Security requirements increase priority' });
    }
    if (constraints.business.some(b => /compliance|gdpr|hipaa/.test(b))) {
      score -= 2;
      factors.push({ name: 'compliance', impact: -2, reason: 'Compliance requirements critical' });
    }

    // 子目标数量（复杂度）
    if (goal.subGoals.length > 3) {
      score += 1;
      factors.push({ name: 'complexity', impact: 1, reason: `${goal.subGoals.length} sub-goals indicates complexity` });
    }

    // 验收标准数量
    if (goal.acceptanceCriteria.length > 5) {
      score -= 1;
      factors.push({ name: 'scope', impact: -1, reason: 'Well-defined acceptance criteria' });
    }

    score = Math.max(1, Math.min(10, Math.round(score)));

    const label = this.labelForScore(score);

    return { score, label, factors };
  }

  private goalTypeFactor(type: StructuredGoal['type']): PriorityFactor {
    switch (type) {
      case 'build': return { name: 'goal-type', impact: -1, reason: 'Build tasks: high priority' };
      case 'analyze': return { name: 'goal-type', impact: 0, reason: 'Analysis tasks: medium priority' };
      case 'learn': return { name: 'goal-type', impact: 2, reason: 'Learning tasks: lower priority' };
      case 'create': return { name: 'goal-type', impact: 0, reason: 'Creation tasks: medium priority' };
      case 'optimize': return { name: 'goal-type', impact: -1, reason: 'Optimization: high priority' };
      case 'maintain': return { name: 'goal-type', impact: 1, reason: 'Maintenance: standard priority' };
      default: return { name: 'goal-type', impact: 2, reason: 'Unknown type: default low priority' };
    }
  }

  private labelForScore(score: number): PriorityResult['label'] {
    if (score <= 2) return 'critical';
    if (score <= 4) return 'high';
    if (score <= 6) return 'medium';
    if (score <= 8) return 'low';
    return 'backlog';
  }
}
