/**
 * gate/rules/RuleEnforcementGuard — 规则执行器（纯函数，可单测）
 *
 * 功能② 核心：对 LLM 输出（OntologyProposal）做确定性规则匹配。
 * 设计约束：
 *   - 纯函数：不持有 LLM / piBridge / eventStore —— 重试编排在 runOntologyGroundedReasoning 管道
 *   - 默认 no-op：rules 为空 → 返回空违规（不改变任何现有行为）
 *   - 只检查 status='active' 的规则；按 rule.ruleType 分派到 detectorRegistry
 *     （regex=规范化正则+别名；whitelist=API 白名单前缀；semantic=Phase 3 暂缺）
 *
 * 匹配语义（与 normalize.ts 一致）：
 *   - target 文本经规范化（NFKC+小写+去空白）后匹配
 *   - disallowedPattern 规范化后作正则（隐含不区分大小写、无空白）
 *   - aliases 规范化后精确包含匹配
 */

import type { OntologyProposal } from '../types.js';
import type { RuleCheckResult, RuleEntity, RuleViolation } from './types.js';
import { detectorRegistry } from './detectors.js';
import { DetectorRegistry } from './DetectorRegistry.js';

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

    // 分派：先查 core 内置检测器，再回退领域 DetectorRegistry（Phase 2 自定义检测器）
    let detector = detectorRegistry[rule.ruleType as 'regex' | 'whitelist' | 'semantic'];
    if (!detector) detector = DetectorRegistry.getDetector(rule.ruleType);

    if (!detector) {
      // semantic 等未注册检测器：不匹配（Phase 3 前不硬崩），仅提示一次
      if (rule.ruleType === 'semantic') {
        console.warn(`[RuleEnforcementGuard] ⚠️ ruleType='semantic' 检测器未注册（Phase 3），规则 ${rule.id} 跳过`);
      } else {
        console.warn(`[RuleEnforcementGuard] ⚠️ ruleType='${rule.ruleType}' 检测器未注册，规则 ${rule.id} 跳过（领域需先 DetectorRegistry.registerDetector）`);
      }
      continue;
    }

    const violation = detector.check(proposal, rule);
    if (violation) violations.push(violation);
  }

  return {
    violations,
    hasError: violations.some((v) => v.severity === 'ERROR'),
    downgradedRuleIds: [],
  };
}
