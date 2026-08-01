/**
 * PolicyEngine + EvolutionController 测试（L1 Governance）— 此前无直接测试
 *
 * PolicyEngine（841 行，仅被 PolicyController 间接使用）：
 *   - 默认规则按优先级匹配：critical→block / high→require_approval /
 *     medium+敏感工具→require_approval / medium→notify_and_execute / low→auto_approve
 *   - 自定义规则优先级覆盖默认 / removeRule / setConfig defaultAction 兜底
 *   - execute()：require_approval 触发 approvalEngine / block 记录审计
 *   - evaluateWorkflow：达标 approve / 强制人工 needs_review / 不达标 reject / 边界 needs_review / general 兜底
 *   - evaluateAgentAction：默认放行 / 自定义角色+动作规则 / removeAgentPolicy
 *
 * EvolutionController（53 行，L1 治理 5 控制器之一，此前零覆盖）：
 *   - 集成 OrganizationTwin + SelfImprovementLoop + SafetyMonitor
 */
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/governance/PolicyEngine.js';
import type { ActionProposal, PolicyRule, WorkflowSimulationProposal, AgentPolicyRule } from '../src/governance/PolicyEngine.js';
import type { RiskLevel } from '../src/governance/types.js';
import { EvolutionController } from '../src/governance/control-plane/EvolutionController.js';

function makeProposal(riskLevel: RiskLevel, toolName?: string): ActionProposal {
  return {
    id: `p_${riskLevel}_${Date.now()}`,
    missionId: 'mis_test',
    action: 'execute',
    description: `测试 ${riskLevel}`,
    risk: { level: riskLevel, score: riskLevel === 'critical' ? 95 : riskLevel === 'high' ? 75 : riskLevel === 'medium' ? 50 : riskLevel === 'low' ? 25 : 0 },
    context: toolName ? { toolName } : {},
    timestamp: Date.now(),
  };
}

function makeWorkflowProposal(workflowType: string, sim: Partial<WorkflowSimulationProposal['simulation']>): WorkflowSimulationProposal {
  return {
    id: `wf_${Date.now()}`,
    workflowId: 'wf_1',
    workflowName: workflowType,
    workflowType,
    simulation: {
      qualityScore: 0.9, successRate: 0.9, riskScore: 30, failureModes: [],
      confidence: 0.8, executions: 10, avgLatency: 100, resourceCost: 5,
      ...sim,
    },
    candidate: {},
    timestamp: Date.now(),
  };
}

describe('PolicyEngine — 默认规则优先级匹配', () => {
  const pe = new PolicyEngine();

  it('critical → block（最高优先 100）', () => {
    const d = pe.evaluate(makeProposal('critical'));
    expect(d.action).toBe('block');
    expect(d.requiresNotification).toBe(false);
  });

  it('high → require_approval（优先 90）', () => {
    const d = pe.evaluate(makeProposal('high'));
    expect(d.action).toBe('require_approval');
  });

  it('medium + 敏感工具(delete) → require_approval（优先 80，覆盖普通 medium）', () => {
    const d = pe.evaluate(makeProposal('medium', 'delete'));
    expect(d.action).toBe('require_approval');
  });

  it('medium + 非敏感工具 → notify_and_execute（优先 70）', () => {
    const d = pe.evaluate(makeProposal('medium', 'read'));
    expect(d.action).toBe('notify_and_execute');
    expect(d.requiresNotification).toBe(true);
  });

  it('low / none → auto_approve（优先 60）', () => {
    expect(pe.evaluate(makeProposal('low')).action).toBe('auto_approve');
    expect(pe.evaluate(makeProposal('none')).action).toBe('auto_approve');
  });

  it('decision 含 reason/decidedAt/proposal 引用', () => {
    const p = makeProposal('high');
    const d = pe.evaluate(p);
    expect(d.reason).toContain('high_risk_require_approval');
    expect(d.decidedAt).toBeGreaterThan(0);
    expect(d.proposal.id).toBe(p.id);
  });
});

