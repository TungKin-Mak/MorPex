/**
 * Runtime Federation — 导出入口
 *
 * MorPex v10 Phase 5: 导出所有公共类型、类和工厂函数。
 */

export { FederationManager } from './federation-manager.js';
export { NodeIdentity } from './node-identity.js';
export { RemoteExecutor } from './remote-executor.js';
export { CapabilityDiscovery } from './capability-discovery.js';

export type {
  FederationIdentity,
  FederationNode,
  FederationRole,
  FederationStatus,
  FederationConfig,
  NodeStatus,
  TransportType,
  RemoteExecutionRequest,
  RemoteExecutionResponse,
  RemoteExecutionStatus,
  CapabilityDiscoveryResult,
  CapabilitySnapshot,
} from './types.js';
