// L3 Ontology Gate 强制知识防火墙层
export { ForcedQueryGuard } from './ForcedQueryGuard.js';
export type { TraceEventCallback } from './ForcedQueryGuard.js';
export { runOntologyGroundedReasoning } from './runOntologyGroundedReasoning.js';
export type { GroundedReasoningOptions, GroundedReasoningResult } from './runOntologyGroundedReasoning.js';
export * from './types.js';
export { createQueryPerformedEvent, createQueryMissEvent, createReferenceValidationFailedEvent } from './ontologyEvents.js';
export type { OntologyQueryMissEvent, OntologyQueryPerformedEvent, OntologyReferenceValidationFailedEvent } from './ontologyEvents.js';
// v18: Model-Visible 宣言（运行时不变量：凡进模型上下文者必可从持久化点重建）
export {
  assertModelVisibleLogged,
  reconstructContext,
  composeResolvers,
  contextPersistenceResolver,
  deblackboxResolver,
  createContextPackageEntry,
  createDeblackboxEntry,
  encodeContextSnapshotKey,
  parseContextSnapshotKey,
  encodeDeblackboxKey,
  parseDeblackboxKey,
  ModelVisibleNotLoggedError,
} from './modelVisibleLog.js';
export type {
  ModelVisibleEntry,
  ModelVisibleKind,
  ModelVisibleResolved,
  ModelVisibleResolver,
} from './modelVisibleLog.js';
// 功能②：规则中断更正（RuleEnforcementGuard）
export * from './rules/index.js';