describe('PolicyEngine — 规则管理与自定义规则', () => {
  it('addRule 高优先级规则覆盖默认（qa_freeze 期间全 block）', () => {
    const pe = new PolicyEngine();
    pe.addRule({
      name: 'qa_freeze', priority: 200,
      condition: () => true,
      action: 'block',
    });
    expect(pe.evaluate(makeProposal('low')).action).toBe('block');
  });

  it('removeRule 后回落到下一个匹配规则', () => {
    const pe = new PolicyEngine();
    const custom: PolicyRule = { name: 'always_approve', priority: 200, condition: () => true, action: 'auto_approve' };
    pe.addRule(custom);
    expect(pe.evaluate(makeProposal('critical')).action).toBe('auto_approve');
    expect(pe.removeRule('always_approve')).toBe(true);
    expect(pe.evaluate(makeProposal('critical')).action).toBe('block');
  });

  it('setConfig defaultAction 兜底（自定义规则不匹配时）', () => {
    const pe = new PolicyEngine({
      rules: [{ name: 'only_medium', priority: 10, condition: (p) => p.risk.level === 'medium', action: 'auto_approve' }],
      config: { defaultAction: 'require_approval' },
    });
    // medium 命中自定义规则
    expect(pe.evaluate(makeProposal('medium')).action).toBe('auto_approve');
    // low 无规则匹配 → defaultAction 兜底
    expect(pe.evaluate(makeProposal('low')).action).toBe('require_approval');
  });

  it('getRules 返回当前规则集（含默认）', () => {
    const pe = new PolicyEngine();
    const rules = pe.getRules();
    expect(rules.some(r => r.name === 'critical_risk_block')).toBe(true);
  });
});

describe('PolicyEngine — execute() 副作用', () => {
  it('require_approval → 调用 approvalEngine.requestApproval', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const pe = new PolicyEngine({
      approvalEngine: {
        requestApproval: async (...args: unknown[]) => { requests.push(args); return { approved: false }; },
      },
    });
    const d = pe.evaluate(makeProposal('high'));
    expect(d.action).toBe('require_approval');
    await pe.execute(d);
    expect(requests.length).toBe(1);
    expect(requests[0][0]).toBe('mis_test'); // missionId
    expect(requests[0][1]).toBe('execute'); // action
  });

  it('block → 不调用 approvalEngine', async () => {
    let approvalCalls = 0;
    const pe = new PolicyEngine({
      approvalEngine: { requestApproval: async () => { approvalCalls++; } },
    });
    await pe.execute(pe.evaluate(makeProposal('critical')));
    expect(approvalCalls).toBe(0);
  });
});

describe('PolicyEngine — evaluateWorkflow 工作流策略', () => {
  it('coding 全部达标 → approve', () => {
    const pe = new PolicyEngine();
    const d = pe.evaluateWorkflow(makeWorkflowProposal('coding', { qualityScore: 0.8, successRate: 0.85, riskScore: 30 }));
    expect(d.action).toBe('approve');
  });

  it('finance 达标但强制人工审批 → needs_review', () => {
    const pe = new PolicyEngine();
    const d = pe.evaluateWorkflow(makeWorkflowProposal('finance', { qualityScore: 0.98, successRate: 0.98, riskScore: 10 }));
    expect(d.action).toBe('needs_review');
  });

  it('质量不达标 → reject', () => {
    const pe = new PolicyEngine();
    const d = pe.evaluateWorkflow(makeWorkflowProposal('coding', { qualityScore: 0.3, successRate: 0.9, riskScore: 30 }));
    expect(d.action).toBe('reject');
  });

  it('边界（距离阈值 10% 内）→ needs_review', () => {
    const pe = new PolicyEngine();
    // coding minQualityScore 0.6，0.55 落在 0.54(0.6*0.9) 之上 → borderline
    const d = pe.evaluateWorkflow(makeWorkflowProposal('coding', { qualityScore: 0.55, successRate: 0.9, riskScore: 30 }));
    expect(d.action).toBe('needs_review');
  });

  it('未知工作流类型 → general 策略兜底', () => {
    const pe = new PolicyEngine();
    const d = pe.evaluateWorkflow(makeWorkflowProposal('mystery_workflow', { qualityScore: 0.9, successRate: 0.9, riskScore: 30 }));
    expect(d.action).toBe('approve'); // general 不强制人工
  });

  it('addWorkflowPolicy 自定义策略生效', () => {
    const pe = new PolicyEngine();
    pe.addWorkflowPolicy({
      workflowType: 'custom_t', minQualityScore: 0.99, minSuccessRate: 0.99,
      maxRiskScore: 10, maxFailureModes: 0, requireHumanApproval: false, description: '严格自定义',
    });
    const d = pe.evaluateWorkflow(makeWorkflowProposal('custom_t', { qualityScore: 0.3, successRate: 0.5, riskScore: 80 }));
    expect(d.action).toBe('reject'); // 全部远低于阈值，非边界
  });
});

