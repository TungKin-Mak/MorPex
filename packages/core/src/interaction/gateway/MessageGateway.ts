/**
 * MessageGateway — 统一消息网关
 *
 * Phase 2 / MorPex v8: 所有外部渠道的单一入口。
 *
 * 职责：
 *   1. 注册 ChannelAdapter（Web/WeChat/Feishu/CLI）
 *   2. 将 IncomingMessage 转换为 EventType.USER_MESSAGE 事件
 *   3. 通过 MessageHandler 路由到下游（Mission Runtime / StudioOrchestrator）
 *   4. 维护活跃会话列表
 *
 * 设计约束：
 *   - 不与任何 Agent 直接耦合（只知 EventBus 和 MessageHandler）
 *   - 禁止直接调用 StudioOrchestrator / SessionManager
 *   - 所有消息处理通过可替换的 MessageHandler 委托
 */

import { EventBus } from '../../common/EventBus.js';
import { EventType } from '../../protocol/events/EventType.js';
import type { BaseEvent } from '../../protocol/events/BaseEvent.js';
import type { IncomingMessage, OutgoingMessage, ChannelAdapter, SessionInfo } from '../types.js';

// ── MessageHandler — 消息处理器委托 ──

/**
 * MessageHandler — 消息处理委托
 *
 * 由上层（如 Mission Runtime 或 StudioServer）注册。
 * Gateway 不关心 handler 内部实现，只负责将 IncomingMessage 委托给它。
 */
export type MessageHandler = (msg: IncomingMessage) => Promise<OutgoingMessage>;

// ── MessageGateway — 消息网关 ──

export class MessageGateway {
  /** EventBus 引用（用于发射事件） */
  private bus: EventBus;

  /** 已注册的 ChannelAdapter（name → adapter） */
  private adapters: Map<string, ChannelAdapter> = new Map();

  /** 消息处理器（由上层注册） */
  private handler: MessageHandler | null = null;

  /** 活跃会话追踪 */
  private sessions: Map<string, SessionInfo> = new Map();

