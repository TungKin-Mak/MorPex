// L3 Ontology Gate 强制知识防火墙层
export { ForcedQueryGuard } from './ForcedQueryGuard.js';
export type { TraceEventCallback } from './ForcedQueryGuard.js';
export { runOntologyGroundedReasoning } from './runOntologyGroundedReasoning.js';
export type { GroundedReasoningOptions, GroundedReasoningResult } from './runOntologyGroundedReasoning.js';
export * from './types.js';
export { createQueryPerformedEvent, createQueryMissEvent, createReferenceValidationFailedEvent } from './ontologyEvents.js';
export type { OntologyQueryMissEvent, OntologyQueryPerformedEvent, OntologyReferenceValidationFailedEvent } from './ontologyEvents.js';
