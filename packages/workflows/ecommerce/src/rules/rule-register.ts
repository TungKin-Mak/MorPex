/**
 * Ecommerce 领域规则中断示例（功能② Phase 1 — No Domain Logic in Core）
 *
 * 规则内容（正则/别名/severity）属于领域逻辑，由插件 bootstrap 注册进 core
 * `RuleRegistry`（core 仅提供机制）。注册后，L3 Gate 的 runOntologyGroundedReasoning
 * 会对每次 LLM 输出执行规则匹配：命中 ERROR → 中断 + 带约束重试。
 *
 * 匹配语义（见 core gate/rules/normalize）：文本与模式均经
 * NFKC（全角→半角）+ 小写 + 去空白 规范化，规则隐含"不区分大小写、无空白"。
 *
 * ⚠️ 状态说明：示例规则默认 status='pending'（待人工确认生效，演示"确认闸"）。
 * pending 规则不参与匹配，因此不会跨域误伤其它领域输出；
 * 确认生效：调用 core rulePersistence.confirmRule(id) 置为 active。
 * （领域规则按 domain 路由为 Phase 2 项，见 docs/FEATURE_RULE_ENFORCEMENT.md §7）
 */

import { RuleRegistry, type RuleEntity } from '@morpex/core';

const DOMAIN = 'ecommerce';

/**
 * registerDomainRules — 注册 e-commerce 领域规则（幂等，由 bootstrap 调用）
 */
export function registerDomainRules(): void {
  const rules: RuleEntity[] = [
    {
      id: 'no_competitor_trademark',
      title: '禁止竞品商标',
      tier: 'tier-1',
      domain: DOMAIN,
      severity: 'ERROR',
      ruleType: 'regex',
      target: 'proposal.payload',
      disallowedPattern: 'Apple|iPhone|AirPods|Samsung|Galaxy',
      aliases: ['苹果手机', '苹果耳机', '三星手机', 'air pods'],
      priority: 100,
      status: 'pending', // 待人工确认生效（演示确认闸）；confirmRule 置 active 才参与匹配
      source: 'manual',
      description: '对外文案禁止出现竞品商标（Apple/iPhone/AirPods/Samsung/Galaxy 及常见代称）',
    },
  ];
  RuleRegistry.registerMany(DOMAIN, rules);
  console.log(`[Workflow:ecommerce] ✅ 规则中断规则已注册（${rules.length} 条，pending 待确认生效）`);
}
