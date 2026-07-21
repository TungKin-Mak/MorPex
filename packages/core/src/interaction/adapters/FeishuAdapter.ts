/**
 * FeishuAdapter — 飞书 Bot 适配器
 *
 * Phase 2 / MorPex v8 | v8.5 Upgrade Item 6: 真实 API 对接
 *
 * 支持:
 *   - 飞书事件回调 (消息事件、机器人事件)
 *   - 飞书消息主动推送 (文本消息)
 *   - URL 验证 (challenge)
 *   - tenant_access_token 自动刷新
 *
 * 环境变量:
 *   FEISHU_APP_ID
 *   FEISHU_APP_SECRET
 *   FEISHU_VERIFICATION_TOKEN
 */

import type { IncomingMessage, OutgoingMessage, ChannelAdapter } from '../types.js';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
}

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

export class FeishuAdapter implements ChannelAdapter {
  readonly name = 'feishu';

  private config: FeishuConfig | null = null;
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];
  private _running = false;
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: FeishuConfig) {
    this.config = config ?? FeishuAdapter.loadConfigFromEnv();
  }

  private static loadConfigFromEnv(): FeishuConfig | null {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (appId && appSecret) {
      return { appId, appSecret, verificationToken: process.env.FEISHU_VERIFICATION_TOKEN };
    }
    console.warn('[FeishuAdapter] 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET 未设置, 使用 Stub 模式');
    return null;
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    if (!this.config) {
      console.log('[FeishuAdapter] Stub 模式启动 (无配置)');
      return;
    }
    await this.refreshTenantToken();
    this.tokenRefreshTimer = setInterval(() => {
      this.refreshTenantToken().catch((err: Error) => {
        console.error('[FeishuAdapter] tenant_access_token 自动刷新失败:', err.message);
      });
    }, 7000 * 1000);
    console.log('[FeishuAdapter] 已启动 (飞书 API 模式)');
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this.tokenRefreshTimer) { clearInterval(this.tokenRefreshTimer); this.tokenRefreshTimer = null; }
    this.tenantAccessToken = null;
    this.tokenExpiresAt = 0;
    this.messageHandlers = [];
    console.log('[FeishuAdapter] 已停止');
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this._running || !this.config || !this.tenantAccessToken) {
      if (!this.config) console.log('[FeishuAdapter] Stub: 未发送 (无配置):', msg.content.substring(0, 50));
      return;
    }
    try {
      const url = FEISHU_API_BASE + '/im/v1/messages?receive_id_type=open_id';
      const body = {
        receive_id: msg.userId,
        msg_type: 'text',
        content: JSON.stringify({ text: msg.content }),
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': 'Bearer ' + this.tenantAccessToken,
        },
        body: JSON.stringify(body),
      });
      const result: any = await resp.json();
      if (result.code !== 0) {
        console.error('[FeishuAdapter] 发送失败: code=' + result.code + ' msg=' + (result.msg || ''));
        if (result.code === 99991663 || result.code === 99991664) {
          await this.refreshTenantToken();
          const retryResp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Authorization': 'Bearer ' + this.tenantAccessToken,
            },
            body: JSON.stringify(body),
          });
          const retryResult: any = await retryResp.json();
          if (retryResult.code !== 0) console.error('[FeishuAdapter] 重试仍失败: code=' + retryResult.code);
        }
      }
    } catch (err: unknown) {
      console.error('[FeishuAdapter] 发送异常:', (err as Error).message);
    }
  }

  verifyChallenge(token: string): { challenge?: string; error?: string } {
    const expected = this.config?.verificationToken;
    if (expected && token !== expected) {
      console.warn('[FeishuAdapter] verification_token 不匹配');
      return { error: 'invalid_token' };
    }
    return { challenge: token };
  }

  async handleEventCallback(body: string): Promise<{ challenge?: string } | void> {
    try {
      const parsed: any = JSON.parse(body);

      // 飞书 URL 验证
      if (parsed.type === 'url_verification') {
        return { challenge: parsed.challenge };
      }

      // 消息事件
      if (parsed.type === 'event_callback' || parsed.type === 'im.message.receive_v1') {
        const event = parsed.event || parsed;
        const msgContent = event.message?.content || event.content || '';
        const senderId = event.sender?.sender_id?.open_id || event.open_id || '';
        const text = (() => {
          try {
            const c = typeof msgContent === 'string' ? JSON.parse(msgContent) : msgContent;
            return c.text || '';
          } catch { return typeof msgContent === 'string' ? msgContent : ''; }
        })();

        if (!senderId || !text) return;

        const incoming: IncomingMessage = {
          channel: 'feishu',
          userId: senderId,
          sessionId: 'feishu_' + senderId,
          content: text,
          metadata: { rawEvent: parsed },
        };

        for (const handler of this.messageHandlers) handler(incoming);
      }
    } catch (err: unknown) {
      console.error('[FeishuAdapter] 处理事件回调失败:', (err as Error).message);
    }
  }

  simulateMessage(openId: string, content: string): void {
    const msg: IncomingMessage = {
      channel: 'feishu', userId: openId, sessionId: 'feishu_' + openId, content,
      metadata: { simulated: true },
    };
    for (const handler of this.messageHandlers) handler(msg);
  }

  private async refreshTenantToken(): Promise<void> {
    if (!this.config) return;
    try {
      const url = FEISHU_API_BASE + '/auth/v3/tenant_access_token/internal';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
      });
      const result: any = await resp.json();
      if (result.tenant_access_token) {
        this.tenantAccessToken = result.tenant_access_token;
        this.tokenExpiresAt = Date.now() + (result.expire || 7200) * 1000;
      } else {
        console.error('[FeishuAdapter] 获取 tenant_access_token 失败:', JSON.stringify(result));
      }
    } catch (err: unknown) {
      console.error('[FeishuAdapter] 刷新 token 异常:', (err as Error).message);
    }
  }
}
