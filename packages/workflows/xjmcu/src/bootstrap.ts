/**
 * XJMCU Workflow Bootstrap — 注册 ActionPrimitive（理想架构第 9 层）
 *
 * 由 bootstrapUnified 在启动时调用；幂等（DomainPrimitiveRegistry 覆盖注册）。
 */
import { DomainPrimitiveRegistry } from '@morpex/core';
import { XJMcuCompileAction } from './actions/compile.js';
import { XJMcuGenerateAction } from './actions/generate.js';
import { XJMcuPipelineAction } from './actions/pipeline.js';
import { XJMcuSimulateAction } from './actions/simulate.js';
import { registerPlatformRules } from './rules/platform-rule.js';

export async function bootstrapXJMcuWorkflow(_domain = 'xjmcu'): Promise<void> {
  DomainPrimitiveRegistry.registerMultiple([
    new XJMcuGenerateAction(),
    new XJMcuCompileAction(),
    new XJMcuSimulateAction(),
    new XJMcuPipelineAction(),
  ]);
  // 功能②：平台 API 白名单规则注入 core RuleRegistry（L3 Gate 强制执行）
  registerPlatformRules();
  console.log('[Workflow:xjmcu] ✅ 插件已就绪（4 个 ActionPrimitive + 平台规则已注册）');
}

/**
 * MCP 桥接说明（四件套之 MCP）：
 *   - 引擎内路径：YamlWorkflowRuntime 经 DomainPrimitiveRegistry.execute('xjmcu.compile'/'xjmcu.simulate')
 *     直接命中上方注册的 ActionPrimitive——零改动，无需经 MCP 网络层。
 *   - 外部 Agent 路径：packages/workflows/xjmcu/src/mcp/server.ts 以 stdio JSON-RPC
 *     暴露 xjmcu_compile / xjmcu_simulate 两工具，内部调用同一批 Action（单一真相源）。
 *   - 反向桥接（外部 MCP Server → Registry）待多工具链接入时再实现，当前无消费方。
 */

export default bootstrapXJMcuWorkflow;
