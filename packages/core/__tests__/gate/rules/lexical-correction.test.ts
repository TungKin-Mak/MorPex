/**
 * gate/rules/lexicalCorrection — 词法修正（通用修正管线①）测试
 *
 * 覆盖：allowedAction 可替换 → 修正成功且重新 check 无违规；无 allowedAction → 原样；payload 非字符串 → 不动
 */
import { describe, it, expect } from 'vitest';
import { lexicalCorrect } from '../../../src/gate/rules/lexicalCorrection.js';
import { check as ruleEnforcementCheck } from '../../../src/gate/rules/RuleEnforcementGuard.js';
import type { RuleEntity, RuleViolation } from '../../../src/gate/rules/types.js';

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

describe('gate/rules/lexicalCorrect', () => {
  it('allowedAction 可替换 → correctedCount>0 且重新 check 无违规', () => {
    const rule = makeRule({ id: 'r_fix', disallowedPattern: 'xxx', allowedAction: '合规词' });
    const proposal = { payload: '这里包含 xxx 内容', proposal: '这里包含 xxx 内容', referenced_object_ids: [] };
    const checkResult = ruleEnforcementCheck(proposal as any, [rule]);
    expect(checkResult.hasError).toBe(true);

    const corrected = lexicalCorrect(proposal as any, checkResult.violations, [rule]);
    expect(corrected.correctedCount).toBeGreaterThan(0);
    expect(corrected.proposal.payload).toBe('这里包含 合规词 内容');

    // 修正后重新 check → 合规
    const recheck = ruleEnforcementCheck(corrected.proposal, [rule]);
    expect(recheck.hasError).toBe(false);
  });

  it('无 allowedAction → correctedCount=0 原样返回（对象引用不变）', () => {
    const rule = makeRule({ id: 'r_nofix', disallowedPattern: 'xxx' });
    const proposal = { payload: '这里包含 xxx 内容', referenced_object_ids: [] };
    const violations: RuleViolation[] = [{ ruleId: 'r_nofix', severity: 'ERROR', matchedText: 'xxx', target: 'proposal.payload', description: 'd' }];

    const corrected = lexicalCorrect(proposal as any, violations, [rule]);
    expect(corrected.correctedCount).toBe(0);
    expect(corrected.proposal).toBe(proposal); // 同引用
  });

  it('payload 非字符串 → 不动（correctedCount=0）', () => {
    const rule = makeRule({ id: 'r_obj', disallowedPattern: 'xxx', allowedAction: 'OK' });
    const proposal = { payload: { title: 'xxx 标题' }, referenced_object_ids: [] };
    const violations: RuleViolation[] = [{ ruleId: 'r_obj', severity: 'ERROR', matchedText: 'xxx', target: 'proposal.payload', description: 'd' }];

    const corrected = lexicalCorrect(proposal as any, violations, [rule]);
    expect(corrected.correctedCount).toBe(0);
    expect(corrected.proposal).toBe(proposal);
  });

  it('违规片段定位不到（规范化前后不一致）→ 保守跳过不计数', () => {
    const rule = makeRule({ id: 'r_miss', disallowedPattern: 'xxx', allowedAction: 'OK' });
    // payload 是原始文本（含空格/大写），matchedText 是规范化片段 'xxx' 但原文是 'X X X'
    const proposal = { payload: '包含 X X X 的内容', referenced_object_ids: [] };
    const violations: RuleViolation[] = [{ ruleId: 'r_miss', severity: 'ERROR', matchedText: 'xxx', target: 'proposal.payload', description: 'd' }];

    const corrected = lexicalCorrect(proposal as any, violations, [rule]);
    expect(corrected.correctedCount).toBe(0); // 不猜测修改
  });

  it('规则不存在于 rules 集合 → 跳过不抛错', () => {
    const proposal = { payload: '包含 xxx 的内容', referenced_object_ids: [] };
    const violations: RuleViolation[] = [{ ruleId: 'ghost', severity: 'ERROR', matchedText: 'xxx', target: 'proposal.payload', description: 'd' }];

    const corrected = lexicalCorrect(proposal as any, violations, []);
    expect(corrected.correctedCount).toBe(0);
    expect(corrected.proposal).toBe(proposal);
  });
});
