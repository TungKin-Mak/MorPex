/**
 * Execution — v11 Execution Plane + Phase 2 统一引擎
 *
 * @packageDocumentation
 */

export { ExecutionFabric } from './fabric/index.js';
export type {
  AgentCapability,
  CapabilityResolution,
  ExecutionFabricConfig,
} from './fabric/index.js';

export { SubAgentFork } from './SubAgentFork.js';
export type {
  SubAgentTask,
  SubAgentFleet,
  SubAgentStatus,
  FleetStatus,
  FleetStats,
  SubAgentForkConfig,
  ConnectorRegistryLike,
} from './SubAgentFork.js';

export { UnifiedExecutionEngine } from './UnifiedExecutionEngine.js';
export type {
  ExecutionMode,
  ExecutionStatus,
  ExecutionRequest,
  ExecutionResult,
  EngineHealth,
  DAGRuntimeLike,
  OrchestratorAgentLike,
} from './UnifiedExecutionEngine.js';

// ── 团队编排（L5：原 organization/ 归位）──
export { DynamicTeamOrchestrator } from './DynamicTeamOrchestrator.js';
export { TeamBuilder } from './TeamBuilder.js';
export { AgentAllocator } from './AgentAllocator.js';
export { DependencyCoordinator } from './DependencyCoordinator.js';
export type { DynamicTeam, TeamMember, DependencyGraph, TeamSpec } from './types.js';