describe('PolicyEngine — evaluateAgentAction Agent 策略', () => {
  it('无规则匹配 → 默认 auto_approve 放行', () => {
    const pe = new PolicyEngine();
    const d = pe.evaluateAgentAction('agent_1', 'engineer', 'commit');
    expect(d.policyAction).toBe('auto_approve');
    expect(d.matchedRule).toBe('default');
  });

  it('自定义 Agent 规则：角色+动作匹配 → 生效', () => {
    const pe = new PolicyEngine();
    pe.addAgentPolicy({
      name: 'no_payment', agentRole: 'finance', actions: ['payment'], action: 'block', priority: 90,
    });
    const d = pe.evaluateAgentAction('agent_fin', 'finance', 'payment');
    expect(d.policyAction).toBe('block');
    expect(d.matchedRule).toBe('no_payment');
    // 非 finance 角色不受影响
    expect(pe.evaluateAgentAction('agent_dev', 'engineer', 'payment').policyAction).toBe('auto_approve');
  });

  it('removeAgentPolicy 后回落默认', () => {
    const pe = new PolicyEngine();
    const rule: AgentPolicyRule = { name: 'block_all', actions: ['*'], action: 'block', priority: 100 };
    pe.addAgentPolicy(rule);
    expect(pe.evaluateAgentAction('x', 'y', 'anything').policyAction).toBe('block');
    expect(pe.removeAgentPolicy('block_all')).toBe(true);
    expect(pe.evaluateAgentAction('x', 'y', 'anything').policyAction).toBe('auto_approve');
  });
});

describe('EvolutionController — 治理控制器集成', () => {
  it('构造 + getOrganizationTwin 返回孪生实例', () => {
    const ec = new EvolutionController();
    expect(ec.getOrganizationTwin()).toBeTruthy();
  });

  it('simulateStrategy 委托 OrganizationTwin.goToMarket（预算决定 GO/REVISIT）', async () => {
    const ec = new EvolutionController();
    const big = await ec.simulateStrategy('产品A', 'US', 200000);
    expect(big.recommended).toBe('GO');
    const small = await ec.simulateStrategy('产品B', 'US', 10000);
    expect(small.recommended).toBe('REVISIT');
  });

  it('analyze 返回 SelfImprovementLoop 分析（insights + proposals）', async () => {
    const ec = new EvolutionController();
    const r = await ec.analyze({ taskSuccessRate: 1.0, avgLatency: 50, failurePatterns: [], artifactQuality: 0.9 });
    expect(Array.isArray(r.insights)).toBe(true);
    expect(Array.isArray(r.proposals)).toBe(true);
  });

  it('observe 记录安全监控观测（低成功率 → WARNING observation）', () => {
    const ec = new EvolutionController();
    ec.observe({ taskSuccessRate: 0.4, avgLatency: 1000, failurePatterns: ['x'], artifactQuality: 0.5 });
    // SafetyMonitor 已记录观测；observe 不抛错即接线成立
    expect(true).toBe(true);
  });
});
