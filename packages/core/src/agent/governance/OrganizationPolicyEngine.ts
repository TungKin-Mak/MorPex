/**
 * OrganizationPolicyEngine — 组织级策略引擎
 *
 * v9.2: 定义组织层面的策略规则，控制 Agent 协作、资源访问、跨团队操作。
 *
 * 内置规则:
 *   1. block_external_collab — executor 禁止跨团队协作（需审批）
 *   2. senior_override — coordinator 可豁免任何策略
 *   3. artifact_protection — 非 reviewer/coordinator 访问敏感产物需审批
 */

export type OrgPolicyAction = 'allow' | 'deny' | 'require_approval' | 'escalate'

export interface OrgPolicyRule {
  name: string
  description: string
  condition: (context: OrgPolicyContext) => boolean
  action: OrgPolicyAction
  priority: number
  overrideBy?: string[]
}

export interface OrgPolicyContext {
  action: string
  sourceAgentId: string
  sourceAgentRole: string
  targetAgentId?: string
  targetAgentRole?: string
  artifactType?: string
  riskLevel?: string
  teamId?: string
  timestamp: number
}

export interface OrgPolicyDecision {
  rule: OrgPolicyRule
  action: OrgPolicyAction
  reason: string
  timestamp: number
}

function createDefaultRules(): OrgPolicyRule[] {
  return [
    {
      name: 'senior_override',
      description: 'Coordinator 可豁免任何策略限制',
      priority: 100,
      condition: (ctx: OrgPolicyContext) => ctx.sourceAgentRole === 'coordinator',
      action: 'allow',
    },
    {
      name: 'block_external_collab',
      description: 'Executor 禁止跨团队协作，需审批',
      priority: 80,
      condition: (ctx: OrgPolicyContext) =>
        ctx.sourceAgentRole === 'executor' && ctx.action === 'cross_team_collaboration',
      action: 'require_approval',
      overrideBy: ['coordinator', 'reviewer'],
    },
    {
      name: 'artifact_protection',
      description: '非 reviewer/coordinator 访问敏感产物需审批',
      priority: 70,
      condition: (ctx: OrgPolicyContext) =>
        ctx.action === 'access_sensitive_artifact' &&
        ctx.targetAgentRole !== 'reviewer' &&
        ctx.targetAgentRole !== 'coordinator',
      action: 'require_approval',
    },
  ]
}

export class OrganizationPolicyEngine {
  private rules: OrgPolicyRule[]

  constructor(rules?: OrgPolicyRule[]) {
    this.rules = rules ?? createDefaultRules()
    this.sortRules()
  }

  /**
   * evaluate — 评估策略上下文，返回第一个匹配的决策
   *
   * 按优先级降序匹配，返回第一个符合条件的决策。
   * 无匹配时默认 allow。
   */
  evaluate(context: OrgPolicyContext): OrgPolicyDecision {
    for (const rule of this.rules) {
      try {
        if (rule.condition(context)) {
          return {
            rule,
            action: rule.action,
            reason: `规则"${rule.name}"匹配: ${rule.description}`,
            timestamp: Date.now(),
          }
        }
      } catch (err) {
        console.warn(`[OrganizationPolicyEngine] 规则"${rule.name}"评估失败:`, err)
      }
    }

    return {
      rule: { name: 'default', description: '默认允许', condition: () => true, action: 'allow', priority: 0 },
      action: 'allow',
      reason: '无匹配规则，默认允许',
      timestamp: Date.now(),
    }
  }

  /**
   * addRule — 添加策略规则
   */
  addRule(rule: OrgPolicyRule): void {
    this.rules.push(rule)
    this.sortRules()
  }

  /**
   * removeRule — 移除策略规则
   */
  removeRule(name: string): boolean {
    const idx = this.rules.findIndex(r => r.name === name)
    if (idx === -1) return false
    this.rules.splice(idx, 1)
    return true
  }

  /**
   * getRules — 获取所有规则
   */
  getRules(): OrgPolicyRule[] {
    return [...this.rules]
  }

  private sortRules(): void {
    this.rules.sort((a, b) => b.priority - a.priority)
  }
}
