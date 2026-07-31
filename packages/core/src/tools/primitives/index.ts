/**
 * primitives — 通用基础原语
 *
 * 所有原语都是领域无关的通用操作。
 * 领域特定逻辑必须通过工作流插件（packages/workflows/）提供。
 *
 * 注册方式：
 *   DomainPrimitiveRegistry.registerMultiple([
 *     new KnowledgeQueryPrimitive(),
 *     new FileOperationPrimitive(),
 *     new ArtifactGenerationPrimitive(),
 *     new ShellExecutionPrimitive(),
 *     new APICallPrimitive(),
 *   ]);
 */

// ── 通用类型（所有原语和工作流插件共用）──
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
} from './types.js';

// ── 通用基础原语 ──
export { KnowledgeQueryPrimitive } from './KnowledgeQueryPrimitive.js';
export { FileOperationPrimitive } from './FileOperationPrimitive.js';
export { ArtifactGenerationPrimitive } from './ArtifactGenerationPrimitive.js';
export { ShellExecutionPrimitive } from './ShellExecutionPrimitive.js';
export { APICallPrimitive } from './APICallPrimitive.js';
