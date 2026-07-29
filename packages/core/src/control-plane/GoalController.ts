/**
 * GoalController — 目标控制器
 *
 * ═══ v16 重构 ═══
 * - 整合 RiskAnalyzer 风险评估
 * - 返回完整的风险评估 + 审批建议
 */

import { GoalIntelligenceFacade } from '../goal-intelligence/GoalIntelligenceFacade.js';
import { RiskAnalyzer } from '../control/RiskAnalyzer.js';
import type { GoalContext } from '../contracts/goal.js';
import type { RiskLevel, RiskAssessment } from '../control/types.js';

export interface GoalCheckResult {
  approved: boolean;
  context?: GoalContext;
  rejection?: string;
  riskLevel?: RiskLevel;
  riskAssessment?: RiskAssessment;
  requiresApproval?: boolean;
}

export class GoalController {
  private riskAnalyzer = new RiskAnalyzer();

  async process(rawGoal: string): Promise<GoalCheckResult> {
    const lower = rawGoal.toLowerCase();

    // 1. 基础关键词过滤
    const blocked = ['非法', '武器', '毒品', '黑客', '破解', '入侵'];
    for (const b of blocked) {
      if (lower.includes(b)) {
        return {
          approved: false,
          rejection: `目标包含受限内容: ${b}`,
          riskLevel: 'critical',
        };
      }
    }

    // 2. 目标理解
    const context = await GoalIntelligenceFacade.understandGoal(rawGoal);

    // 3. 预算检查
    if (context.constraints.budget && context.constraints.budget < 10) {
      return {
        approved: false,
        rejection: '预算过低 ($10 最低)',
        context,
        riskLevel: 'high',
      };
    }

    // 4. 风险评估（使用 RiskAnalyzer）
    try {
      // 构造简化的 Mission + Plan 供风险分析
      const plan = {
        steps: [{ id: 'step_1', name: rawGoal, domain: context.domain || 'general', deps: [], description: rawGoal, estimatedDuration: 3600000 }],
        riskLevel: context.riskLevel || 'LOW',
        estimatedDuration: 3600000,
        reasoning: context.objective || rawGoal,
      };
      const mission = {
        id: `goal_check_${Date.now()}`,
        goal: rawGoal,
        owner: 'system',
        context: { channel: 'system', sessionId: 'check', originalMessage: rawGoal, metadata: {} },
        state: 0,
        permissions: { allowAutoExecute: true, requireApproval: false, allowedTools: ['*'] },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      };

      const assessment = this.riskAnalyzer.assessMission(
        mission as any,
        plan as any,
      );

      // 高风险 → 需要审批
      const isHighRisk = assessment.level === 'high' || assessment.level === 'critical';
      const isMediumRisk = assessment.level === 'medium';

      if (isHighRisk) {
        return {
          approved: false,
          rejection: `高风险目标需要审批: 风险等级 ${assessment.level}`,
          context,
          riskLevel: assessment.level,
          riskAssessment: assessment,
          requiresApproval: true,
        };
      }

      // 中风险 → 警告但允许
      if (isMediumRisk) {
        return {
          approved: true,
          context,
          riskLevel: assessment.level,
          riskAssessment: assessment,
          requiresApproval: false,
        };
      }

      // 低风险 → 自动批准
      return {
        approved: true,
        context,
        riskLevel: assessment.level,
        riskAssessment: assessment,
        requiresApproval: false,
      };
    } catch {
      // 风险分析失败 → 降级为允许（不阻塞主流程）
      return {
        approved: true,
        context,
        riskLevel: (context.riskLevel as any) || 'LOW',
      };
    }
  }
}
