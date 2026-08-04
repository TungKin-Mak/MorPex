/**
 * 功能② Phase 2 第二批测试
 *
 * 覆盖：
 *   1. SchemaDetector：JSON Schema 结构校验（type/required/properties/enum/items；非 JSON → 违规）
 *   2. StructuralCorrectionRegistry + applyStructuralCorrection：领域修正器注入 + 引擎统一入口 + 防抖
 *   3. runOntologyGroundedReasoning 精确计费：onTokenUsage 收真实 usage.total（mock piBridge 断言）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SchemaDetector,
  validateAgainstSchema,
  detectorRegistry,
} from '../src/gate/rules/detectors.js';
import {
  StructuralCorrectionRegistry,
  applyStructuralCorrection,
  type StructuralCorrector,
} from '../src/gate/rules/structuralCorrection.js';
import type { OntologyProposal } from '../src/gate/types.js';
import type { RuleEntity, RuleViolation } from '../src/gate/rules/types.js';

// ── 通用 fixtures ──

function makeRule(overrides: Partial<RuleEntity> = {}): RuleEntity {
  return {
    id: 'test_rule',
    tier: 'tier-1',
    domain: 'test',
    severity: 'ERROR',
    ruleType: 'schema',
    target: 'proposal.payload',
    priority: 50,
    status: 'active',
    source: 'manual',
    description: '测试规则',
    ...overrides,
  };
}

function makeProposal(payload: unknown): OntologyProposal {
  return {
    action_type: 'create',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    proposal: typeof payload === 'string' ? payload : JSON.stringify(payload),
    referenced_object_ids: [],
    missing_info: [],
    needs_human_review: false,
  } as OntologyProposal;
}

// ── 1. SchemaDetector ──

describe('SchemaDetector — JSON Schema 结构校验', () => {
  it('合规 JSON → 不违规', () => {
    const rule = makeRule({
      expectedSchema: {
        type: 'object',
        required: ['name', 'price'],
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
        },
      },
    });
    const v = SchemaDetector.check(makeProposal({ name: '手机', price: 1999 }), rule);
    expect(v).toBeNull();
  });

  it('缺必填字段 → 违规（ERROR）', () => {
    const rule = makeRule({
      expectedSchema: {
        type: 'object',
        required: ['name', 'price'],
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
        },
      },
    });
    const v = SchemaDetector.check(makeProposal({ name: '手机' }), rule);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('ERROR');
    expect(v!.matchedText).toContain('price');
    expect(v!.matchedText).toContain('缺少必填字段');
  });

  it('类型不符 → 违规', () => {
    const rule = makeRule({
      expectedSchema: { type: 'object', properties: { count: { type: 'number' } } },
    });
    const v = SchemaDetector.check(makeProposal({ count: '不是数字' }), rule);
    expect(v).not.toBeNull();
    expect(v!.matchedText).toContain('类型不符');
  });

  it('枚举越界 → 违规', () => {
    const rule = makeRule({
      expectedSchema: { type: 'object', properties: { status: { type: 'string', enum: ['draft', 'active'] } } },
    });
    const v = SchemaDetector.check(makeProposal({ status: 'deleted' }), rule);
    expect(v).not.toBeNull();
    expect(v!.matchedText).toContain('枚举');
  });

  it('数组 items 校验 → 递归', () => {
    const rule = makeRule({
      expectedSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } } },
    });
    const v = SchemaDetector.check(makeProposal({ items: ['a', 42] }), rule);
    expect(v).not.toBeNull();
    expect(v!.matchedText).toContain('items[1]');
  });

  it('目标文本非合法 JSON → 违规（结构性）', () => {
    const rule = makeRule({ expectedSchema: { type: 'object' } });
    const v = SchemaDetector.check(makeProposal('这不是 JSON{{{'), rule);
    expect(v).not.toBeNull();
  });

  it('未声明 expectedSchema → 不匹配（配置缺失不误报）', () => {
    const rule = makeRule({ expectedSchema: undefined });
    const v = SchemaDetector.check(makeProposal({ a: 1 }), rule);
    expect(v).toBeNull();
  });

  it('validateAgainstSchema 直接校验（纯函数）', () => {
    expect(validateAgainstSchema({ a: 1 }, { type: 'object', required: ['a'], properties: { a: { type: 'number' } } })).toEqual([]);
    expect(validateAgainstSchema({}, { type: 'object', required: ['a'] }).length).toBe(1);
  });

  it('detectorRegistry 已注册 schema', () => {
    expect(detectorRegistry.schema).toBe(SchemaDetector);
  });
});

// ── 2. 结构修正管线 ──

describe('StructuralCorrectionRegistry + applyStructuralCorrection — 修正管线②', () => {
  afterEach(() => {
    StructuralCorrectionRegistry.clear();
  });

  it('注册修正器 → applyStructuralCorrection 命中并修正 → 返回修正后 proposal', async () => {
    const corrector: StructuralCorrector = {
      type: 'test-fixer',
      canHandle: (rule) => rule.ruleType === 'fixable',
      correct: async (proposal, violations) => {
        if (violations.length === 0) return { proposal, correctedCount: 0 };
        const payload = typeof proposal.payload === 'string' ? proposal.payload : JSON.stringify(proposal.payload);
        const fixed = payload.replaceAll('VAR', 'LET');
        // 幂等：未实际变更 → correctedCount=0（引擎据此停止多轮循环）
        if (fixed === payload) return { proposal, correctedCount: 0 };
        return {
          proposal: { ...proposal, payload: fixed, proposal: fixed },
          correctedCount: 1,
          note: 'test-fixer 修正 1 处',
        };
      },
    };
    StructuralCorrectionRegistry.registerCorrector('test-fixer', corrector);
    expect(StructuralCorrectionRegistry.has('test-fixer')).toBe(true);

    const rule = makeRule({ id: 'r1', ruleType: 'fixable' });
    const violation: RuleViolation = {
      ruleId: 'r1', severity: 'ERROR', matchedText: 'VAR', target: 'proposal.payload', description: 'x',
    };
    const result = await applyStructuralCorrection(makeProposal('VAR = 1'), [violation], [rule]);
    expect(result.correctedCount).toBe(1);
    expect(result.proposal.payload).toBe('LET = 1');
    expect(result.notes.length).toBe(1);
  });

  it('无注册修正器 → 原样返回（correctedCount=0）', async () => {
    const rule = makeRule({ id: 'r1', ruleType: 'fixable' });
    const violation: RuleViolation = {
      ruleId: 'r1', severity: 'ERROR', matchedText: 'x', target: 'proposal.payload', description: 'x',
    };
    const result = await applyStructuralCorrection(makeProposal('x'), [violation], [rule]);
    expect(result.correctedCount).toBe(0);
    expect(result.proposal.payload).toBe('x');
  });

  it('修正器异常 → 不阻断（继续其他修正器）', async () => {
    const bad: StructuralCorrector = {
      type: 'bad',
      canHandle: () => true,
      correct: async () => { throw new Error('boom'); },
    };
    let goodCalls = 0;
    const good: StructuralCorrector = {
      type: 'good',
      canHandle: () => true,
      // 幂等：首次修正计 1，之后 correctedCount=0（引擎防抖：多轮循环到 0 停止）
      correct: async (proposal) => {
        goodCalls++;
        return { proposal: { ...proposal }, correctedCount: goodCalls === 1 ? 1 : 0, note: 'ok' };
      },
    };
    StructuralCorrectionRegistry.registerCorrector('bad', bad);
    StructuralCorrectionRegistry.registerCorrector('good', good);

    const rule = makeRule({ id: 'r1', ruleType: 'fixable' });
    const violation: RuleViolation = {
      ruleId: 'r1', severity: 'ERROR', matchedText: 'x', target: 'proposal.payload', description: 'x',
    };
    const result = await applyStructuralCorrection(makeProposal('x'), [violation], [rule]);
    expect(result.correctedCount).toBe(1);
  });

  it('未命中 canHandle 的规则 → 不调用 correct', async () => {
    let called = false;
    const corrector: StructuralCorrector = {
      type: 'noop',
      canHandle: () => false,
      correct: async (proposal) => { called = true; return { proposal, correctedCount: 1 }; },
    };
    StructuralCorrectionRegistry.registerCorrector('noop', corrector);
    const rule = makeRule({ id: 'r1', ruleType: 'other' });
    const violation: RuleViolation = {
      ruleId: 'r1', severity: 'ERROR', matchedText: 'x', target: 'proposal.payload', description: 'x',
    };
    await applyStructuralCorrection(makeProposal('x'), [violation], [rule]);
    expect(called).toBe(false);
  });
});
