/**
 * Ecommerce Workflow Bootstrap — 注册 ActionPrimitive（理想架构第 9 层）
 *
 * 由 bootstrapUnified 在启动时调用；幂等（DomainPrimitiveRegistry 覆盖注册）。
 */
import { DomainPrimitiveRegistry } from '@morpex/core';
import { CreateListingAction, UploadImageAction, UpdatePriceAction } from './actions/amazon-primitives.js';
import { registerAmazonRules } from './rules/amazon-rules.js';
import { registerDomainRules } from './rules/rule-register.js';

export async function bootstrapEcommerceWorkflow(_domain = 'ecommerce'): Promise<void> {
  DomainPrimitiveRegistry.registerMultiple([
    new CreateListingAction(),
    new UploadImageAction(),
    new UpdatePriceAction(),
  ]);
  // No Domain Logic in Core：Amazon/e-commerce 质检与合规规则由插件注册
  registerAmazonRules();
  // 功能②：规则中断更正 —— 领域规则注入 core RuleRegistry（L3 Gate 强制执行）
  registerDomainRules();
  console.log('[Workflow:ecommerce] ✅ 插件已就绪（3 个 ActionPrimitive + 领域规则已注册）');
}

export default bootstrapEcommerceWorkflow;
