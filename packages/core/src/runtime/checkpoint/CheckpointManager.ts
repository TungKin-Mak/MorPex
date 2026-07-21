/**
 * CheckpointManager — 检查点管理器
 *
 * 负责保存和加载执行快照，支持中断继续执行和失败恢复。
 * 使用 JSONL 格式存储。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as fsSync from 'node:fs';

export interface NodeState {
  nodeId: string;
  name: string;
  status: 'pending' | 'ready' | 'running' | 'success' | 'failed' | 'skipped';
  attempts: number;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionSnapshot {
  executionId: string;
  dagId: string;
  dagState: {
    nodeStates: NodeState[];
    edges: Array<{ from: string; to: string }>;
  };
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface CheckpointManagerConfig {
  /** 存储目录 (默认 ./data/checkpoints) */
  baseDir?: string;
}

export class CheckpointManager {
  private baseDir: string;

  constructor(config?: CheckpointManagerConfig) {
    this.baseDir = config?.baseDir ?? './data/checkpoints';
    fsSync.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * 保存快照
   */
  async save(snapshotId: string, state: ExecutionSnapshot): Promise<void> {
    const filePath = this.getPath(snapshotId);
    await fs.appendFile(filePath, JSON.stringify(state) + '\n', 'utf-8');
  }

  /**
   * 加载最新快照
   */
  async load(snapshotId: string): Promise<ExecutionSnapshot | null> {
    const filePath = this.getPath(snapshotId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const lines = data.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return null;
      // 取最后一行（最新快照）
      return JSON.parse(lines[lines.length - 1]) as ExecutionSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * 列出所有检查点
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.baseDir);
      return files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''));
    } catch {
      return [];
    }
  }

  /**
   * 清理过期检查点
   */
  async cleanup(maxAge: number): Promise<number> {
    const now = Date.now();
    let removed = 0;

    try {
      const files = await fs.readdir(this.baseDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(this.baseDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > maxAge) {
            await fs.unlink(filePath);
            removed++;
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip */ }

    return removed;
  }

  /**
   * 删除指定检查点
   */
  async delete(snapshotId: string): Promise<boolean> {
    try {
      await fs.unlink(this.getPath(snapshotId));
      return true;
    } catch {
      return false;
    }
  }

  private getPath(snapshotId: string): string {
    return path.join(this.baseDir, `${snapshotId}.jsonl`);
  }
}
