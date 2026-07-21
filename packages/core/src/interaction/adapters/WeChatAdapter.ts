/**
 * WeChatAdapter — 微信公众号/企业微信适配器
 *
 * Phase 2 / MorPex v8 | v8.5 Upgrade Item 6: 真实 API 对接
 *
 * 支持:
 *   - 微信公众号消息接收与回复
 *   - 微信客服消息主动推送
 *   - 服务器 URL 验证 (signature/echostr)
 *   - XML 消息回调解析
 *   - access_token 自动刷新
 *
 * 环境变量:
 *   WECHAT_APP_ID
 *   WECHAT_APP_SECRET
 *   WECHAT_TOKEN
 */

import crypto from 'node:crypto';
import type { IncomingMessage, OutgoingMessage, ChannelAdapter } from '../types.js';

export interface WeChatConfig {
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey?: string;
}

const WECHAT_API_BASE = 'https://api.weixin.qq.com/cgi-bin';

export class WeChatAdapter implements ChannelAdapter {
  readonly name = 'wechat';

  private config: WeChatConfig | null = null;
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];
  private _running = false;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: WeChatConfig) {
    this.config = config ?? WeChatAdapter.loadConfigFromEnv();
  }

  private static loadConfigFromEnv(): WeChatConfig | null {
    const appId = process.env.WECHAT_APP_ID;
    const appSecret = process.env.WECHAT_APP_SECRET;
    const token = process.env.WECHAT_TOKEN;
    if (appId && appSecret && token) {
      return { appId, appSecret, token, encodingAESKey: process.env.WECHAT_ENCODING_AES_KEY };
    }
    console.warn('[WeChatAdapter] 环境变量 WECHAT_APP_ID / WECHAT_APP_SECRET / WECHAT_TOKEN 未设置, 使用 Stub 模式');
    return null;
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    if (!this.config) {
      console.log('[WeChatAdapter] Stub 模式启动 (无配置)');
      return;
    }
    await this.refreshAccessToken();
    this.tokenRefreshTimer = setInterval(() => {
      this.refreshAccessToken().catch((err: Error) => {
        console.error('[WeChatAdapter] access_token 自动刷新失败:', err.message);
      });
    }, 7000 * 1000);
    console.log('[WeChatAdapter] 已启动 (微信 API 模式)');
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this.tokenRefreshTimer) { clearInterval(this.tokenRefreshTimer); this.tokenRefreshTimer = null; }
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.messageHandlers = [];
    console.log('[WeChatAdapter] 已停止');
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this._running || !this.config || !this.accessToken) {
      if (!this.config) console.log('[WeChatAdapter] Stub: 未发送 (无配置):', msg.content.substring(0, 50));
      return;
    }
    try {
      const url = WECHAT_API_BASE + '/message/custom/send?access_token=' + this.accessToken;
      const body = { touser: msg.userId, msgtype: 'text', text: { content: msg.content } };
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result: any = await resp.json();
      if (result.errcode !== 0) {
        console.error('[WeChatAdapter] 发送失败:', result.errmsg);
        if (result.errcode === 40001 || result.errcode === 42001) {
          await this.refreshAccessToken();
          const retryResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const retryResult: any = await retryResp.json();
          if (retryResult.errcode !== 0) console.error('[WeChatAdapter] 重试仍失败:', retryResult.errmsg);
        }
      }
    } catch (err: unknown) {
      console.error('[WeChatAdapter] 发送异常:', (err as Error).message);
    }
  }

  verifySignature(signature: string, timestamp: string, nonce: string, echostr: string): string {
    if (!this.config) return '';
    const arr = [this.config.token, timestamp, nonce].sort();
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    if (hash === signature) { console.log('[WeChatAdapter] 验证通过'); return echostr; }
    console.warn('[WeChatAdapter] 验证失败: 签名不匹配');
    return '';
  }

  async handleCallback(xmlBody: string): Promise<string> {
    try {
      const msg = WeChatAdapter.parseXml(xmlBody);
      const fromUser = msg.FromUserName || '';
      const content = msg.Content || '';
      if (!fromUser || !content) return '';
      const incoming: IncomingMessage = {
        channel: 'wechat',
        userId: fromUser,
        sessionId: 'wechat_' + fromUser,
        content,
        metadata: { msgId: msg.MsgId || '', msgType: msg.MsgType || '', msg, originalXml: xmlBody },
      };
      for (const handler of this.messageHandlers) handler(incoming);
      return '';
    } catch (err: unknown) {
      console.error('[WeChatAdapter] 解析回调失败:', (err as Error).message);
      return '';
    }
  }

  simulateMessage(fromUser: string, content: string): void {
    const msg: IncomingMessage = {
      channel: 'wechat', userId: fromUser, sessionId: 'wechat_' + fromUser, content,
      metadata: { simulated: true },
    };
    for (const handler of this.messageHandlers) handler(msg);
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.config) return;
    try {
      const url = WECHAT_API_BASE + '/token?grant_type=client_credential&appid=' + this.config.appId + '&secret=' + this.config.appSecret;
      const resp = await fetch(url);
      const result: any = await resp.json();
      if (result.access_token) {
        this.accessToken = result.access_token;
        this.tokenExpiresAt = Date.now() + (result.expires_in || 7200) * 1000;
      } else {
        console.error('[WeChatAdapter] 获取 access_token 失败:', JSON.stringify(result));
      }
    } catch (err: unknown) {
      console.error('[WeChatAdapter] 刷新 token 异常:', (err as Error).message);
    }
  }

  private static parseXml(xml: string): Record<string, string> {
    const result: Record<string, string> = {};
    const clean = xml.replace(/<\?xml.*?\?>/, '').trim();
    const regex = /<(\w+)>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))?<\/\1>/gs;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(clean)) !== null) {
      const key = match[1];
      const value = (match[2] ?? match[3] ?? '').trim();
      result[key] = value;
    }
    return result;
  }
}
