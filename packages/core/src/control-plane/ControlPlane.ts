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
  details?: {
    goal?: GoalCheckResult;
    policy?: PolicyCheckResult;
    resource?: ResourceAvailability;
  };
}

export class ControlPlane {
  readonly goal: GoalController;
  readonly policy: PolicyController;
  readonly resource: ResourceController;
  readonly agent: AgentController;
  readonly evolution: EvolutionController;

  constructor() {
    this.goal = new GoalController();
    this.policy = new PolicyController();
    this.resource = new ResourceController();
    this.agent = new AgentController();
    this.evolution = new EvolutionController();
  }

  /**
   * checkAll — 聚合所有检查
   *
   * 依次执行：目标检查 → 策略检查 → 资源检查
   * 任意一项失败即返回拒绝结果。
   *
   * @param goal - 目标描述
   * @param options - 选项（领域、预估成本等）
   * @returns 聚合检查结果
   */
  async checkAll(
    goal: string,
    options?: { domain?: string; estimatedCost?: number; actor?: string;[key: string]: unknown },
  ): Promise<ControlPlaneCheckResult> {
    const details: ControlPlaneCheckResult['details'] = {};

    // 1. 目标检查（含风险评估）
    const goalCheck = await this.goal.process(goal);
    details.goal = goalCheck;
    if (!goalCheck.approved) {
      return {
        approved: false,
        goal: goalCheck,
        details,
        rejection: goalCheck.rejection || '目标检查未通过',
      };
    }

    // 2. 策略检查
    const policyCheck = await this.policy.evaluate?.({
      action: 'execute_goal',
      goal,
      actor: options?.actor,
    }) ?? this.policy.checkGoalPolicy(goal, options?.domain);
    details.policy = policyCheck;
    if (!policyCheck.allowed) {
      return {
        approved: false,
        goal: goalCheck,
        policy: policyCheck,
        details,
        rejection: policyCheck.reason,
      };
    }

    // 3. 资源检查
    const resourceCheck = await this.resource.check?.({
      goal,
      estimatedCost: options?.estimatedCost ?? 100,
    }) ?? this.resource.checkAvailability(options?.estimatedCost ?? 100, 1);
    details.resource = resourceCheck;
    if (!resourceCheck.available) {
      return {
        approved: false,
        goal: goalCheck,
        policy: policyCheck,
        resource: resourceCheck,
        details,
        rejection: resourceCheck.reason || '资源检查未通过',
      };
    }

    return {
      approved: true,
      goal: goalCheck,
      policy: policyCheck,
      resource: resourceCheck,
      details,
    };
  }
}
