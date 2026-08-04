/**
 * AST/tsc 结构修正适配器测试（功能② Phase 2 第二批增强）
 *
 * 覆盖：
 *   1. ast-utils 单元：var→const/let（const 推断）、AST var 检测（variable/var2 不误报）、
 *      eval 调用检测（foo.eval()/obj.Function() 不误报）、tsc 类型检查（clean/类型错/语法错/超长跳过）
 *   2. 检测器集成：registerSoftwareAstTscAdapters → 激活规则 → ruleEnforcementCheck 命中
 *   3. 修正闭环：var→const（no-var-ast 规则触发 tsc 修正器机械修）→ recheck 放行；
 *      不可机械修的类型错误 → note 报告 + recheck 仍违规（升级 LLM 重试）；eval 无修正器 → 升级路径
 *
 * 全程无 LLM（纯确定性；tsc 用内存内 Program）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RuleRegistry,
  ruleEnforcementCheck,
  applyStructuralCorrection,
  DetectorRegistry,
  StructuralCorrectionRegistry,
  type OntologyProposal,
} from '@morpex/core';
import {
  parseSource,
  findVarDeclarations,
  findEvalCalls,
  fixVarToLetConst,
  typeCheck,
  formatDiagnostic,
} from '../src/rules/ast-utils.js';
import { registerSoftwareAstTscAdapters } from '../src/rules/structural-ast-tsc.js';

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

beforeEach(() => {
  RuleRegistry.clear();
  DetectorRegistry.clear();
  StructuralCorrectionRegistry.clear();
});

afterEach(() => {
  RuleRegistry.clear();
  DetectorRegistry.clear();
  StructuralCorrectionRegistry.clear();
});

describe('ast-utils — var→const/let（const 推断，优于 eslint 恒转 let）', () => {
  it('未重赋值+有初始化 → const；重赋值 → let；无初始化 → let', () => {
    const src = 'var x = 1;\nvar y = 2;\ny = 3;\nvar z;\n';
    const { output, fixed } = fixVarToLetConst(src);
    expect(fixed).toBe(3);
    expect(output).toContain('const x = 1;');
    expect(output).toContain('let y = 2;');
    expect(output).toContain('let z;');
  });

  it('嵌套函数内 var 也修正；无 var → fixed=0 原样返回', () => {
    const { output, fixed } = fixVarToLetConst('function f(){ var w = 4; return w; }');
    expect(fixed).toBe(1);
    expect(output).toContain('const w = 4');
    const noVar = fixVarToLetConst('const a = 1;\nlet b = 2;');
    expect(noVar.fixed).toBe(0);
    expect(noVar.output).toBe('const a = 1;\nlet b = 2;');
  });
});

describe('ast-utils — AST var 检测（variable/var2 标识符不误报）', () => {
  it('只识别 var 声明，不误报 variable/var2/let/const', () => {
    const sf = parseSource('var v = 1;\nconst variable = 2;\nlet var2 = 3;\nvar foo_bar = 4;');
    const names = findVarDeclarations(sf).map((v) => v.name);
    expect(names).toContain('v');
    expect(names).toContain('foo_bar');
    expect(names).not.toContain('variable');
    expect(names).not.toContain('var2');
  });
});

describe('ast-utils — eval/Function 调用检测（成员访问不误报 = 区分声明/调用）', () => {
  it('裸 eval()/Function()/new Function() 命中；foo.eval()/obj.Function() 不命中', () => {
    const sf = parseSource('eval("x");\nnew Function("return 1");\nFunction("a");\nfoo.eval();\nobj.Function();\nconst ev = fn; ev();');
    const calls = findEvalCalls(sf);
    // 3 个裸调用命中；foo.eval()/obj.Function()/ev() 不命中
    expect(calls.length).toBe(3);
  });
});

describe('ast-utils — tsc 内存内类型检查', () => {
  it('干净代码 0 诊断；类型错误 1 诊断（带位置）；语法错误多诊断', () => {
    const clean = typeCheck('const x: number = 42;\nfunction add(a: number, b: number): number { return a + b; }');
    expect(clean.diagnostics.length).toBe(0);

    const err = typeCheck('const x: number = "hello";');
    expect(err.diagnostics.length).toBe(1);
    expect(formatDiagnostic(err.diagnostics[0])).toContain('Type \'string\' is not assignable to type \'number\'');

    const syn = typeCheck('function broken( { return 1; }');
    expect(syn.diagnostics.length).toBeGreaterThan(0);
  });

  it('超长源码 → 跳过类型检查（program=null，不误报）', () => {
    const huge = 'var x = 1;\n'.repeat(12000); // > 100KB
    const res = typeCheck(huge);
    expect(res.program).toBeNull();
    expect(res.diagnostics.length).toBe(0);
  });
});

describe('检测器集成 — registerSoftwareAstTscAdapters + ruleEnforcementCheck', () => {
  function activate(ids: string[]) {
    registerSoftwareAstTscAdapters();
    for (const id of ids) RuleRegistry.setStatus(id, 'active');
    return RuleRegistry.getActiveRules('software');
  }

  it('no-var-ast：var 命中；const/let 不命中', () => {
    const rules = activate(['no-var-ast']);
    const hit = ruleEnforcementCheck(makeProposal('var x = 1;'), rules);
    expect(hit.hasError).toBe(true);
    expect(hit.violations[0].ruleId).toBe('no-var-ast');
    const clean = ruleEnforcementCheck(makeProposal('const x = 1;'), rules);
    expect(clean.hasError).toBe(false);
  });

  it('no-eval-call：裸 eval 命中；foo.eval() 成员访问不命中', () => {
    const rules = activate(['no-eval-call']);
    const hit = ruleEnforcementCheck(makeProposal('eval("x");'), rules);
    expect(hit.hasError).toBe(true);
    expect(hit.violations[0].ruleId).toBe('no-eval-call');
    const member = ruleEnforcementCheck(makeProposal('foo.eval();'), rules);
    expect(member.hasError).toBe(false);
  });

  it('tsc-type-check：类型错误命中；干净代码不命中', () => {
    const rules = activate(['tsc-type-check']);
    const hit = ruleEnforcementCheck(makeProposal('const x: number = "str";'), rules);
    expect(hit.hasError).toBe(true);
    expect(hit.violations[0].ruleId).toBe('tsc-type-check');
    const clean = ruleEnforcementCheck(makeProposal('const x: number = 42;'), rules);
    expect(clean.hasError).toBe(false);
  });
});

describe('修正闭环（检测命中 → applyStructuralCorrection → recheck）', () => {
  function activate(ids: string[]) {
    registerSoftwareAstTscAdapters();
    for (const id of ids) RuleRegistry.setStatus(id, 'active');
    return RuleRegistry.getActiveRules('software');
  }

  it('no-var-ast → tsc 修正器 var→const → recheck 放行', async () => {
    const rules = activate(['no-var-ast']);
    const proposal = makeProposal('var x = 1;\nvar y = 2;\ny = 3;');
    const first = ruleEnforcementCheck(proposal, rules);
    expect(first.hasError).toBe(true);

    const fixed = await applyStructuralCorrection(proposal, first.violations, rules);
    expect(fixed.correctedCount).toBeGreaterThan(0);
    expect(fixed.proposal.payload).toContain('const x = 1;');
    expect(fixed.proposal.payload).toContain('let y = 2;');

    const recheck = ruleEnforcementCheck(fixed.proposal, rules);
    expect(recheck.hasError).toBe(false);
  });

  it('tsc-type-check：可机械修的 var 修正 + 不可修的类型错误以 note 报告（recheck 仍违规 → 升级路径）', async () => {
    const rules = activate(['tsc-type-check']);
    // `var` 不是类型错误（tsc 接受 var）——此用例验证：类型错误场景下修正器不误伤、note 报告剩余
    const proposal = makeProposal('const n: number = "str";');
    const first = ruleEnforcementCheck(proposal, rules);
    expect(first.hasError).toBe(true);

    const fixed = await applyStructuralCorrection(proposal, first.violations, rules);
    expect(fixed.correctedCount).toBe(0); // 无 var 可修
    // 注：correctedCount=0 时 core 不收集修正器 note（信息经违规 matchedText 传给 LLM 重试路径）

    // recheck 仍违规（类型错误不可机械修）→ 升级 LLM 重试路径
    const recheck = ruleEnforcementCheck(fixed.proposal, rules);
    expect(recheck.hasError).toBe(true);
    expect(recheck.violations[0].matchedText).toContain('number'); // 违规携带类型错误消息
  });

  it('var + 类型错误混合：var 修正（correctedCount>0）→ note 报告剩余类型错误', async () => {
    const rules = activate(['tsc-type-check']);
    const proposal = makeProposal('var x = 1;\nconst n: number = "str";');
    const first = ruleEnforcementCheck(proposal, rules);
    expect(first.hasError).toBe(true);

    const fixed = await applyStructuralCorrection(proposal, first.violations, rules);
    expect(fixed.correctedCount).toBeGreaterThan(0);
    expect(fixed.proposal.payload).toContain('const x = 1;');
    expect(fixed.notes.join(' ')).toContain('tsc 剩余');
  });

  it('no-eval-call：无机械修正器 → correctedCount=0（升级 LLM 重试路径，不静默放行）', async () => {
    const rules = activate(['no-eval-call']);
    const proposal = makeProposal('eval("x");');
    const first = ruleEnforcementCheck(proposal, rules);
    expect(first.hasError).toBe(true);

    const fixed = await applyStructuralCorrection(proposal, first.violations, rules);
    expect(fixed.correctedCount).toBe(0);
    const recheck = ruleEnforcementCheck(fixed.proposal, rules);
    expect(recheck.hasError).toBe(true); // 不静默放行
  });
});
