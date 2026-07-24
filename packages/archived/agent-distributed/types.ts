/**
 * Distributed Agent Runtime — 类型定义
 *
 * v9.2: 跨进程/跨机器的 Agent 运行时基础设施。
 */

export type TransportType = 'local' | 'grpc' | 'websocket'
export type NodeStatus = 'online' | 'offline' | 'degraded'

export interface RemoteNode {
  nodeId: string
  address: string
  transport: TransportType
  status: NodeStatus
  capabilities: string[]
  connectedAgents: string[]
  lastHeartbeat: number
  latency: number
}

export interface TransportMessage {
  id: string
  fromNode: string
  toNode: string
  type: 'heartbeat' | 'task_request' | 'task_response' | 'agent_message' | 'sync'
  payload: unknown
  timestamp: number
  correlationId?: string
}

export interface HeartbeatStatus {
  nodeId: string
  status: NodeStatus
  agentCount: number
  load: number
  memoryUsage: number
  timestamp: number
}
