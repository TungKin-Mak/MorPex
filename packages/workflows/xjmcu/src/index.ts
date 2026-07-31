/**
 * XJMCU Workflow — 矽杰微 XJ MCU 固件开发插件（理想架构第 9 层）
 *
 * ActionPrimitive 标准实现 + 兼容旧 run(ctx, i) 动态导入。
 */
export { XJMcuCompileAction } from './actions/compile.js';
export { XJMcuGenerateAction } from './actions/generate.js';
export { XJMcuPipelineAction } from './actions/pipeline.js';
export { bootstrapXJMcuWorkflow } from './bootstrap.js';

/**
 * 兼容旧调用路径：run(ctx, i) 动态导入 ./actions/<action>.js
 * action 支持：generate | compile | pipeline
 */
export async function run(ctx: any, i: any): Promise<any> {
  const a = i.action || 'pipeline';
  const m = await import(`./actions/${a}.js`);
  if (m.default) return m.default(ctx, i);
  if (m.handler) return m.handler(ctx, i);
  return { success: false, error: `xjmcu: unknown action "${a}"` };
}

export default run;
