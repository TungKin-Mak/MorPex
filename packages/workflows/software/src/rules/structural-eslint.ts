/**
 * Software 领域结构修正器示例（功能② Phase 2 第二批 — 修正管线②结构层）
 *
 * 演示"领域注入结构修正器"：
 *   - core 只提供 StructuralCorrector 接口 + StructuralCorrectionRegistry 注册机制（零领域依赖）
 *   - 领域在 bootstrap 时 registerCorrector + RuleRegistry.register 规则（ruleType='eslint'）
 *   - runOntologyGroundedReasoning 词法修正后自动挂载：修正 → 重新 check → 合规放行
 *
 * EsLintStructuralCorrector：对生成的代码跑 eslint Linter.verifyAndFix（--fix 式），
 * 机械修复 no-var/prefer-const 等安全规则；修复后产出修正计数供引擎重检。
 * 完整 AST 区分声明/调用、tsc 类型校验适配器为后续增强（依赖解析已验证：eslint 9 flat config）。
 */

import { Linter } from 'eslint';
import {
  StructuralCorrectionRegistry,
  RuleRegistry,
  type StructuralCorrector,
  type RuleEntity,
  type RuleViolation,
  type OntologyProposal,
} from '@morpex/core';

const DOMAIN = 'software';

/** eslint 规则映射：规则 id → eslint flat config（verifyAndFix 用） */
const ESLINT_RULE_CONFIGS: Record<string, { rules: Record<string, unknown> }> = {
  'no-var': { rules: { 'no-var': 'error' } },
  'prefer-const': { rules: { 'prefer-const': 'error' } },
  'no-unused-vars': { rules: { 'no-unused-vars': ['error', { args: 'none' }] } },
};

/** EsLintStructuralCorrector — eslint --fix 式结构修正 */
const EsLintStructuralCorrector: StructuralCorrector = {
  type: 'eslint',
  canHandle(rule: RuleEntity): boolean {
    return rule.domain === DOMAIN && rule.ruleType === 'eslint' && !!ESLINT_RULE_CONFIGS[rule.id];
  },
  async correct(proposal: OntologyProposal, violations: RuleViolation[]): Promise<{ proposal: OntologyProposal; correctedCount: number; note?: string }> {
    const payload = proposal.payload ?? proposal.proposal;
    if (typeof payload !== 'string' || !payload) {
      return { proposal, correctedCount: 0 };
    }

    const linter = new Linter();
    let correctedCount = 0;
    let output = payload;

    for (const v of violations) {
      const cfg = ESLINT_RULE_CONFIGS[v.ruleId];
      if (!cfg) continue;
      try {
        // eslint 9 flat config：rules 以对象传入（类型宽松处理，兼容规则配置形态）
        const result = linter.verifyAndFix(
          output,
          [{ languageOptions: { ecmaVersion: 2022 }, rules: cfg.rules } as never],
        );
        if (result.fixed && result.output && result.output !== output) {
          output = result.output;
          correctedCount += 1;
        }
      } catch {
        // 单条规则修正失败不阻断（其余规则继续）
      }
    }

    if (correctedCount === 0) {
      return { proposal, correctedCount: 0 };
    }

    return {
      proposal: { ...proposal, payload: output, proposal: output },
      correctedCount,
      note: `eslint --fix 修正 ${correctedCount} 条规则`,
    };
  },
};

/**
 * registerSoftwareStructuralCorrector — 注册结构修正器 + eslint 规则（幂等，bootstrap 调用）
 */
export function registerSoftwareStructuralCorrector(): void {
  // 1. 注入结构修正器（同 type 覆盖，幂等）
  StructuralCorrectionRegistry.registerCorrector('eslint', EsLintStructuralCorrector);

  // 2. 注册 eslint 规则（默认 pending：待人工确认生效，不跨域误伤）
  RuleRegistry.register(DOMAIN, {
    id: 'no-var',
    title: '禁止 var 声明',
    tier: 'tier-1',
    domain: DOMAIN,
    severity: 'ERROR',
    ruleType: 'eslint',
    target: 'proposal.payload',
    priority: 80,
    status: 'pending',
    source: 'manual',
    description: '生成的代码禁止使用 var（用 let/const）——eslint no-var 结构修正',
  });

  console.log(`[Workflow:software] ✅ 结构修正器已注入（eslint）+ 规则 pending 待确认`);
}