  /** Gateway 运行状态 */
  private _running = false;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * 获取运行状态
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * 获取已注册的适配器名称列表
   */
  get registeredAdapters(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * 获取活跃会话数
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  // ═══════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════

  /**
   * 启动 Gateway
   *
   * 启动所有已注册的 ChannelAdapter。
   */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    // 启动所有适配器
    const errors: Array<{ name: string; error: string }> = [];
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.start();
        console.log(`[MessageGateway] ✅ Adapter "${name}" 已启动`);
      } catch (err) {
        errors.push({ name, error: (err as Error).message });
        console.warn(`[MessageGateway] ⚠️ Adapter "${name}" 启动失败:`, (err as Error).message);
      }
    }

    this.bus.emit({
      id: `evt_gw_start_${Date.now()}`,
      type: EventType.SYSTEM_STARTED,
      timestamp: Date.now(),
      executionId: 'gateway',
      source: 'message-gateway',
      payload: {
        adapters: this.registeredAdapters,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    if (errors.length > 0) {
      console.warn(`[MessageGateway] 启动完成，${errors.length} 个适配器启动失败`);
    } else {
      console.log(`[MessageGateway] ✅ 已启动，${this.adapters.size} 个适配器`);
    }
  }

  /**
   * 停止 Gateway
   *
   * 停止所有 ChannelAdapter，清理会话。
   */
  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    // 停止所有适配器
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.stop();
        console.log(`[MessageGateway] Adapter "${name}" 已停止`);
      } catch (err) {
        console.warn(`[MessageGateway] Adapter "${name}" 停止失败:`, (err as Error).message);
      }
    }

    // 清空会话
    this.sessions.clear();

    this.bus.emit({
      id: `evt_gw_stop_${Date.now()}`,
      type: EventType.SYSTEM_STOPPED,
      timestamp: Date.now(),
      executionId: 'gateway',
      source: 'message-gateway',
      payload: { reason: 'gateway_stopped' },
    });

    console.log(`[MessageGateway] 已停止`);
  }

  // ═══════════════════════════════════════════════════════════
  // 适配器管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 注册 ChannelAdapter
   *
   * 如果 Gateway 已启动，自动启动新注册的适配器。
   *
   * @param adapter - 渠道适配器实例
   */
  registerAdapter(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.name)) {
      console.warn(`[MessageGateway] Adapter "${adapter.name}" 已存在，跳过注册`);
      return;
    }

    // 绑定适配器的消息到 Gateway.receive
    adapter.onMessage((msg) => {
      this.receive(msg).catch((err) => {
        console.error(`[MessageGateway] 处理消息失败:`, (err as Error).message);
      });
    });

    this.adapters.set(adapter.name, adapter);

    // 如果 Gateway 已运行，自动启动
    if (this._running) {
      adapter.start().catch((err) => {
        console.warn(`[MessageGateway] Adapter "${adapter.name}" 启动失败:`, (err as Error).message);
      });
    }

    console.log(`[MessageGateway] ✅ Adapter "${adapter.name}" 已注册`);
  }

  /**
   * 注销 ChannelAdapter
   *
   * @param name - 适配器名称
   */
  unregisterAdapter(name: string): void {
    const adapter = this.adapters.get(name);
    if (!adapter) return;

    if (this._running) {
      adapter.stop().catch(() => {});
    }

    this.adapters.delete(name);
    console.log(`[MessageGateway] Adapter "${name}" 已注销`);
  }

  /**
   * 获取指定名称的 ChannelAdapter
   *
   * @param name - 适配器名称
   */
  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  // ═══════════════════════════════════════════════════════════
  // 消息处理
  // ═══════════════════════════════════════════════════════════

  /**
   * setMessageHandler — 设置消息处理器
   *
   * Gateway 不处理业务逻辑，所有消息委托给此 handler。
   * handler 由上层注册（如 Mission Runtime 或 StudioServer 桥接层）。
   *
   * @param handler - 消息处理函数
   */
  setMessageHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * 清除消息处理器
   */
  clearMessageHandler(): void {
    this.handler = null;
  }

  /**
   * receive — 接收消息并处理
   *
   * 这是 Gateway 的核心方法：
   * 1. 更新或创建会话
   * 2. 发射 USER_MESSAGE 事件
   * 3. 委托给 MessageHandler 处理
   * 4. 返回 OutgoingMessage
   *
   * @param msg - 入站消息（由 ChannelAdapter 产生）
   * @returns 出站消息
   */
  async receive(msg: IncomingMessage): Promise<OutgoingMessage> {
    // 1. 更新会话追踪
    this.trackSession(msg);

    // 2. 发射 USER_MESSAGE 事件
    const userEvent: BaseEvent = {
      id: `evt_user_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: EventType.USER_MESSAGE,
      timestamp: Date.now(),
      executionId: msg.sessionId,
      source: `interaction:${msg.channel}`,
      payload: {
        channel: msg.channel,
        userId: msg.userId,
        sessionId: msg.sessionId,
        content: msg.content,
        metadata: msg.metadata,
      },
    };

    this.bus.emit({
      id: userEvent.id,
      type: userEvent.type,
      timestamp: userEvent.timestamp,
      executionId: userEvent.executionId,
      source: userEvent.source,
      payload: userEvent.payload,
    });

    // 3. 检测 INTENT（基础版本：MISSION_CREATED 事件）
    const intentEvent: BaseEvent = {
      id: `evt_intent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: EventType.INTENT_DETECTED,
      timestamp: Date.now(),
      executionId: msg.sessionId,
      source: 'intent-detector',
      payload: {
        rawContent: msg.content,
        sessionId: msg.sessionId,
        channel: msg.channel,
      },
    };

    this.bus.emit({
      id: intentEvent.id,
      type: intentEvent.type,
      timestamp: intentEvent.timestamp,
      executionId: intentEvent.executionId,
      source: intentEvent.source,
      payload: intentEvent.payload,
    });

    // 4. 委托给 MessageHandler
    if (this.handler) {
      try {
        return await this.handler(msg);
      } catch (err) {
        console.error(`[MessageGateway] MessageHandler 处理失败:`, (err as Error).message);

        const errorResponse: OutgoingMessage = {
          channel: msg.channel,
          userId: msg.userId,
          sessionId: msg.sessionId,
          content: `处理消息时发生错误: ${(err as Error).message}`,
          type: 'error',
          metadata: { error: (err as Error).message },
        };

        // 发射 EXECUTION_FAILED 事件
        this.bus.emit({
          id: `evt_fail_${Date.now()}`,
          type: EventType.EXECUTION_FAILED,
          timestamp: Date.now(),
          executionId: msg.sessionId,
          source: 'message-gateway',
          payload: {
            channel: msg.channel,
            error: (err as Error).message,
            originalContent: msg.content,
          },
        });

        return errorResponse;
      }
    }

    // 5. 无 handler 时的默认响应
    return {
      channel: msg.channel,
      userId: msg.userId,
      sessionId: msg.sessionId,
      content: 'System is initializing. Please try again shortly.',
      type: 'text',
      metadata: { status: 'no_handler' },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 会话管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 追踪或更新会话
   */
  private trackSession(msg: IncomingMessage): void {
    const existing = this.sessions.get(msg.sessionId);
    const now = Date.now();

    if (existing) {
      existing.lastActivityAt = now;
      existing.metadata = { ...existing.metadata, ...msg.metadata };
    } else {
      this.sessions.set(msg.sessionId, {
        sessionId: msg.sessionId,
        userId: msg.userId,
        channel: msg.channel,
        createdAt: now,
        lastActivityAt: now,
        metadata: { ...msg.metadata },
      });
    }
  }

  /**
   * 获取指定会话信息
   *
   * @param sessionId - 会话 ID
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有活跃会话列表
   */
  listSessions(): SessionInfo[] {
    return [...this.sessions.values()];
  }

  /**
   * 移除过期会话
   *
   * @param maxAge - 最大空闲时间（毫秒），默认 30 分钟
   * @returns 移除的会话数
   */
  pruneSessions(maxAge: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, info] of this.sessions) {
      if (now - info.lastActivityAt > maxAge) {
        this.sessions.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * 关闭会话
   *
   * @param sessionId - 会话 ID
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);

    this.bus.emit({
      id: `evt_sess_end_${Date.now()}`,
      type: EventType.SESSION_ENDED,
      timestamp: Date.now(),
      executionId: sessionId,
      source: 'message-gateway',
      payload: { sessionId, reason: 'closed' },
    });
  }
}
