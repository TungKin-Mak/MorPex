/**
 * Domain Module — 领域协议模块入口
 *
 * Phase 8: 领域清单协议 (Domain Manifest Protocol)
 * Phase 9: 动态领域空间 (Dynamic Domain Clusters)
 */

// ── Phase 8: Domain Manifest Protocol ──
export { DomainManifestLoader } from './DomainManifestLoader.js';
export type {
  // Domain Manifest
  DomainManifest,
  MasterAgentConfig,
  ArtifactSpec,
  WakeConditions,

  // Validation
  ValidationResult,
  ValidationError,

  // Cluster
  ClusterStatus,

  // Cross-Domain DAG
  TaskDecomposition,
  DecomposedTask,
  DAGNode,

  // Cross-Domain Events
  ArtifactRef,
  DomainTaskCompletedEvent,

  // Negotiation
  TicketStatus,
  ConflictType,
  InterrogationTicket,
  TicketRound,

  // Status Report
  ClusterStatusReport,
} from './types.js';

// ── Phase 9: Dynamic Domain Clusters ──
export { DomainCluster } from './DomainCluster.js';
export { DomainClusterManager } from './DomainClusterManager.js';
