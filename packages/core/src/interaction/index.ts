/**
 * interaction — MorPex Interaction Layer 统一入口
 *
 * Phase 2 / MorPex v8: 所有外部渠道的统一接入层。
 *
 * 模块结构：
 *   interaction/
 *     types.ts           — 统一消息类型定义（IncomingMessage, OutgoingMessage, ChannelAdapter）
 *     gateway/           — 消息网关（MessageGateway）
 *     adapters/          — 渠道适配器（Web/WeChat/Feishu/CLI）
 *
 * 使用方式：
 *   import { MessageGateway, WebAdapter } from './interaction/index.js';
 *
 *   const gateway = new MessageGateway(eventBus);
 *   gateway.registerAdapter(new WebAdapter());
 *   gateway.start();
 */

// ── 类型 ──
export type {
  IncomingMessage,
  OutgoingMessage,
  ChannelAdapter,
  SessionInfo,
} from './types.js';

// ── Gateway ──
export { MessageGateway } from './gateway/index.js';
export type { MessageHandler } from './gateway/index.js';

// ── Adapters ──
export {
  WebAdapter,
  CLIAdapter,
  WeChatAdapter,
  FeishuAdapter,
} from './adapters/index.js';
