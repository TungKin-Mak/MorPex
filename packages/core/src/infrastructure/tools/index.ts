/**
 * tools — 动态工具层
 *
 *   ToolFactory → 动态生成工具
 *   ToolRegistry → 工具注册与统计
 *   DomainPrimitiveRegistry → 通用原语注册与匹配
 *   primitives/ → 5 个领域无关的基础原语
 */

export { ToolRegistry } from './ToolRegistry.js';
export type { ToolSchema, RegisteredTool } from './ToolRegistry.js';

export { ToolFactory } from './ToolFactory.js';
export type { ToolGenContext } from './ToolFactory.js';

export { DomainPrimitiveRegistry } from './DomainPrimitiveRegistry.js';
export type { PrimitiveRegistration, PrimitiveMatchResult, PrimitiveStats } from './DomainPrimitiveRegistry.js';

// ── 通用基础原语（领域无关）──
export {
  KnowledgeQueryPrimitive,
  FileOperationPrimitive,
  ArtifactGenerationPrimitive,
  ShellExecutionPrimitive,
  APICallPrimitive,
} from './primitives/index.js';
export type {
  ActionPrimitive,
  ActionResult,
  KnowledgeQuery,
  KnowledgeQueryResult,
  FileOperationRequest,
  ArtifactGenerationRequest,
  ArtifactGenerationResult,
  APICallRequest,
  ShellExecutionRequest,
} from './primitives/index.js';

export { ontologyToolDefinitions, createOntologyToolExecutor } from './ontologyTools.js';

// ── 安全执行工具（防御性模式：凭据清洗 / 正交结果 / 私有临时路径；secureExec 本体在 common/）──
export { scrubEnv, runCommand, makePrivateTempDir, randomPrivateFilePath, writeExclusive, cleanupTempDir } from '../common/secureExec.js';
export type { ExecOutcome, RunCommandOptions } from '../common/secureExec.js';
export { scrubExecutorEnv } from './primitives/index.js';
