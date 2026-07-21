/**
 * WebAdapter — Web 渠道适配器（被动式）
 *
 * Phase 2 / MorPex v8: 为现有 Web 前端提供 ChannelAdapter 实现。
 *
 * 适配器类型：被动式（Passive）
 *   不启动 HTTP 服务，而是由 StudioServer 通过 receiveMessage() 注入消息。
 *   StudioServer 的 Express 路由接收 HTTP 请求后，调用 WebAdapter.receiveMessage() 转发。
 *
 * 消息流：
 *   Browser → POST /api/chat/message → StudioServer
 *     → WebAdapter.receiveMessage(msg) → MessageGateway.receive(msg)
 *       → EventBus.emit(USER_MESSAGE) → MessageHandler → OutgoingMessage
 *         → EventBus.onProjected → SSE → Browser
 */

import type { IncomingMessage, OutgoingMessage, ChannelAdapter } from '../types.js';

/**
 * WebAdapter — Web 渠道适配器
 *
 * 不启动服务，仅提供桥接方法供 StudioServer 调用。
 */
export class WebAdapter implements ChannelAdapter {
  readonly name = 'web';

  /** 已注册的消息处理函数列表 */
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];

  /** 适配器运行状态 */
  private _running = false;

  /**
   * 启动适配器（被动式，仅标记运行状态）
   */
  async start(): Promise<void> {
    this._running = true;
    console.log('[WebAdapter] ✅ 已就绪（被动模式）');
  }

  /**
   * 停止适配器（清理 handlers）
   */
  async stop(): Promise<void> {
    this._running = false;
    this.messageHandlers = [];
    console.log('[WebAdapter] 已停止');
  }

  /**
   * 注册入站消息处理函数
   *
   * 当 StudioServer 通过 receiveMessage() 注入消息时，
   * 调用此 handler。
   *
   * @param handler - 消息处理函数
   */
  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 发送出站消息
   *
   * Web 渠道的出站消息通过 EventBus.onProjected → SSE 推送到前端，
   * 因此这里不做实际发送（由 StudioServer 的 SSE 机制处理）。
   *
   * @param msg - 出站消息
   */
  async sendMessage(msg: OutgoingMessage): Promise<void> {
    // Web 渠道的出站消息通过 EventBus SSE 机制推送
    // 不需要在此额外处理
    if (!this._running) return;
  }

  /**
   * receiveMessage — 由 StudioServer 调用的消息注入入口
   *
   * StudioServer 收到 HTTP 请求后，构造 IncomingMessage 并调用此方法。
   * 此方法将消息分发给所有已注册的 handler（即 MessageGateway）。
   *
   * @param msg - 来自 Web 前端的入站消息
   */
  receiveMessage(msg: IncomingMessage): void {
    if (!this._running) {
      console.warn('[WebAdapter] 未启动，忽略消息');
      return;
    }

    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[WebAdapter] handler 处理失败:', (err as Error).message);
      }
    }
  }

  /**
   * 获取运行状态
   */
  get running(): boolean {
    return this._running;
  }
}
