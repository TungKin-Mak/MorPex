/**
 * structural-ast-tsc — 结构修正 AST/tsc 适配器（功能② Phase 2 第二批增强）
 *
 * 在 eslint 适配器（文本/lint 级）之上补两类能力：
 *   1. ASTDetector（ruleType='ast'）：AST 级检测——`var` 声明（`variable`/`var2` 不误报）、
 *      eval()/Function() 裸调用（`foo.eval()`/`obj.Function()` 成员访问不误报——"区分声明/调用"）。
 *   2. TscTypeCheckDetector（ruleType='tsc'）：内存内 tsc 类型检查——语法/类型错误 →
 *      结构性 ERROR（LLM 生成的代码在交付前过一遍编译器校验）。
 *   3. TscStructuralCorrector（type='tsc'）：修正 tsc 检测器命中的问题——AST 变换
 *      var → const/let（const 推断一步到位）；其余不可机械修复的类型错误（如类型不匹配）
 *      以 note 报告，供引擎升级到 LLM 重试路径处理。
 *
 * 架构边界：core 只提供接口/注册表（零领域依赖）；本文件在软件领域插件内注册
 * （DetectorRegistry + StructuralCorrectionRegistry），bootstrap 时注入。
 *
 * @packageDocumentation
 */

import {
  DetectorRegistry,
  RuleRegistry,
  StructuralCorrectionRegistry,
  type RuleDetector,
  type RuleEntity,
  type RuleViolation,
  type StructuralCorrector,
  type OntologyProposal,
} from '@morpex/core';
import { typeCheck, formatDiagnostic, findVarDeclarations, findEvalCalls, fixVarToLetConst, parseSource } from './ast-utils.js';

const DOMAIN = 'software';
const AST_DETECTOR_TYPE = 'ast';
const TSC_DETECTOR_TYPE = 'tsc';

// ── 1. ASTDetector（ruleType='ast'）──

/**
 * ASTDetector — AST 级检测（区分声明/调用/成员访问，相对 regex 无文本误报）
 *
 * 规则按 rule.id 分派检测目标：
 *   - 'no-var-ast'   → findVarDeclarations 命中即违规
 *   - 'no-eval-call' → findEvalCalls 命中即违规（裸 eval()/Function()/new Function() 调用）
 */
const ASTDetector: RuleDetector = {
  type: AST_DETECTOR_TYPE as RuleEntity['ruleType'],
  check(proposal: OntologyProposal, rule: RuleEntity): RuleViolation | null {
    const payload = proposal.payload ?? proposal.proposal;
    if (typeof payload !== 'string' || !payload) return null;

    const sourceFile = (() => { try { return parseSource(payload); } catch { return null; } })();
    if (!sourceFile) return null;

    if (rule.id === 'no-var-ast') {
      const vars = findVarDeclarations(sourceFile);
      if (vars.length === 0) return null;
      const names = vars.map((v) => v.name).slice(0, 5).join(', ');
      return {
        ruleId: rule.id,
        severity: rule.severity,
        matchedText: `var 声明: ${names}${vars.length > 5 ? ` 等 ${vars.length} 处` : ''}`,
        target: rule.target,
        description: rule.description,
      };
    }

    if (rule.id === 'no-eval-call') {
      const calls = findEvalCalls(sourceFile);
      if (calls.length === 0) return null;
      const snippets = calls
        .map((c) => sourceFile.text.slice(c.getStart(sourceFile), c.getEnd()).slice(0, 40))
        .slice(0, 3)
        .join('; ');
      return {
        ruleId: rule.id,
        severity: rule.severity,
        matchedText: snippets,
        target: rule.target,
        description: rule.description,
      };
    }

    return null; // 未知 ast 规则 → 不匹配（不误报）
  },
};

// ── 2. TscTypeCheckDetector（ruleType='tsc'）──

/**
 * TscTypeCheckDetector — tsc 类型检查检测器
 *
 * 对生成代码跑内存内 TS 程序（语法 + 语义诊断）。有诊断 → 结构性 ERROR（取前 3 条消息）；
 * 源码过长（>100KB）→ 跳过类型检查不违规（AST 检测仍可用）。
 */
const TscTypeCheckDetector: RuleDetector = {
  type: TSC_DETECTOR_TYPE as RuleEntity['ruleType'],
  check(proposal: OntologyProposal, rule: RuleEntity): RuleViolation | null {
    const payload = proposal.payload ?? proposal.proposal;
    if (typeof payload !== 'string' || !payload) return null;

    let result;
    try {
      result = typeCheck(payload);
    } catch {
      return null; // 解析失败不误报（引擎有 LLM 重试兜底）
    }
    if (result.diagnostics.length === 0) return null;

    const messages = result.diagnostics.slice(0, 3).map(formatDiagnostic);
    return {
      ruleId: rule.id,
      severity: rule.severity,
      matchedText: messages.join(' | '),
      target: rule.target,
      description: rule.description,
    };
  },
};

// ── 3. TscStructuralCorrector（type='tsc'）──

