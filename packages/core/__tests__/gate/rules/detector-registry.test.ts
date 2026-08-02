/**
 * gate/rules/DetectorRegistry — 领域自定义检测器注册表测试（Phase 2 B2）
 *
 * 覆盖：注册/查询/覆盖/clear；自定义 ruleType 经 DetectorRegistry 分派生效；
 * 未注册自定义类型 → 跳过不抛错（no-op 约束）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { check as ruleEnforcementCheck } from '../../../src/gate/rules/RuleEnforcementGuard.js';
import { DetectorRegistry } from '../../../src/gate/rules/DetectorRegistry.js';
import { RuleRegistry } from '../../../src/gate/rules/RuleRegistry.js';
import type { RuleDetector } from '../../../src/gate/rules/detectors.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';

function makeRule(overrides: Partial<RuleEntity>): RuleEntity {
  return {
    id: 'r1',
    tier: 'tier-1',
    domain: 'test-domain',
    severity: 'ERROR',
    ruleType: 'regex',
    target: 'proposal.payload',
    disallowedPattern: '',
    priority: 10,
    status: 'active',
    source: 'manual',
    description: '测试规则',
    ...overrides,
  };
}

/** 自定义检测器：检测 eval( 动态执行 */
const NoEvalDetector: RuleDetector = {
  type: 'custom:no-eval',
  check(proposal, rule) {
    const payload = proposal.payload;
    if (typeof payload !== 'string') return null;
    const m = payload.match(/eval\s*\(/i);
    if (!m) return null;
    return {
      ruleId: rule.id,
      severity: rule.severity,
      matchedText: m[0],
      target: rule.target,
      description: rule.description,
    };
  },
};

describe('gate/rules/DetectorRegistry', () => {
  beforeEach(() => {
    DetectorRegistry.clear();
    RuleRegistry.clear();
  });

  it('registerDetector / getDetector / has 基本链路', () => {
    DetectorRegistry.registerDetector('custom:no-eval', NoEvalDetector);
    expect(DetectorRegistry.has('custom:no-eval')).toBe(true);
    expect(DetectorRegistry.getDetector('custom:no-eval')).toBe(NoEvalDetector);
    expect(DetectorRegistry.getDetector('custom:none')).toBeUndefined();
  });

  it('同 type 覆盖（幂等），clear 清空', () => {
    const a: RuleDetector = { type: 'custom:x', check: () => null };
    const b: RuleDetector = { type: 'custom:x', check: () => null };
    DetectorRegistry.registerDetector('custom:x', a);
    DetectorRegistry.registerDetector('custom:x', b);
    expect(DetectorRegistry.getDetector('custom:x')).toBe(b);

    DetectorRegistry.clear();
    expect(DetectorRegistry.has('custom:x')).toBe(false);
  });

  it('自定义规则经 DetectorRegistry 分派：命中 eval → violation', () => {
    DetectorRegistry.registerDetector('custom:no-eval', NoEvalDetector);
    RuleRegistry.register('test-domain', makeRule({ id: 'r_eval', ruleType: 'custom:no-eval' }));

    const result = ruleEnforcementCheck({ payload: 'const x = eval("1+1");' } as any, RuleRegistry.getActiveRules());
    expect(result.hasError).toBe(true);
    expect(result.violations[0].ruleId).toBe('r_eval');
  });

  it('未注册自定义类型 → 跳过不抛错（no-op）', () => {
    // 不注册 DetectorRegistry，只注册规则
    RuleRegistry.register('test-domain', makeRule({ id: 'r_unknown', ruleType: 'custom:ghost' }));
    const result = ruleEnforcementCheck({ payload: 'anything' } as any, RuleRegistry.getActiveRules());
    expect(result.violations).toHaveLength(0);
    expect(result.hasError).toBe(false);
  });

  it('pending 规则不参与分派', () => {
    DetectorRegistry.registerDetector('custom:no-eval', NoEvalDetector);
    RuleRegistry.register('test-domain', makeRule({ id: 'r_pending', ruleType: 'custom:no-eval', status: 'pending' }));
    const result = ruleEnforcementCheck({ payload: 'eval("x")' } as any, RuleRegistry.getActiveRules());
    expect(result.violations).toHaveLength(0);
  });
});
