/**
 * DistributedRuntimeManager — 分布式运行时管理器
 *
 * 顶层编排器：管理节点连接、心跳检测、网络拓扑。
 */

import { AgentTransport } from './AgentTransport.js'
import type { NodeStatus, RemoteNode, TransportType } from './types.js'

export class DistributedRuntimeManager {
  private transport: AgentTransport
  private localNodeId: string
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private missedHeartbeats = new Map<string, number>()

  constructor(localNodeId: string, transport?: AgentTransport) {
    this.localNodeId = localNodeId
    this.transport = transport ?? new AgentTransport()
  }

  /**
   * start — 启动心跳检测循环
   */
  start(intervalMs: number = 5000): void {
    // 注册本地节点
    this.transport.registerNode({
      nodeId: this.localNodeId,
      address: 'local',
      transport: 'local',
      status: 'online',
      capabilities: [],
      connectedAgents: [],
      lastHeartbeat: Date.now(),
      latency: 0,
    })

    // 开始心跳广播
    this.heartbeatInterval = setInterval(() => {
      this.transport.broadcast(this.localNodeId, 'heartbeat', {
        nodeId: this.localNodeId,
        timestamp: Date.now(),
      })

      // 检测离线节点
      this.detectOfflineNodes()
    }, intervalMs)
  }

  /**
   * stop — 停止运行时
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * connectRemoteNode — 连接远程节点
   */
  async connectRemoteNode(address: string, transportType: TransportType): Promise<boolean> {
    const node: RemoteNode = {
      nodeId: `remote_${address.replace(/[^a-zA-Z0-9]/g, '_')}`,
      address,
      transport: transportType,
      status: 'online',
      capabilities: [],
      connectedAgents: [],
      lastHeartbeat: Date.now(),
      latency: Math.floor(Math.random() * 100), // 模拟延迟
    }

    this.transport.registerNode(node)
    this.missedHeartbeats.set(node.nodeId, 0)
    return true
  }

  /**
   * disconnectRemoteNode — 断开远程节点
   */
  disconnectRemoteNode(nodeId: string): void {
    this.transport.unregisterNode(nodeId)
    this.missedHeartbeats.delete(nodeId)
  }

  /**
   * getNetworkTopology — 获取网络拓扑
   */
  getNetworkTopology(): RemoteNode[] {
    return this.transport.listNodes()
  }

  /**
   * getStatus — 获取运行时状态
   */
  getStatus(): { localNodeId: string; onlineNodes: number; totalAgents: number } {
    const nodes = this.transport.listNodes()
    let totalAgents = 0
    for (const node of nodes) {
      totalAgents += node.connectedAgents.length
    }

    return {
      localNodeId: this.localNodeId,
      onlineNodes: nodes.filter(n => n.status === 'online').length,
      totalAgents,
    }
  }

  /**
   * getTransport — 获取传输层引用
   */
  getTransport(): AgentTransport {
    return this.transport
  }

  private detectOfflineNodes(): void {
    const now = Date.now()
    for (const node of this.transport.listNodes()) {
      if (node.nodeId === this.localNodeId) continue
      const timeSinceHeartbeat = now - node.lastHeartbeat
      if (timeSinceHeartbeat > 15000) { // 15s 无心跳视为离线
        const missed = this.missedHeartbeats.get(node.nodeId) || 0
        this.missedHeartbeats.set(node.nodeId, missed + 1)

        if (missed >= 2) { // 连续 3 次未收到心跳
          node.status = 'offline'
        }
      }
    }
  }
}
