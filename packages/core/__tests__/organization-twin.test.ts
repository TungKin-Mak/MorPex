/**
 * 组织孪生测试（OrganizationTwin, cognition/twin）— 此前零测试引用
 *
 * 覆盖：
 *   - 默认 4 角色装配（CEO/CTO/CMO/CFO 的部门/偏好）
 *   - 角色查询与自定义角色添加
 *   - simulateDecision：按风险等级推导审批链 + 批准/否决决策
 *   - simulateGoToMarket：按预算推导 GO/REVISIT + 置信度 + 角色投票
 *   - 模拟历史记录
 */
import { describe, it, expect } from 'vitest';
import { OrganizationTwin } from '../src/cognition/twin/OrganizationTwin.js';
import { BehaviorTwin } from '../src/cognition/twin/BehaviorTwin.js';
import { PreferenceModel } from '../src/cognition/twin/PreferenceModel.js';
import { DecisionTwin } from '../src/cognition/decision/DecisionTwin.js';

// ═══════════════════════════════════════════════
// 默认角色装配
// ═══════════════════════════════════════════════
describe('OrganizationTwin — 默认角色装配', () => {
  const twin = new OrganizationTwin();

  it('构造后 4 个默认角色存在', () => {
    for (const title of ['CEO', 'CTO', 'CMO', 'CFO'] as const) {
      expect(twin.getRoleByTitle(title)).toBeTruthy();
    }
  });

  it('角色部门正确', () => {
    expect(twin.getRoleByTitle('CEO')!.department).toBe('executive');
    expect(twin.getRoleByTitle('CTO')!.department).toBe('engineering');
    expect(twin.getRoleByTitle('CMO')!.department).toBe('marketing');
    expect(twin.getRoleByTitle('CFO')!.department).toBe('finance');
  });

  it('风险偏好配置正确（CEO 0.6 / CFO 0.3）', () => {
    expect(twin.getRoleByTitle('CEO')!.preferences.riskTolerance).toBe(0.6);
    expect(twin.getRoleByTitle('CTO')!.preferences.riskTolerance).toBe(0.4);
    expect(twin.getRoleByTitle('CMO')!.preferences.riskTolerance).toBe(0.5);
    expect(twin.getRoleByTitle('CFO')!.preferences.riskTolerance).toBe(0.3);
  });

  it('roleId 形如 role_{TITLE} 且 getRole 可查询', () => {
    const ceo = twin.getRoleByTitle('CEO')!;
    expect(ceo.roleId).toBe('role_CEO');
    expect(twin.getRole('role_CEO')).toBe(ceo);
  });

  it('每个角色 twin 三件套已装配', () => {
    const ceo = twin.getRoleByTitle('CEO')!;
    expect(ceo.twin.behavior).toBeInstanceOf(BehaviorTwin);
    expect(ceo.twin.preferences).toBeInstanceOf(PreferenceModel);
    expect(ceo.twin.decisions).toBeInstanceOf(DecisionTwin);
  });
});

// ═══════════════════════════════════════════════
// 角色查询与自定义
// ═══════════════════════════════════════════════
describe('OrganizationTwin — 角色查询与自定义', () => {
  it('未定义角色 → getRoleByTitle undefined', () => {
    const twin = new OrganizationTwin();
    expect(twin.getRoleByTitle('COO')).toBeUndefined();
    expect(twin.getRole('role_nonexist')).toBeUndefined();
  });

  it('addRole 自定义角色后可查询', () => {
    const twin = new OrganizationTwin();
    twin.addRole({
      roleId: 'role_Lead_qa',
      title: 'Lead',
      department: 'qa',
      preferences: { riskTolerance: 0.9, innovationPreference: 0.2 },
      twin: {
        behavior: new BehaviorTwin(),
        decisions: new DecisionTwin(null as never),
        preferences: new PreferenceModel(),
      },
    });
    const r = twin.getRole('role_Lead_qa');
    expect(r).toBeTruthy();
    expect(r!.title).toBe('Lead');
    expect(r!.department).toBe('qa');
    expect(r!.preferences.riskTolerance).toBe(0.9);
  });
});

