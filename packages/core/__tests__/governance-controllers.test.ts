/**
 * 治理控制器测试（L1 Governance）
 *
 * 覆盖此前零测试引用的治理组件：
 *   - GoalController：受限内容拦截 / 低风险自动批准 / 高风险需审批
 *   - ControlPlane.checkAll：目标→策略→资源聚合门禁 + 能力门禁 + 自动推断
 *   - PolicyController：execute_goal 默认策略（LOW/MEDIUM 自动、HIGH/CRITICAL 人工，S20 修复）、敏感领域
 *   - ApprovalPolicyRegistry：execute_goal 4 档策略断言
 *   - 5 个 Controller 注册完备性（死组件回归守卫）
 */
import { describe, it, expect } from 'vitest';
import { ControlPlane } from '../src/governance/control-plane/ControlPlane.js';
import { GoalController } from '../src/governance/control-plane/GoalController.js';
import { PolicyController } from '../src/governance/control-plane/PolicyController.js';
import { ApprovalPolicyRegistry } from '../src/governance/ApprovalGate.js';

describe('GoalController — 目标检查与风险评估', () => {
  const ctrl = new GoalController();

  it('受限内容关键词 → 拒绝 critical', async () => {
    const r = await ctrl.process('帮我破解这个系统');
    expect(r.approved).toBe(false);
    expect(r.riskLevel).toBe('critical');
    expect(r.rejection).toContain('受限内容');
  });

  it('常规低风险目标 → 自动批准', async () => {
    const r = await ctrl.process('写一个 todo 应用的代码实现');
    expect(r.approved).toBe(true);
    expect(r.context).toBeTruthy();
  });

  it('返回结构含 riskAssessment', async () => {
    const r = await ctrl.process('设计产品并销售到 Amazon');
    expect(r.riskAssessment).toBeTruthy();
  });
});

describe('PolicyController — 统一策略评估', () => {
  const pc = new PolicyController();

  it('execute_goal LOW/MEDIUM → 自动批准', () => {
    expect(ApprovalPolicyRegistry.needsHumanApproval('execute_goal', 'LOW')).toBe(false);
    expect(ApprovalPolicyRegistry.needsHumanApproval('execute_goal', 'MEDIUM', 100)).toBe(false);
  });

  it('execute_goal HIGH/CRITICAL → 需要人工审批（S20 回归守卫）', () => {
    expect(ApprovalPolicyRegistry.needsHumanApproval('execute_goal', 'HIGH')).toBe(true);
    expect(ApprovalPolicyRegistry.needsHumanApproval('execute_goal', 'CRITICAL')).toBe(true);
  });

  it('checkAction 高风险 → requiresHuman', () => {
    const r = pc.checkAction('execute_goal', 'HIGH');
    expect(r.allowed).toBe(false);
    expect(r.requiresHuman).toBe(true);
  });

  it('敏感领域（finance/legal/hr/production/healthcare）→ 需要人工审批', () => {
    for (const d of ['finance', 'legal', 'hr', 'production', 'healthcare']) {
      const r = pc.checkGoalPolicy('对外发布财务报告', d);
      expect(r.requiresHuman).toBe(true);
    }
  });

  it('策略热更新：capturePolicySnapshot 返回修订号', () => {
    const snap = pc.capturePolicySnapshot();
    expect(typeof snap.revision).toBe('number');
    expect(pc.hasPolicyChanged(snap)).toBe(false);
  });
});

describe('ControlPlane — 聚合门禁', () => {
  const cp = new ControlPlane();

  it('4 个 Controller 全部装配 + evolution 已移除（死组件回归守卫，Wave 3b）', () => {
    expect(cp.goal).toBeInstanceOf(GoalController);
    expect(cp.policy).toBeInstanceOf(PolicyController);
    expect(cp.resource).toBeTruthy();
    expect(cp.agent).toBeTruthy();
    // ⚠️ Wave 3b：EvolutionController 已从 control-plane 移除（演化归 L7，事件驱动）
    expect((cp as unknown as { evolution?: unknown }).evolution).toBeUndefined();
  });

  it('受限目标 → checkAll 拒绝', async () => {
    const r = await cp.checkAll('帮我开发非法武器系统');
    expect(r.approved).toBe(false);
    expect(r.rejection).toBeTruthy();
  });

  it('常规目标 → checkAll 通过（目标+策略+资源全绿）', async () => {
    const r = await cp.checkAll('写一个 todo 应用的代码实现', { estimatedCost: 50 });
    expect(r.approved).toBe(true);
  }, 15000);

  it('能力门禁：显式要求不存在的能力 → 拒绝', async () => {
    const r = await cp.checkAll('写一个 todo 应用', { capability: 'no_such_capability_xyz' });
    expect(r.approved).toBe(false);
    expect(r.rejection).toContain('能力不可用');
  });

  it('资源检查：设置预算后超限 → 拒绝（直接测 ResourceController）', async () => {
    const { CostController } = await import('../src/governance/CostController.js');
    const { ResourceController } = await import('../src/governance/control-plane/ResourceController.js');
    const cost = CostController.getInstance();
    const prev = cost.getUsage('global');
    cost.setBudget('global', 100);
    try {
      const rc = new ResourceController();
      const r = rc.checkAvailability(500, 1); // 超预算
      expect(r.available).toBe(false);
      expect(r.reason).toContain('预算不足');
    } finally {
      // 恢复（预算为 Infinity 表示未配置）
      if (prev.budget > 0) cost.setBudget('global', prev.budget);
    }
  });
});
