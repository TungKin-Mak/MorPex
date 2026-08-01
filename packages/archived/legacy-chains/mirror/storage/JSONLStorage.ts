/**
 * JSONLStorage — JSONL 文件实现的 MirrorStorage
 *
 * 存储目录结构：
 *   mirror/storage/
 *   ├── executions.jsonl       ← 执行轨迹
 *   ├── events.jsonl           ← 运行时事件
 *   └── snapshots.jsonl        ← 上下文快照
 *
 * 设计约束：
 *   - 异步写入，不阻塞主路径（fire-and-forget）
 *   - JSONL 格式：每行一个 JSON 对象
 *   - Phase 0 不轮转、不压缩、不删除
 *   - 未来可替换为 SQLite / PostgreSQL / VectorDB
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { MirrorRecord, MirrorStats, ExecutionTrace, MorPexEvent, ContextSnapshot } from '../../common/types.js';
import type { MirrorStorage } from './types.js';

/** 默认存储基路径 */
const DEFAULT_BASE_PATH = './data/mirror';

/** 文件映射 */
const FILE_MAP: Record<string, string> = {
  execution: 'executions.jsonl',
  event: 'events.jsonl',
  snapshot: 'snapshots.jsonl',
};

/** 写队列项 */
interface WriteQueueItem {
  filePath: string;
  line: string;
}

/**
 * JSONLStorage — JSONL 文件存储实现
 *
 * 使用追加写模式，每行一个 JSON 对象。
 * 写操作通过内部队列异步处理，不阻塞调用方。
 */
export class JSONLStorage implements MirrorStorage {
  private basePath: string;
  private initialized: boolean = false;
  private writeQueue: WriteQueueItem[] = [];
  private processing: boolean = false;
  private stats: MirrorStats = {
    totalExecutions: 0,
    totalEvents: 0,
    totalSnapshots: 0,
    storageSizeBytes: 0,
    errorCount: 0,
  };

  constructor(basePath?: string) {
    this.basePath = basePath ?? DEFAULT_BASE_PATH;
  }

  /**
   * 初始化存储：创建目录结构
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 创建存储目录
    await fsp.mkdir(this.basePath, { recursive: true });

    // 创建三个 JSONL 文件（如果不存在）
    for (const file of Object.values(FILE_MAP)) {
      const filePath = path.join(this.basePath, file);
      try {
        await fsp.access(filePath, fs.constants.F_OK);
      } catch {
        // 文件不存在，创建空文件
        await fsp.writeFile(filePath, '', 'utf-8');
      }
    }

    // 读取现有文件大小作为初始统计
    await this.refreshFileSizes();

    this.initialized = true;
  }

  /**
   * 追加一条记录
   *
   * 根据 record.type 追加到对应 .jsonl 文件。
   * 使用队列异步写入，不阻塞主路径。
   */
  async append(record: MirrorRecord): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const fileType = this.getRecordFileType(record.type);
    const filePath = path.join(this.basePath, FILE_MAP[fileType]);

    if (!filePath) {
      console.error(`[JSONLStorage] 未知记录类型: ${record.type}`);
      return;
    }

    const line = JSON.stringify(record.data) + '\n';

    // 入队
    this.writeQueue.push({ filePath, line });

    // 更新内存统计
    this.updateStats(record.type);

    // 触发异步写入（不 await）
    this.processQueue().catch(err => {
      console.error('[JSONLStorage] 写入队列处理错误:', err);
      this.stats.errorCount++;
    });
  }

  /**
   * 按 executionId 查询所有关联记录
   *
   * 扫描三个 .jsonl 文件，返回匹配 executionId 的记录。
   */
  async query(executionId: string): Promise<MirrorRecord[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const results: MirrorRecord[] = [];

    for (const [type, file] of Object.entries(FILE_MAP)) {
      const filePath = path.join(this.basePath, file);
      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.executionId === executionId) {
              results.push({
                type: type as MirrorRecord['type'],
                data,
              });
            }
          } catch {
            // 跳过损坏的行
            continue;
          }
        }
      } catch {
        // 文件不存在跳过
        continue;
      }
    }

    return results;
  }

  /**
   * 获取存储统计信息
   */
  getStats(): MirrorStats {
    return { ...this.stats };
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    // 等待队列处理完成
    while (this.writeQueue.length > 0 || this.processing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 获取记录类型对应的文件名键
   */
  private getRecordFileType(type: string): string {
    switch (type) {
      case 'execution': return 'execution';
      case 'event': return 'event';
      case 'snapshot': return 'snapshot';
      default: return 'event';
    }
  }

  /**
   * 获取文件路径
   */
  private getFilePath(type: string): string {
    return path.join(this.basePath, FILE_MAP[type] ?? 'events.jsonl');
  }

  /**
   * 异步处理写入队列
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0, 50); // 批量写入 50 条
      const fileGroups = new Map<string, string[]>();

      // 按文件分组
      for (const item of batch) {
        const existing = fileGroups.get(item.filePath) ?? [];
        existing.push(item.line);
        fileGroups.set(item.filePath, existing);
      }

      // 批量追加写入（直接 fs.appendFileSync，JSONLStorage 层已做 50 条批处理）
      for (const [filePath, items] of fileGroups) {
        // 确保目录存在
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // 验证每行都是合法 JSON 后批量写入
        const validLines: string[] = [];
        for (const item of items) {
          try {
            JSON.parse(item); // 验证
            validLines.push(item);
          } catch { /* skip malformed */ }
        }
        if (validLines.length > 0) {
          fs.appendFileSync(filePath, validLines.join('\n') + '\n', 'utf-8');
        }
      }
    }

    this.processing = false;

    // 刷新文件大小统计
    await this.refreshFileSizes().catch(() => {});
  }

  /**
   * 更新内存统计
   */
  private updateStats(type: string): void {
    switch (type) {
      case 'execution':
        this.stats.totalExecutions++;
        break;
      case 'event':
        this.stats.totalEvents++;
        break;
      case 'snapshot':
        this.stats.totalSnapshots++;
        break;
    }
  }

  /**
   * 刷新文件大小统计
   */
  private async refreshFileSizes(): Promise<void> {
    let totalBytes = 0;
    for (const file of Object.values(FILE_MAP)) {
      const filePath = path.join(this.basePath, file);
      try {
        const stat = await fsp.stat(filePath);
        totalBytes += stat.size;
      } catch {
        // 文件不存在忽略
      }
    }
    this.stats.storageSizeBytes = totalBytes;
  }
}
