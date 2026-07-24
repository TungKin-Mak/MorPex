/**
 * Runtime Federation — 类型定义
 *
 * MorPex v10 Phase 5: 联邦运行时类型系统。
 * 联邦使多个 Agent 节点组成集群，支持跨节点身份、远程执行和能力发现。
 */

// ═══════════════════════════════════════════════════════════════
// 联邦角色 & 状态
// ═══════════════════════════════════════════════════════════════

/** 联邦角色 */
export type FederationRole = 'leader' | 'worker' | 'observer';

/** 节点状态 */
export type NodeStatus = 'online' | 'offline' | 'degraded';

/** 传输类型 */
export type TransportType = 'local' | 'grpc' | 'websocket';

// ═══════════════════════════════════════════════════════════════
// 节点身份
// ═══════════════════════════════════════════════════════════════

/** 联邦身份 */
export interface FederationIdentity {
  /** 节点唯一标识 */
  nodeId: string;
  /** 集群名称 */
  clusterName: string;
  /** 联邦角色 */
  role: FederationRole;
  /** 软件版本 */
  version: string;
  /** 公钥（可选，用于身份验证） */
  publicKey?: string;
}

/** 联邦节点 */
export interface FederationNode {
  nodeId: string;
  identity: FederationIdentity;
  status: NodeStatus;
  address: string;
  transport: TransportType;
  capabilities: string[];
  joinedAt: number;
  lastHeartbeat: number;
  metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 远程执行
// ═══════════════════════════════════════════════════════════════

/** 远程执行请求 */
export interface RemoteExecutionRequest {
  targetNodeId: string;
  agentId: string;
  action: string;
  payload: unknown;
  timeout?: number;
}

/** 远程执行响应 */
export interface RemoteExecutionResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  nodeId: string;
}

/** 远程执行状态 */
export interface RemoteExecutionStatus {
  requestId: string;
  status: 'pending' | 'in_flight' | 'completed' | 'failed' | 'timed_out';
  sentAt: number;
  completedAt?: number;
  response?: RemoteExecutionResponse;
}

// ═══════════════════════════════════════════════════════════════
// 能力发现
// ═══════════════════════════════════════════════════════════════

/** 能力发现结果 */
export interface CapabilityDiscoveryResult {
  capability: string;
  nodes: FederationNode[];
  bestNode?: FederationNode;
}

/** 能力发现快照 */
export interface CapabilitySnapshot {
  nodeId: string;
  capabilities: string[];
  discoveredAt: number;
}

// ═══════════════════════════════════════════════════════════════
// 联邦配置
// ═══════════════════════════════════════════════════════════════

/** 联邦配置 */
export interface FederationConfig {
  /** 集群名称 */
  clusterName?: string;
  /** 节点角色 */
  role?: FederationRole;
  /** 心跳间隔（ms） */
  heartbeatInterval?: number;
  /** 能力发现间隔（ms） */
  discoveryInterval?: number;
  /** 是否启用自动发现 */
  enableAutoDiscovery?: boolean;
  /** 节点版本 */
  version?: string;
  /** 共享密钥（用于身份验证） */
  sharedSecret?: string;
}

// ═══════════════════════════════════════════════════════════════
// 联邦状态
// ═══════════════════════════════════════════════════════════════

/** 联邦集群状态 */
export interface FederationStatus {
  clusterName: string;
  localNodeId: string;
  localRole: FederationRole;
  nodes: FederationNode[];
  onlineCount: number;
  totalCapabilities: string[];
  uptime: number;
}
