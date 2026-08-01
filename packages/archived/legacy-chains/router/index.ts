/**
 * Router Module — 跨领域路由模块入口
 */
export { CrossDomainRouter } from './CrossDomainRouter.js';
export { DomainDispatcher } from './DomainDispatcher.js';
export { ArbitrationHandler } from './ArbitrationHandler.js';
export type { NodeResult, DAGExecutionResult } from './DomainDispatcher.js';
export type { LLMCaller } from '../services/LLMProvider.js';
export type { ArbitrationVerdict } from './ArbitrationHandler.js';
export type { RoutingAnalysis } from '../domains/types.js';

// RouterLite (Phase 3 — 精简替代)
export { RouterLite } from './RouterLite.js';
export type { DomainHandler, DomainRoute } from './RouterLite.js';
