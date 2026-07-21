/**
 * PolicyEngine — 策略引擎
 *
 * Phase 7 / MorPex v8.5: 基于风险等级 + 规则策略的自动化决策引擎。
 *
 * 职责:
 *   1. 根据 ActionProposal 匹配预定义规则
 *   2. 输出 PolicyDecision（auto_approve / notify_and_execute / require_approval / block）
 *   3. 执行决策结果（自动批准、通知、创建审批请求、或阻止）
 *
 * 三级规则:
 *   LOW    → auto_approve  自动执行
 *   MEDIUM → notify_and_execute  通知并执行
 *   HIGH   → require_approval  需要审批
 *   CRITICAL → block  阻止执行
 *
 * 使用方式:
 *   const engine = new PolicyEngine({ approvalEngine, auditTrail });
 *   const decision = engine.evaluate(proposal);
 *   await engine.execute(decision);
 *
 * 设计原则:
 *   - 策略模式: 规则可运行时增删
 *   - 优先级: 高优先级规则先匹配
 *   - 可审计: 所有决策记录到 AuditTrail
 */

import type { RiskAssessment, RiskLevel, AuditEntry } from './types.js';
import { AuditTrail } from './AuditTrail.js';

// ── 策略动作类型 ──

export type PolicyAction = 'auto_approve' | 'notify_and_execute' | 'require_approval' | 'block';

// ── ★ v9.1: Agent Policy Type — Agent 策略规则 ──

/**
 * AgentPolicyRule — Agent 策略规则
 *
 * 定义 Agent 在执行特定操作时的策略约束。
 * 用于 Control Plane 治理 Agent 行为。
 */
export interface AgentPolicyRule {
  /** 规则名称 */
  name: string
  /** 匹配的 Agent 角色（不传则匹配所有） */
  agentRole?: string
  /** 匹配的 Agent ID（不传则匹配所有） */
  agentId?: string
  /** 匹配的操作类型 */
  actions: string[]
  /** 匹配后的策略动作 */
  action: PolicyAction
  /** 优先级（越高越先匹配） */
  priority: number
  /** 规则描述 */
  description?: string
}

/**
 * AgentPolicyDecision — Agent 策略决策结果
 */
export interface AgentPolicyDecision {
  /** Agent ID */
  agentId: string
  /** 操作名称 */
  action: string
  /** 匹配的规则 */
  matchedRule: string
  /** 策略动作 */
  policyAction: PolicyAction
  /** 决策理由 */
  reason: string
  /** 决策时间 */
  decidedAt: number
}

// ── Workflow Type Policy — v8.7: PolicyEngine 接管工作流质量阈值 ──

/**
 * WorkflowTypePolicy — 按工作流类型定义的质量标准
 *
 * 每种工作流类型（coding / finance / deployment / etc.）有自己的质量门槛。
 * PolicyEngine 据此判断 SimulationResult 是否通过，而非硬编码阈值。
 */
export interface WorkflowTypePolicy {
  /** 工作流类型标识 */
  workflowType: string
  /** 该类型最低综合质量分数 (0-1) */
  minQualityScore: number
  /** 最低成功率 (0-1) */
  minSuccessRate: number
  /** 最高可接受风险评分 (0-100) */
  maxRiskScore: number
  /** 最多可接受的 failureModes 数量 */
  maxFailureModes: number
  /** 是否强制要求人工审批 */
  requireHumanApproval: boolean
  /** 人类可读描述 */
  description: string
}

/**
 * WorkflowSimulationProposal — 待评估的工作流仿真提议
 *
 * 由 WorkflowSimulator 生成，由 PolicyEngine.evaluateWorkflow() 消费。
 */
export interface WorkflowSimulationProposal {
  /** 提议 ID */
  id: string
  /** 工作流 ID */
  workflowId: string
  /** 工作流名称 */
  workflowName: string
  /** 工作流类型 */
  workflowType: string
  /** 仿真数据 */
  simulation: {
    qualityScore: number
    successRate: number
    riskScore: number
    failureModes: string[]
    confidence: number
    executions: number
    avgLatency: number
    resourceCost: number
  }
  /** 候选工作流原始数据 */
  candidate: Record<string, unknown>
  /** 提议时间戳 */
  timestamp: number
}

/**
 * WorkflowPolicyDecision — 工作流策略决策结果
 */
export type WorkflowPolicyAction = 'approve' | 'reject' | 'needs_review'

