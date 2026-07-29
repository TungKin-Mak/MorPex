/**
 * ControlPlane — AI System Controller
 *
 * 类似 Kubernetes Controller，系统所有行为经过此层。
 *
 * ═══ v16 重构 ═══
 * - 新增 checkAll() 聚合检查方法
 * - 所有控制器整合真实逻辑（非空壳）
 * - CompanyFacade.executeGoal() 强制经过此层
 */
import { GoalController, type GoalCheckResult } from './GoalController.js';
import { PolicyController, type PolicyCheckResult } from './PolicyController.js';
import { ResourceController, type ResourceAvailability } from './ResourceController.js';
import { AgentController } from './AgentController.js';
import { EvolutionController } from './EvolutionController.js';

export interface ControlPlaneCheckResult {
  approved: boolean;
  goal: GoalCheckResult;
  policy?: PolicyCheckResult;
  resource?: ResourceAvailability;
  rejection?: string;
}

export class ControlPlane {
  readonly goal = new GoalController();
  readonly policy = new PolicyController();
  readonly resource = new ResourceController();
  readonly agent = new AgentController();
  readonly evolution = new EvolutionController();

  /**
   * checkAll — 聚合所有检查
   *
   * 依次执行：目标检查 → 策略检查 → 资源检查
   * 任意一项失败即返回拒绝结果。
   *
   * @param goal - 目标描述
   * @param domain - 领域（可选）
   * @param estimatedCost - 预估成本（可选）
   * @returns 聚合检查结果
   */
  async checkAll(
    goal: string,
    options?: { domain?: string; estimatedCost?: number },
  ): Promise<ControlPlaneCheckResult> {
    // 1. 目标检查（含风险评估）
    const goalCheck = await this.goal.process(goal);
    if (!goalCheck.approved) {
      return {
        approved: false,
        goal: goalCheck,
        rejection: goalCheck.rejection || '目标检查未通过',
      };
    }

    // 2. 策略检查
    const policyCheck = this.policy.checkGoalPolicy(goal, options?.domain);
    if (!policyCheck.allowed) {
      return {
        approved: false,
        goal: goalCheck,
        policy: policyCheck,
        rejection: policyCheck.reason,
      };
    }

    // 3. 资源检查
    const resourceCheck = this.resource.checkAvailability(
      options?.estimatedCost ?? 100,
      1,
    );
    if (!resourceCheck.available) {
      return {
        approved: false,
        goal: goalCheck,
        policy: policyCheck,
        resource: resourceCheck,
        rejection: resourceCheck.reason || '资源检查未通过',
      };
    }

    return {
      approved: true,
      goal: goalCheck,
      policy: policyCheck,
      resource: resourceCheck,
    };
  }
}
