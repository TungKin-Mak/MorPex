/**
 * ontology — 轻量本体层
 *
 * 迭代1：
 *   - OntologyService：包装现有 MetadataGraph
 *   - ForcedQueryGuard：代码级强制查询守卫
 *   - types：类型定义
 *
 * 迭代2：
 *   - ObjectTypeRegistry：类型注册与校验
 *   - objectTypes：核心 Object Types 定义
 *   - projectors：从现有数据投影到 Ontology
 *   - runOntologyGroundedReasoning：共享推理方法
 */

export * from './types.js';
export { OntologyService } from './OntologyService.js';
export { ForcedQueryGuard } from './ForcedQueryGuard.js';
export type { TraceEventCallback } from './ForcedQueryGuard.js';
export { ObjectTypeRegistry } from './ObjectTypeRegistry.js';
export { CORE_OBJECT_TYPES, CORE_RELATIONS, DEFAULT_SCHEMAS } from './objectTypes.js';
export type { CoreObjectType, CoreRelationType, ObjectTypeSchema } from './objectTypes.js';
export { MissionProjector, ArtifactProjector } from './projectors/index.js';
export { runOntologyGroundedReasoning } from './runOntologyGroundedReasoning.js';
export type { GroundedReasoningOptions, GroundedReasoningResult } from './runOntologyGroundedReasoning.js';

// ── 迭代3 ──
export { FeedbackService } from './FeedbackService.js';
export type { FeedbackInput } from './FeedbackService.js';
export { bootstrapFromWorkflowDocs } from './bootstrapFromDocs.js';
export type { BootstrapFromDocsOptions, BootstrapExtraction } from './bootstrapFromDocs.js';
