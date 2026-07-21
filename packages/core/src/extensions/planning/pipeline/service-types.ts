/**
 * service-types.ts — Type aliases for dynamically-injected pipeline services
 *
 * ═══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL ROLE
 *   These services are resolved at runtime from a shared registry.
 *   The call signatures VARY across call sites — some call with
 *   strings, others with objects, some with full configs.
 *
 *   ALL duck-typed services use `any` with eslint-disable because
 *   strictification would require reading every call site and modeling
 *   exact signatures, which is a separate refactoring effort.
 * ═══════════════════════════════════════════════════════════════════
 */

// ── Duck-typed service interfaces ───────────────────────────────

/** KnowledgeGraph — injected at runtime, call signatures vary */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KnowledgeGraphService = any;

/** ArtifactRegistry — injected at runtime, call signatures vary */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArtifactRegistryService = any;

/** VectorStore — injected at runtime, call signatures vary */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VectorStoreService = any;

// ── Dynamic data types ───────────────────────────────────────────

/** LLM-generated JSON — inherently dynamic */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonData = Record<string, any>;

/** A node in a DAG execution graph */
export interface DAGNodeData {
  taskId?: string;
  domain?: string;
  goal?: string;
  deps?: string[];
  status?: string;
  role?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** An execution record from PlanExperienceStore */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ExecutionRecordData {
  recordId?: string;
  id?: string;
  executionId?: string;
  dagNodes?: DAGNodeData[];
  survivalProbability?: number;
  strategy?: string;
  qualityScore?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** An entity from KnowledgeGraph */
export interface EntityData {
  id: string;
  name?: string;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** An artifact from ArtifactRegistry */
export interface ArtifactData {
  id: string;
  name?: string;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}



/** A failure pattern from deviation analysis */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FailurePatternData {
  nodeRole?: string;
  category?: string;
  count?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
