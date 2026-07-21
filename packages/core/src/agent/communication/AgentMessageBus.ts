/**
 * AgentMessageBus — v9 Agent 消息总线
 *
 * 负责 Agent 间异步通信。
 * 关键约束: Agent A 不能直接调用 Agent B。
 * 所有通信必须通过 MessageBus。
 *
 * 模式:
 *   1. send/receive: 异步推送
 *   2. request/response: 请求-响应模式
 *   3. broadcast: 广播到所有 Agent
 *   4. pub/sub: 按 Agent ID 订阅
 */

import type { AgentMessage, AgentMessageType, AgentResponse } from './AgentMessage.js'

export class AgentMessageBus {
  private queue: AgentMessage[] = []
  private subscribers: Map<string, ((msg: AgentMessage) => void)[]> = new Map()
  private messageHistory: AgentMessage[] = []
  private maxHistory: number

  constructor(maxHistory: number = 1000) {
    this.maxHistory = maxHistory
  }

  /**
   * send — 发送消息到目标 Agent
   */
  send(message: AgentMessage): void {
    this.queue.push(message)
    this.messageHistory.push(message)

    // 限制历史大小
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.splice(0, this.messageHistory.length - this.maxHistory)
    }

    // 通知订阅者
    const handlers = this.subscribers.get(message.to) ?? []
    for (const handler of handlers) {
      try { handler(message) } catch {}
    }
  }

  /**
   * request — 发送请求并等待响应
   */
  request(message: AgentMessage, timeout: number = 30000): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timed out: ${message.id}`))
      }, timeout)

      // 监听响应
      const handler = (response: AgentMessage) => {
        if (response.correlationId === message.id) {
          clearTimeout(timer)
          this.unsubscribe(message.from, handler)
          resolve({
            requestId: response.id,
            from: response.from,
            result: response.payload,
            success: response.type !== 'ERROR',
            error: response.type === 'ERROR' ? String(response.payload.error ?? '') : undefined,
            duration: Date.now() - message.timestamp,
            timestamp: Date.now(),
          })
        }
      }

      this.subscribe(message.from, handler)
      this.send(message)
    })
  }

  /**
   * broadcast — 广播到所有 Agent
   */
  broadcast(from: string, type: AgentMessageType, payload: Record<string, unknown>): void {
    const message: AgentMessage = {
      id: `broadcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from,
      to: '*',
      type,
      payload,
      timestamp: Date.now(),
    }
    this.send(message)
  }

  /**
   * receive — 接收 Agent 的消息
   */
  receive(agentId: string): AgentMessage[] {
    const messages = this.queue.filter(m => m.to === agentId || m.to === '*')
    this.queue = this.queue.filter(m => m.to !== agentId && m.to !== '*')
    return messages
  }

  /**
   * subscribe — 订阅 Agent 的消息
   */
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, [])
    }
    this.subscribers.get(agentId)!.push(handler)
  }

  /**
   * unsubscribe — 取消订阅
   */
  unsubscribe(agentId: string, handler: (msg: AgentMessage) => void): void {
    const handlers = this.subscribers.get(agentId)
    if (handlers) {
      const idx = handlers.indexOf(handler)
      if (idx >= 0) handlers.splice(idx, 1)
    }
  }

  /**
   * getHistory — 获取消息历史
   */
  getHistory(): AgentMessage[] {
    return [...this.messageHistory]
  }

  /**
   * getHistoryBetween — 获取两个 Agent 间的通信历史
   */
  getHistoryBetween(from: string, to: string): AgentMessage[] {
    return this.messageHistory.filter(m => m.from === from && m.to === to)
  }

  /**
   * getStats — 获取消息总线统计
   */
  getStats(): { totalMessages: number; activeSubscribers: number; queueDepth: number } {
    return {
      totalMessages: this.messageHistory.length,
      activeSubscribers: this.subscribers.size,
      queueDepth: this.queue.length,
    }
  }

  /**
   * clear — 清空消息队列
   */
  clear(): void {
    this.queue = []
  }
}
