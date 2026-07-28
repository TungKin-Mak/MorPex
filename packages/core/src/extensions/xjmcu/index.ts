/**
 * XJMCU 工作流插件 — 统一导出
 *
 * 流程:
 *   1. retrieveKnowledge()  — 从记忆系统检索芯片知识
 *   2. buildSystemPrompt()  — 组装 LLM 上下文（知识只来源于记忆系统）
 *   3. generateCode()       — 调用 LLM (PiBridge) 生成代码
 *   4. compile()            — 调用 buildcli 编译 (TODO)
 *   5. verify()             — 调用 astrocli 仿真验证 (TODO)
 */
export { XJMcuWorkflowPlugin, MissingKnowledgeError } from './XJMcuWorkflowPlugin.js';
export type { GenerateCodeOptions, CompileOptions, VerifyOptions } from './XJMcuWorkflowPlugin.js';
