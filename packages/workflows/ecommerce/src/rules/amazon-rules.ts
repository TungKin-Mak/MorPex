/**
 * Ecommerce 领域合规规则（理想架构第 9 层 — No Domain Logic in Core）
 *
 * 从 core `verification/QualityRule` / `verification/PolicyRuleRegistry`
 * 迁移而来的 Amazon / e-commerce 专属质检与合规规则。
 * core 仅保留通用注册机制（QualityRule / PolicyRuleRegistry 基础设施）。
 */

import { QualityRule, PolicyRuleRegistry } from '@morpex/core';

/**
 * registerAmazonRules — 注册 Amazon 领域质检与合规规则（幂等）
 *
 * 由 bootstrapEcommerceWorkflow 在启动时调用；core init() 不再播种这些领域规则。
 */
export function registerAmazonRules(): void {
  // ── Amazon Listing 质检规则 ──
  QualityRule.register('amazon_listing', [
    {
      name: 'title_length',
      description: '标题长度 80-200 字符',
      check: async (t: any) => ({ pass: t.title?.length >= 80 && t.title?.length <= 200 }),
    },
    {
      name: 'has_keywords',
      description: '包含关键词',
      check: async (t: any) => ({ pass: !!t.keywords?.length }),
    },
    {
      name: 'has_description',
      description: '有描述',
      check: async (t: any) => ({ pass: !!t.description }),
    },
    {
      name: 'has_price',
      description: '有价格',
      check: async (t: any) => ({ pass: !!t.price }),
    },
  ]);

  // ── e-commerce 合规策略规则 ──
  PolicyRuleRegistry.register('e-commerce', {
    id: 'restricted_category',
    domain: 'e-commerce',
    name: '受限分类检查',
    description: '检查商品是否在 Amazon 受限分类中',
    check: async (t) => ({ pass: !['weapons', 'drugs', 'animals'].includes((t.category as string) || '') }),
    severity: 'ERROR',
  });
  PolicyRuleRegistry.register('e-commerce', {
    id: 'trademark_check',
    domain: 'e-commerce',
    name: '商标检查',
    description: '检查标题/描述是否包含注册商标',
    check: async (t) => ({ pass: !/(TM|®|™)/.test((t.title as string) || '') }),
    severity: 'WARNING',
  });
}
