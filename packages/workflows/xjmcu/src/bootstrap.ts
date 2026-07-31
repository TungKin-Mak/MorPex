/**
 * XJMCU Workflow Bootstrap — 注册 ActionPrimitive（理想架构第 9 层）
 *
 * 由 bootstrapUnified 在启动时调用；幂等（DomainPrimitiveRegistry 覆盖注册）。
 */
import { DomainPrimitiveRegistry } from '@morpex/core';
import { XJMcuCompileAction } from './actions/compile.js';
import { XJMcuGenerateAction } from './actions/generate.js';
import { XJMcuPipelineAction } from './actions/pipeline.js';

export async function bootstrapXJMcuWorkflow(_domain = 'xjmcu'): Promise<void> {
  DomainPrimitiveRegistry.registerMultiple([
    new XJMcuGenerateAction(),
    new XJMcuCompileAction(),
    new XJMcuPipelineAction(),
  ]);
  console.log('[Workflow:xjmcu] ✅ 插件已就绪（3 个 ActionPrimitive 已注册）');
}

export default bootstrapXJMcuWorkflow;
