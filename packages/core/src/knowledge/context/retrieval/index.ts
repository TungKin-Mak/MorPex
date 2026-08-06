/**
 * knowledge/context/retrieval — 上下文检索与蒸馏（会话 16i RAG-lazy 装配）
 *
 * @packageDocumentation
 */

export { ContextDistiller } from './ContextDistiller.js';
export type { DistillerLLM, ContextDistillerOptions } from './ContextDistiller.js';
export { ContextRetriever } from './ContextRetriever.js';
export type {
  RelevantContext,
  RelevantContextType,
  RecentTaskRecord,
  RetrieverSources,
} from './ContextRetriever.js';
