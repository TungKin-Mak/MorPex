/**
 * gate/rules/detectors — 检测器注册表测试（Phase 2）
 *
 * 覆盖：RegexDetector 现行为不回归；ApiWhitelistDetector 白名单命中/未命中/误报控制/异常兜底
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { check as ruleEnforcementCheck } from '../../../src/gate/rules/RuleEnforcementGuard.js';
import { RegexDetector, ApiWhitelistDetector } from '../../../src/gate/rules/detectors.js';
import { RuleRegistry } from '../../../src/gate/rules/RuleRegistry.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';

function makeRule(overrides: Partial<RuleEntity>): RuleEntity {
  return {
    id: 'r1',
    tier: 'tier-1',
    domain: 'test-domain',
    severity: 'ERROR',
    ruleType: 'regex',
    target: 'proposal.payload',
    disallowedPattern: 'xxx',
    priority: 10,
    status: 'active',
    source: 'manual',
    description: '测试规则',
    ...overrides,
  };
}

describe('gate/rules/RegexDetector（Phase 1 行为不回归）', () => {
  beforeEach(() => RuleRegistry.clear());

  it('正则命中 → violation', () => {
    const rule = makeRule({ disallowedPattern: 'AirPods' });
    const v = RegexDetector.check({ payload: '卖 AirPods 耳机' } as any, rule);
    expect(v).not.toBeNull();
    expect(v!.ruleId).toBe('r1');
  });

  it('变体归一化：全角 + 大小写 + 空格全命中', () => {
    const rule = makeRule({ disallowedPattern: 'airpods' });
    expect(RegexDetector.check({ payload: 'ＡｉｒＰｏｄｓ' } as any, rule)).not.toBeNull();
    expect(RegexDetector.check({ payload: 'air pods' } as any, rule)).not.toBeNull();
    expect(RegexDetector.check({ payload: 'AirPods' } as any, rule)).not.toBeNull();
  });

  it('别名精确包含命中', () => {
    const rule = makeRule({ disallowedPattern: '', aliases: ['苹果耳机'] });
    const v = RegexDetector.check({ payload: '卖苹果耳机' } as any, rule);
    expect(v).not.toBeNull();
    expect(v!.matchedText).toBe('苹果耳机');
  });

  it('未命中 → null；非法正则 → null 不抛错', () => {
    expect(RegexDetector.check({ payload: '合规内容' } as any, makeRule({ disallowedPattern: 'zzz' }))).toBeNull();
    expect(() => RegexDetector.check({ payload: 'abc' } as any, makeRule({ disallowedPattern: '(' }))).not.toThrow();
  });
});

describe('gate/rules/ApiWhitelistDetector（Phase 2 白名单）', () => {
  it('白名单内前缀 → 不违规', () => {
    const rule = makeRule({ ruleType: 'whitelist', allowedApiPrefixes: ['IOCP', 'NVIC', 'SysTick'] });
    const v = ApiWhitelistDetector.check({ payload: 'IOCP_W(REG0, 0x00); SysTick_Config(72);' } as any, rule);
    expect(v).toBeNull();
  });

  it('非白名单前缀（STM32 HAL）→ 违规', () => {
    const rule = makeRule({ ruleType: 'whitelist', allowedApiPrefixes: ['IOCP', 'NVIC', 'SysTick'] });
    const v = ApiWhitelistDetector.check({ payload: 'LL_GPIO_WritePin(GPIOA, LL_GPIO_PIN_5, 1);' } as any, rule);
    expect(v).not.toBeNull();
    expect(v!.matchedText).toContain('LL_GPIO');
    expect(v!.description).toContain('LL');
  });

  it('无下划线/纯小写标识符 → 不误报', () => {
    const rule = makeRule({ ruleType: 'whitelist', allowedApiPrefixes: ['IOCP'] });
    expect(ApiWhitelistDetector.check({ payload: 'int counter = 0; void setup(void) { }' } as any, rule)).toBeNull();
  });

  it('allowedApiPrefixes 为空/缺失 → 不匹配不抛错', () => {
    const noPrefix = makeRule({ ruleType: 'whitelist', allowedApiPrefixes: undefined });
    expect(() => ApiWhitelistDetector.check({ payload: 'LL_GPIO_WritePin(...)' } as any, noPrefix)).not.toThrow();
    expect(ApiWhitelistDetector.check({ payload: 'LL_GPIO_WritePin(...)' } as any, noPrefix)).toBeNull();

    const empty = makeRule({ ruleType: 'whitelist', allowedApiPrefixes: [] });
    expect(ApiWhitelistDetector.check({ payload: 'LL_GPIO_WritePin(...)' } as any, empty)).toBeNull();
  });

  it('大小写不敏感：小写前缀调用也命中白名单', () => {
    const rule = makeRule({ ruleType: 'whitelist', allowedApiPrefixes: ['IOCP'] });
    expect(ApiWhitelistDetector.check({ payload: 'iocp_write(reg, 0x00)' } as any, rule)).toBeNull();
  });
});

describe('gate/rules/check 按 ruleType 分派（guard 重构不回归）', () => {
  beforeEach(() => RuleRegistry.clear());

  it('regex + whitelist 混合规则集各自生效', () => {
    RuleRegistry.register('test-domain', makeRule({ id: 'r_regex', disallowedPattern: 'AirPods' }));
    RuleRegistry.register('test-domain', makeRule({ id: 'r_whitelist', ruleType: 'whitelist', allowedApiPrefixes: ['IOCP'] }));

    // 同时命中两条：禁词 + 非白名单 API
    const result = ruleEnforcementCheck({ payload: 'AirPods + LL_GPIO_WritePin' } as any, RuleRegistry.getActiveRules());
    expect(result.hasError).toBe(true);
    expect(result.violations.map((v) => v.ruleId).sort()).toEqual(['r_regex', 'r_whitelist']);
  });

  it('semantic 规则暂缺检测器 → 跳过不抛错', () => {
    RuleRegistry.register('test-domain', makeRule({ id: 'r_semantic', ruleType: 'semantic' }));
    const result = ruleEnforcementCheck({ payload: 'anything' } as any, RuleRegistry.getActiveRules());
    expect(result.violations).toHaveLength(0);
  });
});
