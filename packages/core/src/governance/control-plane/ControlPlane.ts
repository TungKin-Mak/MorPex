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
import { CapabilityRegistry } from '../../governance/capability/CapabilityRegistry.js';

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

    // 2.5 ═══ S22 审计修复：Agent 能力门禁（可选接线，显式传 capability 才检查）═══
    // AgentController 此前构造但 checkAll 从不调用（死组件）；此处接通：
    // 仅当调用方显式声明所需 capability 时，检查其是否可用，默认不改变既有行为。
    // ⚠️ 用 AgentController.findForCapability 判断「活跃 agent 可用性」
    //   （checkCapabilityAvailable 只查能力存在性，对已注册能力恒返回 true，无法用于门禁）。
    const requiredCapability = options?.capability as string | undefined;
    if (requiredCapability && this.agent.findForCapability(requiredCapability).length === 0) {
      return {
        approved: false,
        goal: goalCheck,
        policy: policyCheck,
        details,
        rejection: `能力不可用: ${requiredCapability}`,
      };
    }

    // 2.5.5 ═══ S22: goal→capability 自动推断（可选，默认关闭）═══
    // 开启后：从 goal 文本推断所需能力（匹配能力名/领域词），对可识别能力做 Agent 可用性门禁。
    // 默认关闭——避免对无法识别的通用 goal 误拒，保持既有行为不变。
    const enableInference = options?.enableCapabilityInference as boolean | undefined;
    if (enableInference && !requiredCapability) {
      const inferred = inferGoalCapabilities(goal);
      for (const cap of inferred) {
        if (this.agent.findForCapability(cap).length === 0) {
          return {
            approved: false,
            goal: goalCheck,
            policy: policyCheck,
            details,
            rejection: `能力不可用（自动推断）: ${cap}`,
          };
        }
      }
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

/**
 * inferGoalCapabilities — goal→capability 自动推断（S22）
 *
 * 从 goal 文本推断所需能力：匹配 CapabilityRegistry 中能力的「名称词」或「领域词」
 * （词长≥3，避免过度匹配）。仅返回可识别的能力，识别不到 → 空（放行）。
 */
function inferGoalCapabilities(goal: string): string[] {
  if (!goal) return [];
  const lower = goal.toLowerCase();
  return CapabilityRegistry.getAll()
    .filter((c) => {
      const nameWords = c.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const domainWords = (c.domains ?? []).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      return nameWords.some((w) => lower.includes(w)) || domainWords.some((w) => lower.includes(w));
    })
    .map((c) => c.name);
}
