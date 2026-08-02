/**
 * XJMCU Workflow Bootstrap — 注册 ActionPrimitive（理想架构第 9 层）
 *
 * 由 bootstrapUnified 在启动时调用；幂等（DomainPrimitiveRegistry 覆盖注册）。
 */
import { DomainPrimitiveRegistry } from '@morpex/core';
import { XJMcuCompileAction } from './actions/compile.js';
import { XJMcuGenerateAction } from './actions/generate.js';
import { XJMcuPipelineAction } from './actions/pipeline.js';
import { registerPlatformRules } from './rules/platform-rule.js';

export async function bootstrapXJMcuWorkflow(_domain = 'xjmcu'): Promise<void> {
  DomainPrimitiveRegistry.registerMultiple([
    new XJMcuGenerateAction(),
    new XJMcuCompileAction(),
    new XJMcuPipelineAction(),
  ]);
  // 功能②：平台 API 白名单规则注入 core RuleRegistry（L3 Gate 强制执行）
  registerPlatformRules();
  console.log('[Workflow:xjmcu] ✅ 插件已就绪（3 个 ActionPrimitive + 平台规则已注册）');
}

export default bootstrapXJMcuWorkflow;
