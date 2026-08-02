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

  it('fingerprint：无 active 规则返回空串；规则变更必变（缓存一致性）', () => {
    expect(RuleRegistry.fingerprint()).toBe('');

    RuleRegistry.register('test-domain', makeRule('r1', 'active'));
    const fp1 = RuleRegistry.fingerprint();
    expect(fp1).not.toBe('');

    // setStatus 变更 → fingerprint 变
    RuleRegistry.setStatus('r1', 'disabled');
    expect(RuleRegistry.fingerprint()).not.toBe(fp1);

    // 同规则重复 register（内容相同）→ fingerprint 稳定
    RuleRegistry.setStatus('r1', 'active');
    RuleRegistry.register('test-domain', makeRule('r1', 'active'));
    expect(RuleRegistry.fingerprint()).toBe(fp1);
  });

  it('fingerprint：允许 API 前缀参与签名', () => {
    const r = makeRule('r1', 'active');
    (r as any).ruleType = 'whitelist';
    (r as any).allowedApiPrefixes = ['IOCP', 'NVIC'];
    RuleRegistry.register('test-domain', r);
    const fp1 = RuleRegistry.fingerprint();

    const r2 = makeRule('r1', 'active');
    (r2 as any).ruleType = 'whitelist';
    (r2 as any).allowedApiPrefixes = ['IOCP', 'GPIO'];
    RuleRegistry.register('test-domain', r2); // 覆盖注册（同 id）
    expect(RuleRegistry.fingerprint()).not.toBe(fp1);
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
