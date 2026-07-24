/**
 * AgentTransport — Agent 传输层
 *
 * 模拟本地传输，接口设计为未来支持 gRPC / WebSocket。
 * v9.2: 本地内存传输，已预留 gRPC/WS 接口。
 */

import type { RemoteNode, TransportType, TransportMessage, NodeStatus } from './types.js'

export class AgentTransport {
  private nodes = new Map<string, RemoteNode>()
  private messages: TransportMessage[] = []
  private simulatedLatencyMs = 0

  /**
   * registerNode — 注册节点
   */
  registerNode(node: RemoteNode): void {
    const existing = this.nodes.get(node.nodeId)
    if (existing) {
      Object.assign(existing, node, { lastHeartbeat: Date.now() })
    } else {
      this.nodes.set(node.nodeId, { ...node, lastHeartbeat: Date.now() })
    }
  }

  /**
   * unregisterNode — 注销节点
   */
  unregisterNode(nodeId: string): boolean {
    return this.nodes.delete(nodeId)
  }

  /**
   * getNode — 获取节点信息
   */
  getNode(nodeId: string): RemoteNode | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * listNodes — 列出所有节点
   */
  listNodes(): RemoteNode[] {
    return [...this.nodes.values()]
  }

  /**
   * sendMessage — 发送传输消息
   *
   * 本地节点间直接传递，远程节点间模拟发送。
   */
  async sendMessage(msg: TransportMessage): Promise<boolean> {
    if (this.simulatedLatencyMs > 0) {
      await new Promise(r => setTimeout(r, this.simulatedLatencyMs))
    }

    const fromNode = this.nodes.get(msg.fromNode)
    const toNode = this.nodes.get(msg.toNode)

    if (!fromNode) return false

    // 本地传输：目标节点不需要在线即可发送（消息入队）
    this.messages.push(msg)

    // 如果目标节点在线，标记送达
    if (toNode && toNode.status === 'online') {
      return true
    }

    // 目标节点离线，消息缓存
    return true
  }

  /**
   * broadcast — 广播消息到所有在线节点
   */
  broadcast(fromNode: string, type: TransportMessage['type'], payload: unknown): void {
    for (const node of this.nodes.values()) {
      if (node.nodeId !== fromNode && node.status === 'online') {
        this.sendMessage({
          id: `broadcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          fromNode,
          toNode: node.nodeId,
          type,
          payload,
          timestamp: Date.now(),
        })
      }
    }
  }

  /**
   * getMessagesForNode — 获取发往指定节点的消息
   */
  getMessagesForNode(nodeId: string): TransportMessage[] {
    return this.messages.filter(m => m.toNode === nodeId)
  }

  /**
   * simulateLatency — 设置模拟延迟
   */
  simulateLatency(latencyMs: number): void {
    this.simulatedLatencyMs = latencyMs
  }

  /**
   * getStats — 获取传输统计
   */
  getStats(): { nodeCount: number; onlineCount: number; messageQueue: number } {
    return {
      nodeCount: this.nodes.size,
      onlineCount: [...this.nodes.values()].filter(n => n.status === 'online').length,
      messageQueue: this.messages.length,
    }
  }
}
