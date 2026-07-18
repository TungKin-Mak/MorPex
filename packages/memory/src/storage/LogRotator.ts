/**
 * LogRotator — JSONL 日志轮转器
 *
 * 解决：errors.jsonl 等纯日志文件无限增长问题。
 *
 * 机制：
 *   每次写入检查文件大小（lazy stat），超过 maxSizeBytes 时：
 *   1. 关闭当前文件（flush JSONLWriter）
 *   2. 重命名为 errors.{YYYY-MM-DD}.{seq}.jsonl
 *   3. 创建一个新的空文件
 *   4. 清理超过 retentionDays 的旧文件
 *
 * 线程安全：
 *   使用简单锁（rotating flag）防止并发轮转。
 *   JSONLWriter 本身的 buffer 在 rotate 前 flush。
 *
 * 与 JSONLWriter 配合：
 *   LogRotator 不替换 JSONLWriter，而是包装在它外面。
 *   JSONLWriter 负责缓冲/刷盘，LogRotator 负责文件切换。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface LogRotatorConfig {
  /** 日志文件路径（如 ./data/planning/errors.jsonl） */
  filePath: string;
  /** 单文件最大字节数，默认 10MB */
  maxSizeBytes?: number;
  /** 保留天数，默认 30 */
  retentionDays?: number;
}

export class LogRotator {
  private basePath: string;
  private baseDir: string;
  private baseName: string;
  private ext: string;
  private maxSize: number;
  private retentionDays: number;
  private _rotating = false;
  private _lastStatCheck = 0;
  private _currentSize = 0;
  private _writeCount = 0;

  constructor(config: LogRotatorConfig) {
    this.basePath = path.resolve(config.filePath);
    this.baseDir = path.dirname(this.basePath);
    this.baseName = path.basename(this.basePath, '.jsonl');
    this.ext = '.jsonl';
    this.maxSize = config.maxSizeBytes ?? 10 * 1024 * 1024;
    this.retentionDays = config.retentionDays ?? 30;
  }

  /** 当前活跃文件路径 */
  get currentPath(): string {
    return this.basePath;
  }

  /** 当前文件大小（字节） */
  get currentSize(): number {
    return this._currentSize;
  }

  /** 写入计数 */
  get writeCount(): number {
    return this._writeCount;
  }

  /**
   * 在每次追加写入前调用。
   * 检查当前文件大小，超过阈值则触发轮转。
   */
  async maybeRotate(): Promise<boolean> {
    if (this._rotating) return false;

    // 每 50 次写入或首次检查 stat
    this._writeCount++;
    if (this._writeCount % 50 !== 1 && this._currentSize > 0) {
      // 快速路径：靠缓存大小判断
      if (this._currentSize < this.maxSize) return false;
    }

    try {
      const stat = await fsp.stat(this.basePath).catch(() => null);
      this._currentSize = stat?.size ?? 0;
      if (this._currentSize < this.maxSize) return false;
    } catch {
      return false;
    }

    return this.rotate();
  }

  /**
   * 执行文件轮转：
   * 1. 重命名当前文件 → {baseName}.{date}.{seq}{ext}
   * 2. 清理过期文件
   */
  async rotate(): Promise<boolean> {
    if (this._rotating) return false;
    this._rotating = true;

    try {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

      // 计算该日期的序号
      let seq = 1;
      const dirContents = fs.readdirSync(this.baseDir).filter(f =>
        f.startsWith(this.baseName + '.' + dateStr) && f.endsWith(this.ext)
      );
      if (dirContents.length > 0) {
        const seqs = dirContents
          .map(f => {
            const match = f.match(/\.(\d+)\.jsonl$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(n => !isNaN(n));
        if (seqs.length > 0) seq = Math.max(...seqs) + 1;
      }

      const rotatedName = `${this.baseName}.${dateStr}.${seq}${this.ext}`;
      const rotatedPath = path.join(this.baseDir, rotatedName);

      // 重命名当前文件
      await fsp.rename(this.basePath, rotatedPath).catch(() => {});
      this._currentSize = 0;
      this._writeCount = 0;

      // 清理旧文件（异步，不阻塞）
      this.cleanupOldFiles().catch(() => {});

      return true;
    } finally {
      this._rotating = false;
    }
  }

  /**
   * 清理超过 retentionDays 的旧日志文件。
   * 返回删除的文件数。
   */
  async cleanupOldFiles(): Promise<number> {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    try {
      const files = await fsp.readdir(this.baseDir);
      for (const file of files) {
        // 匹配 rotated 文件：{baseName}.YYYY-MM-DD.{seq}.jsonl
        const match = file.match(new RegExp(`^${this.baseName}\\.(\\d{4}-\\d{2}-\\d{2})\\.\\d+${this.ext}$`));
        if (!match) continue;

        const fileDate = new Date(match[1] + 'T00:00:00Z').getTime();
        if (isNaN(fileDate) || fileDate > cutoff) continue;

        await fsp.rm(path.join(this.baseDir, file), { force: true }).catch(() => {});
        deleted++;
      }
    } catch { /* ignore */ }

    return deleted;
  }
}
