/**
 * JSONLCompactor — JSONL 文件状态压缩（类似 Redis AOF 重写）
 *
 * 解决了什么问题：
 *   template-lineages.jsonl / intelligence-state.jsonl 等"状态/血统"类文件
 *   只关心最终状态或完整链条。只往后追加会导致大量"过时中间态"占用磁盘，
 *   启动时全量读取到内存也浪费。
 *
 * 机制（类似 Redis AOF 重写）：
 *   - 读取当前 JSONL 全部行（串行读取，按行流处理）
 *   - 按 keyField（如 templateId）分组，只保留每个 key 的 LATEST 条目
 *   - 将精简后的行写入临时文件，原子性地 rename 替换原文件
 *
 * 使用方式：
 *   ```typescript
 *   const compactor = new JSONLCompactor({
 *     filePath: './data/planning/template-lineages.jsonl',
 *     keyField: 'templateId',
 *   });
 *   // 每 50 次写入后触发
 *   await compactor.compact();
 *   ```
 */

import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface CompactorConfig {
  /** JSONL 文件路径 */
  filePath: string;
  /** 用于去重的键字段名（如 'templateId'、'sessionId'） */
  keyField: string;
  /** 时间戳字段名，用于判断"最新的"条目，默认 'timestamp' */
  timestampField?: string;
  /** 压缩后保留的最大 key 数，默认 10000 */
  maxKeys?: number;
}

export class JSONLCompactor {
  private filePath: string;
  private keyField: string;
  private timestampField: string;
  private maxKeys: number;

  constructor(config: CompactorConfig) {
    this.filePath = path.resolve(config.filePath);
    this.keyField = config.keyField;
    this.timestampField = config.timestampField ?? 'timestamp';
    this.maxKeys = config.maxKeys ?? 10000;
  }

  /**
   * compact — 执行压缩：保留每个 key 的最新条目
   * @returns { before, after } 压缩前后的行数
   */
  async compact(): Promise<{ before: number; after: number }> {
    if (!fs.existsSync(this.filePath)) {
      return { before: 0, after: 0 };
    }

    // 1. 读取全部行
    let content: string;
    try {
      content = await fsp.readFile(this.filePath, 'utf-8');
    } catch {
      return { before: 0, after: 0 };
    }

    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return { before: 0, after: 0 };
    const before = lines.length;

    // 2. 按 keyField 分组，只保留每个 key 的最新一条
    const latestPerKey = new Map<string, string>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const key = String(parsed[this.keyField] ?? 'default');
        const timestamp = parsed[this.timestampField] ?? 0;

        const existing = latestPerKey.get(key);
        if (existing) {
          const existingParsed = JSON.parse(existing);
          const existingTs = existingParsed[this.timestampField] ?? 0;
          if (timestamp >= existingTs) {
            latestPerKey.set(key, line); // 替换为更新的
          }
        } else {
          latestPerKey.set(key, line);
        }
      } catch {
        // 无法解析的行保留原样
        latestPerKey.set(`__unparseable_${crypto.randomUUID()}`, line);
      }
    }

    // 3. 限制最大 key 数（保留最新的）
    let compactedLines: string[];
    if (latestPerKey.size > this.maxKeys) {
      // 按时间戳排序，保留最新的 maxKeys 条
      const entries = Array.from(latestPerKey.entries());
      entries.sort((a, b) => {
        try {
          const tsA = JSON.parse(a[1])[this.timestampField] ?? 0;
          const tsB = JSON.parse(b[1])[this.timestampField] ?? 0;
          return tsB - tsA; // 降序
        } catch { return 0; }
      });
      compactedLines = entries.slice(0, this.maxKeys).map(e => e[1]);
    } else {
      compactedLines = Array.from(latestPerKey.values());
    }

    const after = compactedLines.length;

    // 4. 写入临时文件 → 原子替换
    const tmpPath = this.filePath + '.compact.' + Date.now() + '.tmp';
    try {
      await fsp.writeFile(tmpPath, compactedLines.join('\n') + (compactedLines.length > 0 ? '\n' : ''), 'utf-8');
      await fsp.rename(tmpPath, this.filePath);
    } catch (err: unknown) {
      // 清理临时文件
      try { await fsp.unlink(tmpPath); } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[JSONLCompactor] ⚠️ 压缩失败: ${msg}`);
      return { before, after: before }; // 失败时返回原始数
    }

    const saved = before - after;
    if (saved > 0) {
      console.log(`[JSONLCompactor] 🔧 ${path.basename(this.filePath)}: ${before} → ${after} 行 (节省 ${((saved / before) * 100).toFixed(0)}%)`);
    }

    return { before, after };
  }
}