// ═══════════════════════════════════════════════
// simulateDecision — 审批链与决策
// ═══════════════════════════════════════════════
describe('OrganizationTwin — simulateDecision 审批逻辑', () => {
  it('LOW 风险 → 无审批人 → 直接 APPROVED', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('日常排期调整', '调整本周排期', 'CEO', 'LOW');
    expect(d.requiredApprovals).toHaveLength(0);
    expect(d.status).toBe('APPROVED');
    expect(d.riskLevel).toBe('LOW');
  });

  it('MEDIUM 风险（CEO 提案）→ 审批链 = CEO + CMO → APPROVED', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('市场活动', '投放营销活动', 'CEO', 'MEDIUM');
    expect(d.requiredApprovals).toContain('role_CEO');
    expect(d.requiredApprovals).toContain('role_CMO');
    expect(d.requiredApprovals).toHaveLength(2);
    expect(d.approvedBy).toHaveLength(2);
    expect(d.status).toBe('APPROVED');
  });

  it('MEDIUM 风险（CTO 提案）→ 审批链 = CEO + CTO（无 CMO）', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('技术选型', '选择新框架', 'CTO', 'MEDIUM');
    expect(d.requiredApprovals).toContain('role_CEO');
    expect(d.requiredApprovals).toContain('role_CTO');
    expect(d.requiredApprovals).not.toContain('role_CMO');
    expect(d.requiredApprovals).toHaveLength(2);
  });

  it('HIGH 风险 → 审批链 3 人（排除 CMO）→ 保守角色否决 → REJECTED', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('扩张计划', '进入新市场', 'CEO', 'HIGH');
    expect(d.requiredApprovals).toHaveLength(3);
    expect(d.requiredApprovals).not.toContain('role_CMO');
    // CEO(0.6+0.2=0.8≥0.8 批) / CTO(0.4+0.2=0.6<0.8 拒) / CFO(0.3+0.2=0.5<0.8 拒)
    expect(d.status).toBe('REJECTED');
    expect(d.simulatedOutcome).toContain('否决');
  });

  it('CRITICAL 风险 → 审批链全员 4 人 → 全部门否决 → REJECTED', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('公司方向', '战略转型', 'CEO', 'CRITICAL');
    expect(d.requiredApprovals).toHaveLength(4);
    // riskValue 0.95 > 所有角色 riskTolerance+0.2（最高 CEO 0.8）
    expect(d.status).toBe('REJECTED');
  });

  it('每个决策记录 decisionId + createdAt + proposedBy', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('测试决策', '描述', 'CFO', 'MEDIUM');
    expect(d.decisionId).toMatch(/^dec_/);
    expect(typeof d.createdAt).toBe('number');
    expect(d.proposedBy).toBe('role_CFO');
  });

  it('未知提案角色 → proposedBy 降级 unknown，不崩溃', () => {
    const twin = new OrganizationTwin();
    const d = twin.simulateDecision('外部提案', '外部人提出', 'Guest', 'LOW');
    expect(d.proposedBy).toBe('unknown');
    expect(d.status).toBe('APPROVED');
  });

  it('每次 simulateDecision 追加一条模拟历史', () => {
    const twin = new OrganizationTwin();
    expect(twin.getSimulationHistory()).toHaveLength(0);
    twin.simulateDecision('决策A', 'a', 'CEO', 'LOW');
    twin.simulateDecision('决策B', 'b', 'CEO', 'HIGH');
    const history = twin.getSimulationHistory();
    expect(history).toHaveLength(2);
    expect(history[0].scenario).toBe('决策A');
    expect(history[1].scenario).toBe('决策B');
    expect(history[1].outcome).toContain('REJECTED');
  });
});

// ═══════════════════════════════════════════════
// simulateGoToMarket — 预算驱动决策
// ═══════════════════════════════════════════════
describe('OrganizationTwin — simulateGoToMarket', () => {
  it('高预算（200k）→ 4 票 GO → confidence 1.0 → GO', () => {
    const twin = new OrganizationTwin();
    const r = twin.simulateGoToMarket('新产品', '北美市场', 200000);
    expect(r.confidence).toBe(1);
    expect(r.recommended).toBe('GO');
    expect(r.roleVotes).toHaveLength(4);
    expect(r.roleVotes.every(v => v.vote === 'GO')).toBe(true);
  });

  it('中预算（80k）→ 3/4 GO → confidence 0.75 → GO', () => {
    const twin = new OrganizationTwin();
    const r = twin.simulateGoToMarket('新产品', '北美市场', 80000);
    // CEO(>50k GO) + CTO(GO) + CMO(GO) + CFO(≤100k REVISIT)
    expect(r.confidence).toBe(0.75);
    expect(r.recommended).toBe('GO');
    const cfo = r.roleVotes.find(v => v.role === 'CFO')!;
    expect(cfo.vote).toBe('REVISIT');
  });

  it('低预算（10k）→ 2/4 GO → confidence 0.5 → REVISIT', () => {
    const twin = new OrganizationTwin();
    const r = twin.simulateGoToMarket('新产品', '本地市场', 10000);
    expect(r.confidence).toBe(0.5);
    expect(r.recommended).toBe('REVISIT');
    const ceo = r.roleVotes.find(v => v.role === 'CEO')!;
    expect(ceo.vote).toBe('REVISIT');
  });

  it('预算边界：恰好 50000 → CEO REVISIT；恰好 100000 → CFO REVISIT', () => {
    const twin = new OrganizationTwin();
    const r = twin.simulateGoToMarket('新品', '市场', 50000);
    const ceo = r.roleVotes.find(v => v.role === 'CEO')!;
    const cfo = r.roleVotes.find(v => v.role === 'CFO')!;
    expect(ceo.vote).toBe('REVISIT');   // 50000 不 > 50000
    expect(cfo.vote).toBe('REVISIT');   // 50000 不 > 100000
    expect(r.confidence).toBe(0.5);     // 仅 CTO/CMO GO
  });

  it('roleVotes 含 4 个角色且每票带 reason', () => {
    const twin = new OrganizationTwin();
    const r = twin.simulateGoToMarket('新品', '市场', 100000);
    expect(r.roleVotes.map(v => v.role).sort()).toEqual(['CEO', 'CFO', 'CMO', 'CTO']);
    for (const v of r.roleVotes) {
      expect(typeof v.reason).toBe('string');
      expect(v.reason.length).toBeGreaterThan(0);
    }
    // 100000 边界：CEO GO(>50k) / CFO REVISIT(不>100k) → 3/4 = 0.75 GO
    expect(r.confidence).toBe(0.75);
    expect(r.recommended).toBe('GO');
  });
});
