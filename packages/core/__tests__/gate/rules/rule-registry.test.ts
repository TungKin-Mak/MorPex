/**
 * gate/rules/RuleRegistry + rulePersistence — 注册表与状态流转测试
 *
 * 覆盖：register / getActiveRules（pending 不参与）/ setStatus / confirmRule / disableRule / clear
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RuleRegistry } from '../../../src/gate/rules/RuleRegistry.js';
import { rulePersistence } from '../../../src/gate/rules/rulePersistence.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';

function makeRule(id: string, status: RuleEntity['status'] = 'active'): RuleEntity {
  return {
    id,
    tier: 'tier-1',
    domain: 'test-domain',
    severity: 'ERROR',
    ruleType: 'regex',
    target: 'proposal.payload',
    disallowedPattern: `pattern_${id}`,
    priority: 10,
    status,
    source: 'manual',
    description: `规则 ${id}`,
  };
}

describe('gate/rules/RuleRegistry', () => {
  beforeEach(() => {
    RuleRegistry.clear();
  });

  it('register + getActiveRules：仅返回 active', () => {
    RuleRegistry.register('test-domain', makeRule('r1', 'active'));
    RuleRegistry.register('test-domain', makeRule('r2', 'pending'));
    RuleRegistry.register('test-domain', makeRule('r3', 'disabled'));

    const active = RuleRegistry.getActiveRules();
    expect(active.map((r) => r.id).sort()).toEqual(['r1']);
  });

  it('getActiveRules(domain) 按领域过滤', () => {
    RuleRegistry.register('a', makeRule('ra'));
    RuleRegistry.register('b', makeRule('rb'));
    expect(RuleRegistry.getActiveRules('a').map((r) => r.id)).toEqual(['ra']);
  });

  it('setStatus：pending → active 后参与匹配', () => {
    RuleRegistry.register('test-domain', makeRule('r1', 'pending'));
    expect(RuleRegistry.isRuleActive('r1')).toBe(false);
    RuleRegistry.setStatus('r1', 'active');
    expect(RuleRegistry.isRuleActive('r1')).toBe(true);
    expect(RuleRegistry.getActiveRules()).toHaveLength(1);
  });

  it('无 id 自动生成', () => {
    RuleRegistry.register('test-domain', makeRule(''));
    const rules = RuleRegistry.getAll();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toMatch(/^rule_/);
  });
});

describe('gate/rules/rulePersistence', () => {
  beforeEach(() => {
    RuleRegistry.clear();
  });

  it('confirmRule：pending → active（关键安全阀）', () => {
    RuleRegistry.register('test-domain', makeRule('r1', 'pending'));
    expect(rulePersistence.confirmRule('r1')).toBe(true);
    expect(RuleRegistry.isRuleActive('r1')).toBe(true);
  });

  it('disableRule：关闭误报规则', () => {
    RuleRegistry.register('test-domain', makeRule('r1'));
    expect(rulePersistence.disableRule('r1')).toBe(true);
    expect(RuleRegistry.isRuleActive('r1')).toBe(false);
  });

  it('不存在的规则返回 false', () => {
    expect(rulePersistence.confirmRule('nope')).toBe(false);
    expect(rulePersistence.disableRule('nope')).toBe(false);
  });
});
