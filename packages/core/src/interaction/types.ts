/**
 * MorPex Interaction Layer — 统一消息类型定义
 *
 * Phase 2 / MorPex v8: 所有渠道的标准化消息格式。
 *
 * 设计原则：
 *   - 所有外部消息（Web/WeChat/Feishu/CLI）统一转换为 IncomingMessage
 *   - 所有下行消息统一为 OutgoingMessage
 *   - ChannelAdapter 接口抽象不同接入渠道
 */

// ── IncomingMessage — 来自外部渠道的入站消息 ──

/**
 * IncomingMessage — 入站消息的统一格式
 *
 * 无论消息来自 Web、微信、飞书还是 CLI，都转换为这个格式。
 * 后续模块（Mission Runtime、Planner）只处理 IncomingMessage，
 * 不关心消息来源。
 */
export interface IncomingMessage {
  /** 渠道标识（'web' | 'wechat' | 'feishu' | 'cli' 或自定义） */
  channel: string;

  /** 用户标识（渠道内唯一） */
  userId: string;

  /** 会话标识（跨渠道的会话 ID） */
  sessionId: string;

  /** 消息内容（文本格式） */
  content: string;

  /** 扩展元数据（渠道特有字段、附件引用等） */
  metadata: Record<string, unknown>;
}

// ── OutgoingMessage — 发往外部渠道的出站消息 ──

/**
 * OutgoingMessage — 出站消息的统一格式
 *
 * 所有响应统一为此格式，由 ChannelAdapter 转换为渠道原生格式。
 */
export interface OutgoingMessage {
  /** 渠道标识 */
  channel: string;

  /** 用户标识 */
  userId: string;

  /** 会话标识 */
  sessionId: string;

  /** 消息内容 */
  content: string;

  /** 消息类型 */
  type: 'text' | 'dag' | 'error' | 'stream' | 'approval';

  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

// ── ChannelAdapter — 渠道适配器接口 ──

/**
 * ChannelAdapter — 渠道适配器接口
 *
 * 每个外部渠道实现此接口以接入 MessageGateway。
 *
 * 适配器类型：
 *   主动适配器（如 WeChatAdapter）：启动自己的连接，推送消息到 Gateway
 *   被动适配器（如 WebAdapter）：提供 receiveMessage() 供外部调用
 */
export interface ChannelAdapter {
  /** 渠道名称（唯一标识，如 'web', 'wechat', 'feishu'） */
  readonly name: string;

  /** 启动适配器（建立连接、注册回调等） */
  start(): Promise<void>;

  /** 停止适配器（关闭连接、清理资源） */
  stop(): Promise<void>;

  /**
   * 注册入站消息处理函数
   * 当渠道收到消息时调用此 handler
   */
  onMessage(handler: (msg: IncomingMessage) => void): void;

  /**
   * 通过本渠道发送出站消息
   * 将 OutgoingMessage 转换为渠道原生格式并发送
   */
  sendMessage(msg: OutgoingMessage): Promise<void>;
}

// ── SessionInfo — 会话信息（Gateway 维护） ──

/**
 * SessionInfo — Gateway 维护的会话信息
 */
export interface SessionInfo {
  sessionId: string;
  userId: string;
  channel: string;
  createdAt: number;
  lastActivityAt: number;
  metadata: Record<string, unknown>;
}
