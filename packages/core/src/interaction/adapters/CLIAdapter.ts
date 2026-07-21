/**
 * CLIAdapter — 命令行渠道适配器
 *
 * Phase 2 / MorPex v8: 为 CLI/终端交互提供 ChannelAdapter 实现。
 *
 * 适配器类型：主动式（Active）
 *   启动 readline 接口，读取 stdin 输入并发送到 MessageGateway。
 *   输出通过 stdout 打印。
 *
 * 使用方式：
 *   const adapter = new CLIAdapter();
 *   gateway.registerAdapter(adapter);
 *   await gateway.start(); // 自动启动 CLI
 */

import * as readline from 'node:readline';
import type { IncomingMessage, OutgoingMessage, ChannelAdapter } from '../types.js';

/**
 * CLIAdapter — 命令行交互适配器
 */
export class CLIAdapter implements ChannelAdapter {
  readonly name = 'cli';

  /** readline 接口实例 */
  private rl: readline.Interface | null = null;

  /** 消息处理函数 */
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];

  /** 会话 ID（CLI 场景为单会话） */
  private readonly SESSION_ID = 'cli_session';
  private readonly USER_ID = 'cli_user';

  /** 运行状态 */
  private _running = false;

  /**
   * 启动 CLI 适配器
   *
   * 创建 readline 接口，开始监听 stdin。
   * 输入内容自动包装为 IncomingMessage 并发送到 Gateway。
   */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'MorPex> ',
    });

    this.rl.prompt();

    this.rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      // 支持退出命令
      if (trimmed.toLowerCase() === '/exit' || trimmed.toLowerCase() === '/quit') {
        console.log('Goodbye!');
        this.stop().catch(() => {});
        process.exit(0);
        return;
      }

      // 构建 IncomingMessage
      const msg: IncomingMessage = {
        channel: 'cli',
        userId: this.USER_ID,
        sessionId: this.SESSION_ID,
        content: trimmed,
        metadata: {},
      };

      // 转发给 Gateway
      for (const handler of this.messageHandlers) {
        try {
          handler(msg);
        } catch (err) {
          console.error('[CLIAdapter] handler 错误:', (err as Error).message);
        }
      }
    });

    this.rl.on('close', () => {
      if (this._running) {
        this._running = false;
        console.log('\n[CLIAdapter] 输入流已关闭');
      }
    });

    console.log('[CLIAdapter] ✅ 已启动。输入消息后回车发送，输入 /exit 退出。');
  }

  /**
   * 停止 CLI 适配器
   */
  async stop(): Promise<void> {
    this._running = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    console.log('[CLIAdapter] 已停止');
  }

  /**
   * 注册消息处理函数
   *
   * @param handler - 消息处理函数
   */
  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 通过 CLI 发送出站消息
   *
   * @param msg - 出站消息
   */
  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this._running) return;

    // 根据消息类型输出
    switch (msg.type) {
      case 'text':
        console.log(`\n🤖 ${msg.content}\n`);
        break;
      case 'dag':
        console.log(`\n📋 DAG Plan:\n${JSON.stringify(JSON.parse(msg.content), null, 2)}\n`);
        break;
      case 'error':
        console.error(`\n❌ ${msg.content}\n`);
        break;
      case 'stream':
        process.stdout.write(msg.content);
        break;
      case 'approval':
        console.log(`\n🔒 ${msg.content} (y/n)\n`);
        break;
      default:
        console.log(`\n${msg.content}\n`);
        break;
    }

    // 重新显示提示符
    this.rl?.prompt();
  }
}
