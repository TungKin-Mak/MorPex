/**
 * RemoteAgentProxy — 远程 Agent 代理
 *
 * Proxy 模式：远程 Agent 的本地调用看起来像本地调用。
 */

import { AgentTransport } from './AgentTransport.js'
import type { TransportMessage } from './types.js'

export class RemoteAgentProxy {
  constructor(
    private targetNodeId: string,
    private agentId: string,
    private transport: AgentTransport
  ) {}

  /**
   * request — 发送请求到远程 Agent 并等待响应
   */
  async request(action: string, payload: unknown, timeout: number = 30000): Promise<unknown> {
    const msg: TransportMessage = {
      id: `proxy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fromNode: 'local',
      toNode: this.targetNodeId,
      type: 'task_request',
      payload: { action, payload, targetAgent: this.agentId },
      timestamp: Date.now(),
    }

    await this.transport.sendMessage(msg)

    // 模拟等待远程处理
    await new Promise(r => setTimeout(r, 100))

    return { success: true, message: `Request sent to ${this.agentId} on ${this.targetNodeId}` }
  }

  /**
   * heartbeat — 检查远程 Agent 是否在线
   */
  async heartbeat(): Promise<boolean> {
    const node = this.transport.getNode(this.targetNodeId)
    if (!node) return false

    const timeSinceHeartbeat = Date.now() - node.lastHeartbeat
    return timeSinceHeartbeat < 30000 && node.status === 'online'
  }

  /**
   * getStatus — 获取远程状态
   */
  async getStatus(): Promise<{ online: boolean; latency: number }> {
    const node = this.transport.getNode(this.targetNodeId)
    if (!node) return { online: false, latency: 0 }

    return {
      online: node.status === 'online',
      latency: node.latency,
    }
  }
}
