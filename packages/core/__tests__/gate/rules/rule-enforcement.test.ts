/**
 * gate/rules/RuleEnforcementGuard — 规则执行器纯函数测试
 *
 * 覆盖：命中 / 未命中 / 别名展开 / WARNING 不中断 / 无规则 no-op / 全角变体
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { check as ruleEnforcementCheck } from '../../../src/gate/rules/RuleEnforcementGuard.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';
import type { OntologyProposal } from '../../../src/gate/types.js';

const ERROR_RULE: RuleEntity = {
  id: 'no_competitor_trademark',
  tier: 'tier-1',
  domain: 'ecommerce',
  severity: 'ERROR',
  ruleType: 'regex',
  target: 'proposal.payload',
  disallowedPattern: 'Apple|iPhone|AirPods',
  aliases: ['苹果耳机', 'air pods'],
  priority: 100,
  status: 'active',
  source: 'manual',
  description: '禁止竞品商标',
};

const WARNING_RULE: RuleEntity = {
  ...ERROR_RULE,
  id: 'warn_trademark',
  severity: 'WARNING',
};

function proposalWith(text: string): OntologyProposal {
  return {
    referenced_object_ids: [],
    payload: text,
    raw: text,
  };
}

describe('gate/rules/RuleEnforcementGuard', () => {
  beforeEach(() => {
    // 无全局状态依赖；guard 为纯函数
  });

  it('无规则 → no-op（空违规，不改变行为）', () => {
    const result = ruleEnforcementCheck(proposalWith('包含 AirPods 的文案'), []);
    expect(result.violations).toEqual([]);
    expect(result.hasError).toBe(false);
  });

  it('命中 ERROR 规则 → 返回违规', () => {
    const result = ruleEnforcementCheck(proposalWith('这款耳机比 AirPods 更好'), [ERROR_RULE]);
    expect(result.hasError).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].ruleId).toBe('no_competitor_trademark');
    expect(result.violations[0].severity).toBe('ERROR');
  });

  it('未命中 → 无违规', () => {
    const result = ruleEnforcementCheck(proposalWith('这款耳机续航 30 小时'), [ERROR_RULE]);
    expect(result.hasError).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('别名展开命中（苹果耳机 / air pods）', () => {
    expect(ruleEnforcementCheck(proposalWith('比苹果耳机更好'), [ERROR_RULE]).hasError).toBe(true);
    expect(ruleEnforcementCheck(proposalWith('air pods 替代品'), [ERROR_RULE]).hasError).toBe(true);
  });

  it('全角/大小写变体命中（ＡｉｒＰｏｄｓ / Apple）', () => {
    expect(ruleEnforcementCheck(proposalWith('ＡｉｒＰｏｄｓ 对比'), [ERROR_RULE]).hasError).toBe(true);
    expect(ruleEnforcementCheck(proposalWith('apple 生态'), [ERROR_RULE]).hasError).toBe(true);
  });

  it('WARNING 违规返回但 hasError=false（不中断）', () => {
    const result = ruleEnforcementCheck(proposalWith('提到 Apple 了'), [WARNING_RULE]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe('WARNING');
    expect(result.hasError).toBe(false);
  });

  it('pending 规则不参与匹配', () => {
    const pendingRule: RuleEntity = { ...ERROR_RULE, status: 'pending' };
    const result = ruleEnforcementCheck(proposalWith('包含 AirPods 的文案'), [pendingRule]);
    expect(result.violations).toEqual([]);
  });

  it('非法正则不硬崩（跳过该规则）', () => {
    const badRule: RuleEntity = { ...ERROR_RULE, id: 'bad_regex', disallowedPattern: '([unclosed' };
    const result = ruleEnforcementCheck(proposalWith('任何文案'), [badRule]);
    expect(result.violations).toEqual([]);
  });

  it('按 priority 排序：高优先级规则先返回', () => {
    const low: RuleEntity = { ...ERROR_RULE, id: 'low', priority: 1, disallowedPattern: 'Apple' };
    const high: RuleEntity = { ...ERROR_RULE, id: 'high', priority: 99, disallowedPattern: 'iPhone' };
    const result = ruleEnforcementCheck(proposalWith('iPhone 和 Apple'), [low, high]);
    expect(result.violations.map((v) => v.ruleId)).toEqual(['high', 'low']);
  });
});