export interface WorkflowPolicyDecision {
  /** 原始提议 */
  proposal: WorkflowSimulationProposal
  /** 决策动作 */
  action: WorkflowPolicyAction
  /** 决策理由 */
  reason: string
  /** 该类型要求的最低质量分数 */
  requiredQualityScore: number
  /** 实际质量分数 */
  actualQualityScore: number
  /** 决策时间 */
  decidedAt: number
}

// ── 默认工作流类型策略 ──

const DEFAULT_WORKFLOW_POLICIES: WorkflowTypePolicy[] = [
  {
    workflowType: 'coding',
    minQualityScore: 0.6,
    minSuccessRate: 0.75,
    maxRiskScore: 60,
    maxFailureModes: 3,
    requireHumanApproval: false,
    description: '代码类工作流 — 中等标准，可自动批准',
  },
  {
    workflowType: 'finance',
    minQualityScore: 0.95,
    minSuccessRate: 0.95,
    maxRiskScore: 30,
    maxFailureModes: 0,
    requireHumanApproval: true,
    description: '金融类工作流 — 严格标准，强制人工审批',
  },
  {
    workflowType: 'deployment',
    minQualityScore: 0.85,
    minSuccessRate: 0.90,
    maxRiskScore: 40,
    maxFailureModes: 1,
    requireHumanApproval: true,
    description: '部署类工作流 — 高标准，强制人工审批',
  },
  {
    workflowType: 'writing',
    minQualityScore: 0.5,
    minSuccessRate: 0.70,
    maxRiskScore: 70,
    maxFailureModes: 5,
    requireHumanApproval: false,
    description: '写作类工作流 — 宽松标准，可自动批准',
  },
  {
    workflowType: 'research',
    minQualityScore: 0.55,
    minSuccessRate: 0.70,
    maxRiskScore: 65,
    maxFailureModes: 4,
    requireHumanApproval: false,
    description: '研究类工作流 — 较宽松标准，可自动批准',
  },
  {
    workflowType: 'general',
    minQualityScore: 0.65,
    minSuccessRate: 0.80,
    maxRiskScore: 50,
    maxFailureModes: 2,
    requireHumanApproval: false,
    description: '通用工作流 — 默认中等标准',
  },
]

// ── ActionProposal — 待评估的操作提议 ──

export interface ActionProposal {
  /** 提议 ID */
  id: string;
  /** 关联 Mission ID */
  missionId: string;
  /** 操作名称 */
  action: string;
  /** 操作描述 */
  description: string;
  /** 风险评估结果 */
  risk: RiskAssessment;
  /** 上下文信息 */
  context: Record<string, unknown>;
  /** 提议时间 */
  timestamp: number;
}

// ── PolicyDecision — 策略决策结果 ──

export interface PolicyDecision {
  /** 原始提议 */
  proposal: ActionProposal;
  /** 决策动作 */
  action: PolicyAction;
  /** 决策理由 */
  reason: string;
  /** 是否需要通知用户 */
  requiresNotification: boolean;
  /** 审批人列表（仅 require_approval） */
  approvers?: string[];
  /** 审批截止时间 */
  deadline?: number;
  /** 决策时间 */
  decidedAt: number;
}

// ── PolicyRule — 策略规则 ──

export interface PolicyRule {
  /** 规则名称 */
  name: string;
  /** 匹配条件 */
  condition: (proposal: ActionProposal) => boolean;
  /** 匹配后的动作 */
  action: PolicyAction;
  /** 优先级（越高越先匹配） */
  priority: number;
}

// ── PolicyEngineConfig — 策略引擎配置 ──

export interface PolicyEngineConfig {
  /** 默认动作（无规则匹配时的兜底） */
  defaultAction: PolicyAction;
  /** 低于此等级自动通过 */
  autoApproveBelow: RiskLevel;
  /** 高于此等级阻止执行 */
  blockAbove: RiskLevel;
  /** 触发通知的最低等级 */
  notifyOn: RiskLevel;
  /** 审批超时时间 (ms) */
  approvalTimeoutMs: number;
}

const DEFAULT_CONFIG: PolicyEngineConfig = {
  defaultAction: 'require_approval',
  autoApproveBelow: 'low',
  blockAbove: 'critical',
  notifyOn: 'medium',
  approvalTimeoutMs: 5 * 60 * 1000,
};

// ── 敏感工具列表 ──

