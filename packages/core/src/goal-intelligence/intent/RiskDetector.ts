/**
 * RiskDetector — 风险检测器
 *
 * 从用户请求和目标中检测潜在风险。
 */
import type { StructuredGoal } from './GoalExtractor.js';
import type { Constraints } from './ConstraintAnalyzer.js';

export interface Risk {
  type: 'technical' | 'schedule' | 'security' | 'scope' | 'dependency' | 'ambiguity';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  mitigation: string;
}

export class RiskDetector {
  /** 检测所有风险 */
  detect(goal: StructuredGoal, constraints: Constraints): Risk[] {
    const risks: Risk[] = [];

    // Scope risks
    if (!goal.primary || goal.primary.length < 5) {
      risks.push({
        type: 'ambiguity', severity: 'critical',
        description: 'Primary goal is too vague or empty',
        mitigation: 'Clarify the primary objective before proceeding',
      });
    }

    if (goal.subGoals.length > 5) {
      risks.push({
        type: 'scope', severity: 'major',
        description: `Large scope: ${goal.subGoals.length} sub-goals identified`,
        mitigation: 'Consider breaking into phases or reducing scope',
      });
    }

    // Technical risks
    if (constraints.technical.length === 0) {
      risks.push({
        type: 'technical', severity: 'minor',
        description: 'No technical constraints specified — may lead to technology mismatch',
        mitigation: 'Specify tech stack or preferred technologies',
      });
    }

    // Schedule risks
    if (constraints.time.some(t => /urgent|asap|immediately/.test(t))) {
      risks.push({
        type: 'schedule', severity: 'critical',
        description: 'Urgency detected without clear deadline',
        mitigation: 'Define specific deadline or break into MVP scope',
      });
    }

    // Security risks
    if (!constraints.quality.some(q => /secure|security|auth/.test(q))) {
      risks.push({
        type: 'security', severity: 'minor',
        description: 'No security constraints mentioned',
        mitigation: 'Consider adding security requirements if handling sensitive data',
      });
    }

    // Dependency risks
    if (!goal.acceptanceCriteria.length) {
      risks.push({
        type: 'dependency', severity: 'major',
        description: 'No acceptance criteria defined — unclear what "done" means',
        mitigation: 'Define at least basic acceptance criteria',
      });
    }

    // Type ambiguity
    if (goal.type === 'unknown') {
      risks.push({
        type: 'ambiguity', severity: 'major',
        description: 'Goal type could not be determined',
        mitigation: 'Clarify whether this is build/analyze/learn/create/optimize task',
      });
    }

    return risks;
  }

  /** 是否有严重风险 */
  hasCriticalRisks(risks: Risk[]): boolean {
    return risks.some(r => r.severity === 'critical');
  }

  /** 风险评分 (0 = 无风险, 1 = 高风险) */
  score(risks: Risk[]): number {
    if (risks.length === 0) return 0;
    const weights: Record<string, number> = { critical: 0.5, major: 0.3, minor: 0.1 };
    const total = risks.reduce((sum, r) => sum + (weights[r.severity] || 0), 0);
    return Math.min(1, total);
  }
}
