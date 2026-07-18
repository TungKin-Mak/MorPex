/**
 * Prompts — 提示词系统统一出口
 *
 * 三级分封架构（Leader Ring 0 → Expert Ring 1 → Fork Ring 2）
 * 的提示词模板与编译函数。
 *
 * 使用方式：
 *   import { compileLeaderPrompt, compileExpertPrompt, createAstroMTrace } from './prompts/index.js';
 */

export { LEADER_PROMPT_TEMPLATE, compileLeaderPrompt } from './leader-prompt.js';
export { EXPERT_PROMPT_TEMPLATE, compileExpertPrompt } from './expert-prompt.js';
export { createAstroMTrace } from './prompt-types.js';
export type { PromptTemplate, PromptCompileOptions, AstroMTrace } from './prompt-types.js';