const SENSITIVE_TOOLS = ['delete', 'deploy', 'email', 'payment', 'write_file', 'execute_shell', 'terminate'];



// ── 默认规则（按优先级排序） ──

function createDefaultRules(): PolicyRule[] {
  return [
    {
      name: 'critical_risk_block',
      priority: 100,
      condition: (p: ActionProposal) => p.risk.level === 'critical',
      action: 'block',
    },
    {
      name: 'high_risk_require_approval',
      priority: 90,
      condition: (p: ActionProposal) => p.risk.level === 'high',
      action: 'require_approval',
    },
    {
      name: 'medium_risk_sensitive_tool',
      priority: 80,
      condition: (p: ActionProposal) => {
        if (p.risk.level !== 'medium') return false;
        const toolName = (p.context.toolName as string) || '';
        return SENSITIVE_TOOLS.includes(toolName.toLowerCase());
      },
      action: 'require_approval',
    },
    {
      name: 'medium_risk_notify',
      priority: 70,
      condition: (p: ActionProposal) => p.risk.level === 'medium',
      action: 'notify_and_execute',
    },
    {
      name: 'low_risk_auto',
      priority: 60,
      condition: (p: ActionProposal) => p.risk.level === 'low' || p.risk.level === 'none',
      action: 'auto_approve',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// PolicyEngine
// ═══════════════════════════════════════════════════════════════

export class PolicyEngine {
  private rules: PolicyRule[];
  private approvalEngine: { requestApproval: Function } | null;
  private auditTrail: AuditTrail;
  private config: PolicyEngineConfig;
  private idCounter = 0;

  // ★ v8.7: 工作流类型策略
  private workflowPolicies: Map<string, WorkflowTypePolicy>

  // ★ v9.1: Agent 策略规则
  private agentPolicies: AgentPolicyRule[]

  constructor(deps?: {
    approvalEngine?: { requestApproval: Function };
    auditTrail?: AuditTrail;
    rules?: PolicyRule[];
    config?: Partial<PolicyEngineConfig>;
    workflowPolicies?: WorkflowTypePolicy[]
  }) {
    this.rules = deps?.rules ?? createDefaultRules();
    this.rules.sort((a, b) => b.priority - a.priority);
    this.approvalEngine = deps?.approvalEngine ?? null;
    this.auditTrail = deps?.auditTrail ?? new AuditTrail();
    this.config = { ...DEFAULT_CONFIG, ...(deps?.config ?? {}) };
    // ★ v8.7: 初始化工作流策略
    this.workflowPolicies = new Map()
    const initialPolicies = deps?.workflowPolicies ?? DEFAULT_WORKFLOW_POLICIES
    for (const p of initialPolicies) {
      this.workflowPolicies.set(p.workflowType, p)
    }

    // ★ v9.1: 初始化 Agent 策略
    this.agentPolicies = []
  }

  /**
   * evaluate — 评估 ActionProposal 并返回策略决策
   *
   * 按优先级依次匹配规则，返回第一个匹配的决策。
   * 无规则匹配时使用 config.defaultAction 兜底。
   *
   * @param proposal - 待评估的操作提议
   * @returns PolicyDecision
   */
  evaluate(proposal: ActionProposal): PolicyDecision {
    // 按优先级依次匹配
    for (const rule of this.rules) {
      try {
        if (rule.condition(proposal)) {
          const action = rule.action;
          const reason = `规则"${rule.name}"匹配: ${this.actionDescription(action)}`;
          const decision = this.buildDecision(proposal, action, reason);
          this.recordAudit(proposal, decision);
          return decision;
        }
      } catch (err) {
        console.warn(`[PolicyEngine] 规则"${rule.name}"评估失败:`, err);
      }
    }

    // 无规则匹配，使用默认动作
    const fallbackReason = `无规则匹配, 使用默认策略: ${this.actionDescription(this.config.defaultAction)}`;
    const fallbackDecision = this.buildDecision(proposal, this.config.defaultAction, fallbackReason);
    this.recordAudit(proposal, fallbackDecision);
    return fallbackDecision;
  }

  /**
   * execute — 执行策略决策
   *
   * 根据 decision.action 执行:
   *   - auto_approve: 不操作（已批准）
   *   - notify_and_execute: 记录通知事件
   *   - require_approval: 创建审批请求
   *   - block: 记录阻止事件
   *
   * @param decision - 策略决策
   */
  async execute(decision: PolicyDecision): Promise<void> {
    const { proposal, action } = decision;

    switch (action) {
      case 'auto_approve':
        // 自动批准 — 记录审计即可
        this.auditTrail.record({
          missionId: proposal.missionId,
          type: 'approval_granted',
          timestamp: Date.now(),
          actor: 'policy-engine',
          details: { action: proposal.action, reason: decision.reason, autoApproved: true },
        });
        break;

      case 'notify_and_execute':
        // 记录通知事件，然后执行
        this.auditTrail.record({
          missionId: proposal.missionId,
          type: 'approval_granted',
          timestamp: Date.now(),
          actor: 'policy-engine',
          details: { action: proposal.action, reason: decision.reason, requiresNotification: true },
        });
        break;

      case 'require_approval':
        if (this.approvalEngine) {
          try {
            await this.approvalEngine.requestApproval(
              proposal.missionId,
              proposal.action,
              proposal.description,
              proposal.risk.level === 'high' ? 'high' : proposal.risk.level === 'critical' ? 'high' : 'medium',
              { riskScore: proposal.risk.score, ...proposal.context }
            );
          } catch (err) {
            console.error('[PolicyEngine] 创建审批请求失败:', err);
          }
        }
        break;

      case 'block':
        this.auditTrail.record({
          missionId: proposal.missionId,
          type: 'execution_failed',
          timestamp: Date.now(),
          actor: 'policy-engine',
          details: { action: proposal.action, reason: decision.reason, blocked: true },
        });
        break;
    }
  }

  // ── 规则管理 ──

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  removeRule(ruleName: string): boolean {
    const index = this.rules.findIndex(r => r.name === ruleName);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    return true;
  }

  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  setConfig(config: Partial<PolicyEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ── 内部方法 ──

  private buildDecision(proposal: ActionProposal, action: PolicyAction, reason: string): PolicyDecision {
    const now = Date.now();
    return {
      proposal,
      action,
      reason,
      requiresNotification: action === 'notify_and_execute',
      approvers: action === 'require_approval' ? ['user'] : undefined,
      deadline: action === 'require_approval' ? now + this.config.approvalTimeoutMs : undefined,
      decidedAt: now,
    };
  }

  private recordAudit(proposal: ActionProposal, decision: PolicyDecision): void {
    this.auditTrail.record({
      missionId: proposal.missionId,
      type: 'risk_assessment',
      timestamp: Date.now(),
      actor: 'policy-engine',
      details: {
        riskLevel: proposal.risk.level,
        riskScore: proposal.risk.score,
        policyAction: decision.action,
        reason: decision.reason,
        ruleCount: this.rules.length,
      },
    });
  }

  private actionDescription(action: PolicyAction): string {
    switch (action) {
      case 'auto_approve': return '自动批准';
      case 'notify_and_execute': return '通知并执行';
      case 'require_approval': return '需要审批';
      case 'block': return '阻止执行';
    }
  }

  getConfig(): PolicyEngineConfig {
    return { ...this.config };
  }

  // ═══════════════════════════════════════════════════════════════
  // ★ v8.7: Workflow 质量评估
  // ═══════════════════════════════════════════════════════════════

  /**
   * evaluateWorkflow — 评估工作流仿真结果并返回策略决策
   *
   * 根据工作流类型匹配对应的 WorkflowTypePolicy，逐项检查：
   *   1. qualityScore >= minQualityScore
   *   2. successRate >= minSuccessRate
   *   3. riskScore <= maxRiskScore
   *   4. failureModes.length <= maxFailureModes
   *
   * 边界检测：如果某个指标在阈值 10% 范围内，标记为 needs_review
   *
   * @param proposal - 工作流仿真提议
   * @returns WorkflowPolicyDecision
   */
  evaluateWorkflow(proposal: WorkflowSimulationProposal): WorkflowPolicyDecision {
    const policy = this.workflowPolicies.get(proposal.workflowType)
      ?? this.workflowPolicies.get('general')!

    const qs = proposal.simulation.qualityScore
    const sr = proposal.simulation.successRate
    const rs = proposal.simulation.riskScore
    const fm = proposal.simulation.failureModes.length

    // 逐项检查 + 检测边界（距离阈值 10% 以内视为 needs_review）
    const checks: { name: string; pass: boolean; borderline: boolean; actual: number; required: number }[] = []

    // qualityScore check
    const qsPass = qs >= policy.minQualityScore
    const qsBorderline = !qsPass && qs >= policy.minQualityScore * 0.9
    checks.push({ name: 'qualityScore', pass: qsPass, borderline: qsBorderline, actual: qs, required: policy.minQualityScore })

    // successRate check
    const srPass = sr >= policy.minSuccessRate
    const srBorderline = !srPass && sr >= policy.minSuccessRate * 0.9
    checks.push({ name: 'successRate', pass: srPass, borderline: srBorderline, actual: sr, required: policy.minSuccessRate })

    // riskScore check (lower is better)
    const rsPass = rs <= policy.maxRiskScore
    const rsBorderline = !rsPass && rs <= policy.maxRiskScore * 1.1
    checks.push({ name: 'riskScore', pass: rsPass, borderline: rsBorderline, actual: rs, required: policy.maxRiskScore })

    // failureModes check
    const fmPass = fm <= policy.maxFailureModes
    const fmBorderline = !fmPass && fm <= Math.max(1, policy.maxFailureModes * 2)
    checks.push({ name: 'failureModes', pass: fmPass, borderline: fmBorderline, actual: fm, required: policy.maxFailureModes })

    const allPass = checks.every(c => c.pass)
    const anyBorderline = checks.some(c => c.borderline)

    let action: WorkflowPolicyAction
    let reason: string

    if (allPass && !policy.requireHumanApproval) {
      action = 'approve'
      reason = `所有指标达标，策略自动批准`
    } else if (allPass && policy.requireHumanApproval) {
      action = 'needs_review'
      reason = `指标达标但工作流类型 "${proposal.workflowType}" 要求人工审批`
    } else if (anyBorderline) {
      action = 'needs_review'
      const failed = checks.filter(c => !c.pass).map(c => `${c.name}(${c.actual.toFixed(2)}/${c.required.toFixed(2)})`).join(', ')
      reason = `指标接近阈值边界，需人工审查: ${failed}`
    } else {
      action = 'reject'
      const failed = checks.filter(c => !c.pass).map(c => `${c.name}(${c.actual.toFixed(2)}/${c.required.toFixed(2)})`).join(', ')
      reason = `指标未达标: ${failed}`
    }

    const decision: WorkflowPolicyDecision = {
      proposal,
      action,
      reason,
      requiredQualityScore: policy.minQualityScore,
      actualQualityScore: proposal.simulation.qualityScore,
      decidedAt: Date.now(),
    }

    // 记录审计
    this.auditTrail.record({
      missionId: proposal.workflowId,
      type: 'risk_assessment',
      timestamp: Date.now(),
      actor: 'policy-engine',
      details: {
        workflowType: proposal.workflowType,
        workflowName: proposal.workflowName,
        action,
        reason,
        qualityScore: proposal.simulation.qualityScore,
        successRate: proposal.simulation.successRate,
        riskScore: proposal.simulation.riskScore,
        failureModes: proposal.simulation.failureModes,
        policy: {
          minQualityScore: policy.minQualityScore,
          minSuccessRate: policy.minSuccessRate,
          maxRiskScore: policy.maxRiskScore,
          maxFailureModes: policy.maxFailureModes,
          requireHumanApproval: policy.requireHumanApproval,
        },
        checks: checks.map(c => ({ name: c.name, pass: c.pass, borderline: c.borderline, actual: c.actual, required: c.required })),
      },
    })

    return decision
  }

  /**
   * executeWorkflowDecision — 执行工作流策略决策
   *
   * @param decision - 工作流策略决策
   */
  async executeWorkflowDecision(decision: WorkflowPolicyDecision): Promise<void> {
    const { action, proposal } = decision

    switch (action) {
      case 'approve':
        this.auditTrail.record({
          missionId: proposal.workflowId,
          type: 'approval_granted',
          timestamp: Date.now(),
          actor: 'policy-engine',
          details: {
            workflowName: proposal.workflowName,
            workflowType: proposal.workflowType,
            action: 'auto_approve',
            reason: decision.reason,
            qualityScore: proposal.simulation.qualityScore,
          },
        })
        break

      case 'needs_review':
        if (this.approvalEngine) {
          try {
            await this.approvalEngine.requestApproval(
              proposal.workflowId,
              'register_workflow',
              `注册工作流 "${proposal.workflowName}" (${proposal.workflowType}) — 质量评分 ${proposal.simulation.qualityScore}`,
              proposal.simulation.riskScore > 50 ? 'high' : 'medium',
              {
                workflowName: proposal.workflowName,
                workflowType: proposal.workflowType,
                qualityScore: proposal.simulation.qualityScore,
                successRate: proposal.simulation.successRate,
                riskScore: proposal.simulation.riskScore,
                failureModes: proposal.simulation.failureModes,
              }
            )
          } catch (err) {
            console.error('[PolicyEngine] 创建工作流审批请求失败:', err)
          }
        }
        break

      case 'reject':
        this.auditTrail.record({
          missionId: proposal.workflowId,
          type: 'execution_failed',
          timestamp: Date.now(),
          actor: 'policy-engine',
          details: {
            workflowName: proposal.workflowName,
            workflowType: proposal.workflowType,
            action: 'block',
            reason: decision.reason,
            qualityScore: proposal.simulation.qualityScore,
          },
        })
        break
    }
  }

  // ── Workflow Policy 管理 ──

  /**
   * addWorkflowPolicy — 添加或覆盖工作流类型策略
   *
   * @param policy - 工作流类型策略
   */
  addWorkflowPolicy(policy: WorkflowTypePolicy): void {
    this.workflowPolicies.set(policy.workflowType, policy)
  }

  /**
   * removeWorkflowPolicy — 移除工作流类型策略
   *
   * @param workflowType - 工作流类型
   * @returns 是否存在并移除
   */
  removeWorkflowPolicy(workflowType: string): boolean {
    return this.workflowPolicies.delete(workflowType)
  }

  /**
   * getWorkflowPolicies — 获取所有工作流类型策略
   */
  getWorkflowPolicies(): WorkflowTypePolicy[] {
    return [...this.workflowPolicies.values()]
  }

  /**
   * getWorkflowPolicy — 获取指定类型的工作流策略
   *
   * @param workflowType - 工作流类型
   */
  getWorkflowPolicy(workflowType: string): WorkflowTypePolicy | undefined {
    return this.workflowPolicies.get(workflowType)
  }

  // ═══════════════════════════════════════════════════════════════
  // ★ v9.1: Agent Policy 管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * addAgentPolicy — 添加 Agent 策略规则
   *
   * 按优先级排序存储。
   */
  addAgentPolicy(rule: AgentPolicyRule): void {
    this.agentPolicies.push(rule)
    this.agentPolicies.sort((a, b) => b.priority - a.priority)
  }

  /**
   * removeAgentPolicy — 移除 Agent 策略规则
   *
   * @returns 是否存在并移除
   */
  removeAgentPolicy(name: string): boolean {
    const index = this.agentPolicies.findIndex(r => r.name === name)
    if (index === -1) return false
    this.agentPolicies.splice(index, 1)
    return true
  }

  /**
   * getAgentPolicies — 获取所有 Agent 策略规则
   */
  getAgentPolicies(): AgentPolicyRule[] {
    return [...this.agentPolicies]
  }

  /**
   * evaluateAgentAction — 评估 Agent 操作
   *
   * 按优先级依次匹配 Agent 策略规则，返回第一个匹配的决策。
   *
   * @param agentId - Agent ID
   * @param agentRole - Agent 角色
   * @param action - 操作名称
   * @returns Agent 策略决策
   */
  evaluateAgentAction(agentId: string, agentRole: string, action: string): AgentPolicyDecision {
    for (const rule of this.agentPolicies) {
      // 检查角色匹配
      if (rule.agentRole && rule.agentRole !== agentRole) continue
      // 检查 ID 匹配
      if (rule.agentId && rule.agentId !== agentId) continue
      // 检查操作匹配
      if (!rule.actions.includes(action) && !rule.actions.includes('*')) continue

      const decision: AgentPolicyDecision = {
        agentId,
        action,
        matchedRule: rule.name,
        policyAction: rule.action,
        reason: `Agent policy rule "${rule.name}" matched for ${action}`,
        decidedAt: Date.now(),
      }

      // 记录审计
      this.auditTrail.record({
        missionId: agentId,
        type: 'risk_assessment',
        timestamp: Date.now(),
        actor: 'policy-engine',
        details: {
          agentId,
          agentRole,
          action,
          matchedRule: rule.name,
          policyAction: rule.action,
        },
      })

      return decision
    }

    // 无匹配规则，默认为 auto_approve
    return {
      agentId,
      action,
      matchedRule: 'default',
      policyAction: 'auto_approve',
      reason: 'No agent policy matched, default allow',
      decidedAt: Date.now(),
    }
  }
}
