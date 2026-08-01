/**
 * AgentMessage — v9 Agent 通信协议
 *
 * Agent 间禁止直接调用，必须通过 MessageBus。
 * 所有通信通过消息进行。
 */

export type AgentMessageType = 'REQUEST' | 'RESULT' | 'NEGOTIATE' | 'BROADCAST' | 'HEARTBEAT' | 'ERROR'

export interface AgentMessage {
  id: string
  from: string
  to: string
  type: AgentMessageType
  payload: Record<string, unknown>
  correlationId?: string
  timestamp: number
  ttl?: number               // time-to-live in ms
}

export interface AgentResponse {
  requestId: string
  from: string
  result: unknown
  success: boolean
  error?: string
  duration: number
  timestamp: number
}
