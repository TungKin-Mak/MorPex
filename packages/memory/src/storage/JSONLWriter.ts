/**
 * JSONLWriter — 微批处理 JSONL 追加写入器
 *
 * 解决的问题：
 *   每次 MemoryBus.remember() / KnowledgeGraph.addEntity() 都触发
 *   同步 fs.appendFileSync，在密集调用时造成 I/O 阻塞。
 *
 * 机制：
 *   - 内存缓冲 (默认 500ms / 50条 窗口)
 *   - 窗口到期或缓冲区满 → 单次 fs.appendFileSync 批量刷入
 *   - shutdown() 确保进程退出前刷完残留
 *
 * 线程安全：
 *   Node.js 单线程事件循环天然保证 appendFileSync 的原子性。
 *   缓冲区操作均在同步代码中完成，无需额外锁。
 */

import * as fs from 'fs';
import * as path from 'path';

export interface JSONLWriterConfig {
  /** 文件路径 */
  filePath: string;
  /** 刷盘间隔 (ms)，默认 500 */
  flushIntervalMs?: number;
  /** 缓冲区最大行数，默认 50 */
  maxBufferSize?: number;
}

export class JSONLWriter {
  private filePath: string;
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number;
  private maxBufferSize: number;
  private _closed = false;

  constructor(config: JSONLWriterConfig) {
    this.filePath = path.resolve(config.filePath);
    this.flushIntervalMs = config.flushIntervalMs ?? 500;
    this.maxBufferSize = config.maxBufferSize ?? 50;

    // 确保目录存在
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** 最大重试次数 */
  private static readonly MAX_RETRY_FLUSH = 3;
  /** 当前连续刷盘失败次数 */
  private flushFailCount = 0;

  /**
   * 追加一行 JSON（不立即写盘）
   */
  append(json: Record<string, any>): void {
    if (this._closed) {
      console.warn(`[JSONLWriter] 已关闭，拒绝写入: ${this.filePath}`);
      return;
    }

    this.buffer.push(JSON.stringify(json));

    // 缓冲区满 → 立即刷盘
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
      return;
    }

    // 启动定时器（如果尚未启动）
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * 立即刷盘所有缓冲数据
   */
  flush(): void {
    // 原子化 timer 管理：保存 timer 引用先清除，避免 append() 在 flush 执行期间
    // 设置新定时器后被 null 覆盖导致定时器泄漏
    const existingTimer = this.timer;
    this.timer = null;
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (this.buffer.length === 0) return;

    const lines = this.buffer.join('\n') + '\n';
    this.buffer = [];

    try {
      fs.appendFileSync(this.filePath, lines, 'utf-8');
      this.flushFailCount = 0; // 成功则重置计数
    } catch (err: any) {
      console.error(`[JSONLWriter] 刷盘失败 ${this.filePath}: ${err.message}`);
      // 失败的行放回缓冲区（防止数据丢失），但限制重试次数避免无限循环
      if (this.flushFailCount < JSONLWriter.MAX_RETRY_FLUSH) {
        this.buffer = lines.trim().split('\n');
        this.flushFailCount++;
        console.warn(`[JSONLWriter] 刷盘重试 ${this.flushFailCount}/${JSONLWriter.MAX_RETRY_FLUSH}`);
      } else {
        console.error(`[JSONLWriter] 刷盘失败已达最大重试次数(${JSONLWriter.MAX_RETRY_FLUSH})，丢弃 ${lines.trim().split('\n').length} 行数据: ${this.filePath}`);
        this.flushFailCount = 0;
      }
    }
  }

  /**
   * 关闭写入器，刷盘残留数据
   */
  shutdown(): void {
    this._closed = true;
    this.flush();
  }

  /**
   * 缓冲区当前行数
   */
  get pending(): number {
    return this.buffer.length;
  }

  /**
   * 是否已关闭
   */
  get closed(): boolean {
    return this._closed;
  }
}
