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
