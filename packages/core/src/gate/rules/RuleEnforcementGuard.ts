/**
 * gate/rules/RuleEnforcementGuard — 规则执行器（纯函数，可单测）
 *
 * 功能② 核心：对 LLM 输出（OntologyProposal）做确定性规则匹配。
 * 设计约束：
 *   - 纯函数：不持有 LLM / piBridge / eventStore —— 重试编排在 runOntologyGroundedReasoning 管道
 *   - 默认 no-op：rules 为空 → 返回空违规（不改变任何现有行为）
 *   - 只检查 status='active' 且 ruleType='regex' 的规则（semantic 留 Phase 3）
 *
 * 匹配语义（与 normalize.ts 一致）：
 *   - target 文本经规范化（NFKC+小写+去空白）后匹配
 *   - disallowedPattern 规范化后作正则（隐含不区分大小写、无空白）
 *   - aliases 规范化后精确包含匹配
 */

import type { OntologyProposal } from '../types.js';
import type { RuleCheckResult, RuleEntity, RuleTarget, RuleViolation } from './types.js';
import { normalizePattern, normalizeText } from './normalize.js';

/**
 * check — 对 proposal 执行规则匹配
 *
 * @param proposal LLM 输出的 proposal（normalizeProposal 之后）
 * @param rules    规则集（通常来自 RuleRegistry.getActiveRules()）
 * @returns RuleCheckResult { violations, hasError, downgradedRuleIds }
 */
export function check(proposal: OntologyProposal, rules: RuleEntity[]): RuleCheckResult {
  const violations: RuleViolation[] = [];
  if (rules.length === 0) {
    return { violations, hasError: false, downgradedRuleIds: [] };
  }

  // 按 priority 降序（越大越先匹配）
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sorted) {
    if (rule.status !== 'active') continue;
    if (rule.ruleType !== 'regex') continue; // semantic 留 Phase 3

    const text = extractTargetText(proposal, rule.target);
    if (!text) continue;

    const matched = matchText(normalizeText(text), rule);
    if (matched) {
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        matchedText: matched,
        target: rule.target,
        description: rule.description,
      });
    }
  }

  return {
    violations,
    hasError: violations.some((v) => v.severity === 'ERROR'),
    downgradedRuleIds: [],
  };
}

/** extractTargetText — 按 target 提取 proposal 的检查文本 */
function extractTargetText(proposal: OntologyProposal, target: RuleTarget): string {
  switch (target) {
    case 'proposal.payload': {
      const p = proposal.payload ?? proposal.proposal;
      if (typeof p === 'string') return p;
      if (p !== undefined && p !== null) return JSON.stringify(p);
      return '';
    }
    case 'proposal.action_type':
      return proposal.action_type ?? '';
    case 'proposal.raw':
      if (typeof proposal.raw === 'string') return proposal.raw;
      return proposal.raw ? JSON.stringify(proposal.raw) : '';
  }
}

/**
 * matchText — 对规范化文本执行匹配（正则 + 别名）
 *
 * @returns 命中的规范化片段；未命中返回 null
 */
function matchText(normText: string, rule: RuleEntity): string | null {
  // 1. aliases 精确包含（规范化后）
  for (const alias of rule.aliases ?? []) {
    const normAlias = normalizeText(alias);
    if (normAlias && normText.includes(normAlias)) return normAlias;
  }

  // 2. disallowedPattern 正则（规范化后 + 'i' 防御）
  if (rule.disallowedPattern) {
    try {
      const re = new RegExp(normalizePattern(rule.disallowedPattern), 'i');
      const m = normText.match(re);
      if (m && m[0]) return m[0];
    } catch {
      // 非法正则 → 跳过该规则（防误伤），不硬崩
    }
  }

  return null;
}
