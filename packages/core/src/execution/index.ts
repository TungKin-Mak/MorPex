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
  MissionRuntimeLike,
  DAGRuntimeLike,
  ExecutionFabricLike,
} from './UnifiedExecutionEngine.js';
