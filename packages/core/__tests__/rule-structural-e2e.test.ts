/**
 * 结构修正管线全量验证（任务 ③：证明"规则命中 → 结构修正 → 重新检测 → 合规放行"闭环）
 *
 * 覆盖：
 *   1. 全闭环（core 内，无领域依赖）：真实 ruleEnforcementCheck + mock corrector
 *      → var→const 机械修正 → recheck 无 ERROR（runOntologyGroundedReasoning 挂载路径的单元等价）
 *   2. 真实 eslint（software 领域适配器）：registerSoftwareStructuralCorrector 注入
 *      EsLintStructuralCorrector（Linter.verifyAndFix），配 eslint 检测器 + active no-var 规则
 *      → check 命中 → 结构修正 → recheck 合规放行
 *   3. maxPasses 防抖：修正器每次返回 correctedCount=1 但永远修不好 → 2 轮后停止（不死循环）
 *
 * 全程无 LLM（纯确定性）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuleRegistry } from '../src/gate/rules/RuleRegistry.js';
import { check as ruleEnforcementCheck } from '../src/gate/rules/RuleEnforcementGuard.js';
import { DetectorRegistry } from '../src/gate/rules/DetectorRegistry.js';
import { StructuralCorrectionRegistry, applyStructuralCorrection, type StructuralCorrector } from '../src/gate/rules/structuralCorrection.js';
import type { OntologyProposal } from '../src/gate/types.js';
import type { RuleEntity } from '../src/gate/rules/types.js';

function makeProposal(payload: string): OntologyProposal {
  return {
    action_type: 'create',
    payload,
    proposal: payload,
    referenced_object_ids: [],
    missing_info: [],
    needs_human_review: false,
  } as OntologyProposal;
}

function makeRule(overrides: Partial<RuleEntity> = {}): RuleEntity {
  return {
    id: 'e2e_rule',
    tier: 'tier-1',
    domain: 'test',
    severity: 'ERROR',
    ruleType: 'regex',
    target: 'proposal.payload',
    priority: 80,
    status: 'active',
    source: 'manual',
    description: 'e2e 规则',
    ...overrides,
  };
}

beforeEach(() => {
  RuleRegistry.clear();
  StructuralCorrectionRegistry.clear();
  DetectorRegistry.clear();
});

afterEach(() => {
  RuleRegistry.clear();
  StructuralCorrectionRegistry.clear();
  DetectorRegistry.clear();
});

describe('结构修正全闭环（core 内，真实 check + corrector）', () => {
  it('规则命中 → 结构修正 → 重新 check 无 ERROR（runOntologyGroundedReasoning 挂载路径等价）', async () => {
    // 1. 规则：regex 命中 `var <word>`（proposal.payload）
    const rule = makeRule({
      id: 'no-var',
      domain: 'test',
      ruleType: 'regex',
      disallowedPattern: 'var\\w*',
    });
    RuleRegistry.register('test', rule);

    // 2. 修正器：var → const 机械替换
    const fixer: StructuralCorrector = {
      type: 'e2e-fixer',
      canHandle: (r) => r.id === 'no-var' && r.ruleType === 'regex',
      correct: async (proposal) => {
        const payload = typeof proposal.payload === 'string' ? proposal.payload : '';
        const fixed = payload.replace(/\bvar\s+/g, 'const ');
        if (fixed === payload) return { proposal, correctedCount: 0 };
        return { proposal: { ...proposal, payload: fixed, proposal: fixed }, correctedCount: 1, note: 'var→const' };
      },
    };
    StructuralCorrectionRegistry.registerCorrector('e2e-fixer', fixer);

    // 3. 闭环：命中 → 修正 → 重检
    const proposal = makeProposal('var x = 1;');
    const first = ruleEnforcementCheck(proposal, RuleRegistry.getActiveRules());
    expect(first.hasError).toBe(true);
    expect(first.violations[0].ruleId).toBe('no-var');

    const fixed = await applyStructuralCorrection(proposal, first.violations, RuleRegistry.getActiveRules());
    expect(fixed.correctedCount).toBe(1);
    expect(fixed.proposal.payload).toBe('const x = 1;');

    const recheck = ruleEnforcementCheck(fixed.proposal, RuleRegistry.getActiveRules());
    expect(recheck.hasError).toBe(false);
    expect(recheck.violations).toEqual([]);
  });
});

describe('真实 eslint 适配器全链路（software 领域注入）', () => {
  it('registerSoftwareStructuralCorrector → no-var 命中 → verifyAndFix 修正 → 重检合规', async () => {
    const { registerSoftwareStructuralCorrector } = await import('../../workflows/software/src/rules/structural-eslint.js');
    registerSoftwareStructuralCorrector();

    // eslint 检测器（ruleType='eslint' 无内置检测器 → 领域经 DetectorRegistry 注入）
    DetectorRegistry.registerDetector('eslint', {
      type: 'eslint',
      check: (proposal, rule) => {
        const payload = typeof proposal.payload === 'string' ? proposal.payload : '';
        if (!/\bvar\s+\w+/.test(payload)) return null;
        return {
          ruleId: rule.id,
          severity: rule.severity,
          matchedText: payload.match(/\bvar\s+\w+/)?.[0] ?? 'var',
          target: rule.target,
          description: rule.description,
        };
      },
    });

    // 激活 pending 的 no-var 规则（生产默认 pending 待人工确认；测试显式激活）
    RuleRegistry.setStatus('no-var', 'active');
    const active = RuleRegistry.getActiveRules('software');
    expect(active.some(r => r.id === 'no-var')).toBe(true);

    // 闭环：命中 → eslint --fix → 重检
    const proposal = makeProposal('var x = 1;');
    const first = ruleEnforcementCheck(proposal, active);
    expect(first.hasError).toBe(true);

    const fixed = await applyStructuralCorrection(proposal, first.violations, active);
    expect(fixed.correctedCount).toBeGreaterThan(0);
    // no-var 的 eslint 正确输出是 `let x`（const 推断属 prefer-const 另一条规则，未激活不参与）
    expect(fixed.proposal.payload).toBe('let x = 1;');
    expect(fixed.proposal.payload).not.toContain('var');

    const recheck = ruleEnforcementCheck(fixed.proposal, active);
    expect(recheck.hasError).toBe(false);
  }, 15000);

  it('eslint 无违规代码 → 修正器不触碰（correctedCount=0，原样返回）', async () => {
    const { registerSoftwareStructuralCorrector } = await import('../../workflows/software/src/rules/structural-eslint.js');
    registerSoftwareStructuralCorrector();
    RuleRegistry.setStatus('no-var', 'active');
    const active = RuleRegistry.getActiveRules('software');

    const proposal = makeProposal('const x = 1;');
    const first = ruleEnforcementCheck(proposal, active);
    expect(first.hasError).toBe(false);

    const result = await applyStructuralCorrection(proposal, [], active);
    expect(result.correctedCount).toBe(0);
    expect(result.proposal.payload).toBe('const x = 1;');
  });
});

describe('applyStructuralCorrection — maxPasses 防抖', () => {
  it('修正器每次计 1 但永远修不好 → 2 轮后停止（不死循环）', async () => {
    let calls = 0;
    const sticky: StructuralCorrector = {
      type: 'sticky',
      canHandle: () => true,
      correct: async (proposal) => {
        calls++;
        // 每次都声称修正 1 处，但内容不变（引擎须在 maxPasses 后停止）
        return { proposal: { ...proposal }, correctedCount: 1, note: 'sticky' };
      },
    };
    StructuralCorrectionRegistry.registerCorrector('sticky', sticky);

    const rule = makeRule({ id: 'r1', ruleType: 'fixable' });
    const violations = [{ ruleId: 'r1', severity: 'ERROR' as const, matchedText: 'x', target: 'proposal.payload' as const, description: 'x' }];
    const result = await applyStructuralCorrection(makeProposal('x'), violations, [rule], 2);

    // maxPasses=2 → 每轮 1 次 correct 调用（共 2），不无限循环
    expect(calls).toBe(2);
    expect(result.correctedCount).toBe(2);
  });
});