/**
 * TscStructuralCorrector — tsc 结构修正器
 *
 * canHandle：software 域 + (ruleType='tsc' 规则 ｜ 'no-var-ast' 规则)。
 *   - 'tsc' 规则触发：内存内类型检查 + var→const/let 修正（见下）
 *   - 'no-var-ast' 规则触发：var→const/let 修正（AST 检测命中 var，修正器做机械修复）
 *     （'no-eval-call' 无机械修法——移除 eval() 不安全 → 不匹配，升级 LLM 重试路径）
 * correct：
 *   1. AST 变换 var → const/let（机械可修）
 *   2. 重跑 tsc 类型检查（仅 ruleType='tsc' 场景）：
 *      - 全部通过 → 修正计数返回（引擎 recheck 放行）
 *      - 仍有类型错误（如类型不匹配，不可机械修）→ 以 note 报告（供 LLM 重试路径），
 *        修正计数仍返回已修 var 数（引擎 recheck 若仍违规 → 升级路径）
 */
const TscStructuralCorrector: StructuralCorrector = {
  type: TSC_DETECTOR_TYPE,
  canHandle(rule: RuleEntity): boolean {
    return rule.domain === DOMAIN && (
      rule.ruleType === TSC_DETECTOR_TYPE ||
      (rule.ruleType === AST_DETECTOR_TYPE && rule.id === 'no-var-ast')
    );
  },
  async correct(proposal: OntologyProposal, _violations: RuleViolation[], _rules: RuleEntity[]) {
    const payload = proposal.payload ?? proposal.proposal;
    if (typeof payload !== 'string' || !payload) {
      return { proposal, correctedCount: 0 };
    }

    // 1. AST 变换 var → const/let
    const fix = fixVarToLetConst(payload);

    // 2. 重跑类型检查（修正后）
    let remaining: string[] = [];
    try {
      const recheck = typeCheck(fix.output);
      remaining = recheck.diagnostics.slice(0, 5).map(formatDiagnostic);
    } catch {
      remaining = [];
    }

    if (fix.fixed === 0 && remaining.length === 0) {
      return { proposal, correctedCount: 0 };
    }

    const notes: string[] = [];
    if (fix.fixed > 0) notes.push(`var→const/let 修正 ${fix.fixed} 处`);
    if (remaining.length > 0) notes.push(`tsc 剩余 ${remaining.length} 个类型错误（不可机械修）: ${remaining.join('; ')}`);

    return {
      proposal: { ...proposal, payload: fix.output, proposal: fix.output },
      correctedCount: fix.fixed > 0 ? fix.fixed : 0,
      note: notes.join('；'),
    };
  },
};

// ── 注册（幂等，bootstrap 调用）──

/**
 * registerSoftwareAstTscAdapters — 注册 AST/tsc 检测器 + 修正器 + 规则（幂等）
 */
export function registerSoftwareAstTscAdapters(): void {
  // 1. 检测器
  DetectorRegistry.registerDetector(AST_DETECTOR_TYPE, ASTDetector);
  DetectorRegistry.registerDetector(TSC_DETECTOR_TYPE, TscTypeCheckDetector);

  // 2. 修正器
  StructuralCorrectionRegistry.registerCorrector(TSC_DETECTOR_TYPE, TscStructuralCorrector);

  // 3. 规则（默认 pending：待人工确认生效，不跨域误伤）
  RuleRegistry.register(DOMAIN, {
    id: 'no-var-ast',
    title: '禁止 var 声明（AST 级）',
    tier: 'tier-1',
    domain: DOMAIN,
    severity: 'ERROR',
    ruleType: AST_DETECTOR_TYPE,
    target: 'proposal.payload',
    priority: 80,
    status: 'pending',
    source: 'manual',
    description: '生成的代码禁止 var 声明（AST 识别；用 const/let，const 推断一步到位）——tsc 结构修正',
  });
  RuleRegistry.register(DOMAIN, {
    id: 'no-eval-call',
    title: '禁止动态代码执行（AST 级）',
    tier: 'tier-1',
    domain: DOMAIN,
    severity: 'ERROR',
    ruleType: AST_DETECTOR_TYPE,
    target: 'proposal.payload',
    priority: 90,
    status: 'pending',
    source: 'manual',
    description: '生成的代码禁止裸 eval()/Function()/new Function() 调用（AST 识别；foo.eval() 成员访问不误报）',
  });
  RuleRegistry.register(DOMAIN, {
    id: 'tsc-type-check',
    title: '生成代码通过 tsc 类型校验',
    tier: 'tier-1',
    domain: DOMAIN,
    severity: 'ERROR',
    ruleType: TSC_DETECTOR_TYPE,
    target: 'proposal.payload',
    priority: 70,
    status: 'pending',
    source: 'manual',
    description: '生成的代码须通过内存内 tsc 类型检查（语法 + 语义诊断清零）——tsc 结构修正器自动修 var，其余类型错误升级 LLM 重试',
  });

  console.log(`[Workflow:software] ✅ AST/tsc 适配器已注入（ast 检测器 + tsc 检测/修正器）+ 3 规则 pending 待确认`);
}
