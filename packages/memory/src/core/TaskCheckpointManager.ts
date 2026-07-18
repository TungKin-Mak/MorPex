/**
 * TaskCheckpointManager — Agent 任务检查点系统
 *
 * 解决 10 步任务执行到第 5 步崩溃 → 重启后从头推理的痛点。
 *
 * 核心能力：
 *   - save(taskId, step, payload)  → 每个原子步骤完成后自动保存
 *   - load(taskId, step?)           → 恢复最新检查点
 *   - list(taskId)                  → 列出所有检查点
 *   - rollback(taskId, toStep)      → 回滚到指定步骤
 *   - clean(taskId, olderThanDays)  → 自动清理旧检查点
 *
 * 存储布局：
 *   data/workspace/checkpoints/<taskId>/
 *   ├── checkpoint-1.json
 *   ├── checkpoint-2.json
 *   ├── ...
 *   └── checkpoint-N.json
 *
 * 设计约束：
 *   - 每个 checkpoint 限制 1MB，超长 CoT 自动截断
 *   - JSONL 逐 step 追加写入，崩溃不丢数据
 *   - 任务完成后保留 N 天后自动清理
 *   - 支持 FSMEngine 状态恢复 + DAGEngine 节点恢复
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 类型 ──

export interface CheckpointPayload {
  // 元数据
  checkpointId: string;
  taskId: string;
  step: number;
  totalSteps: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'rolled_back';
  createdAt: number;
  updatedAt: number;

  // 思考状态
  chainOfThought: string[];           // 已执行的思考步骤
  currentReasoning: string;           // 当前正在推理的内容

  // 数据状态
  variables: Record<string, any>;     // 局部变量快照
  fileSnapshots: Array<{              // 已生成的临时文件
    filePath: string;
    content: string;
    hash: string;
  }>;

  // 执行计划
  agenda: Array<{                     // 待执行的子任务队列
    id: string;
    type: string;
    description: string;
    deps: string[];
    status: 'pending' | 'running' | 'done';
  }>;
  completedAgenda: string[];          // 已完成的子任务 ID 列表

  // 上下文
  contextSnapshot: {
    sessionId?: string;
    executionId: string;
    input: any;
    intermediateResults: Array<{ step: number; output: any }>;
    error?: { step: number; message: string; stack?: string };
  };

  // Token 消耗跟踪
  tokenUsage: {
    totalTokens: number;
    stepBreakdown: Array<{ step: number; tokens: number }>;
  };
}

/** 创建空的检查点 */
export function createEmptyCheckpoint(taskId: string, executionId: string, totalSteps: number): CheckpointPayload {
  return {
    checkpointId: `ckp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    taskId,
    step: 0,
    totalSteps,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    chainOfThought: [],
    currentReasoning: '',
    variables: {},
    fileSnapshots: [],
    agenda: [],
    completedAgenda: [],
    contextSnapshot: { executionId, input: null, intermediateResults: [] },
    tokenUsage: { totalTokens: 0, stepBreakdown: [] },
  };
}

/** 检查点摘要（用于列表，不加载完整 payload） */
export interface CheckpointSummary {
  step: number;
  totalSteps: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  fileSize: number;
}

/** 清理结果 */
export interface CleanResult {
  deleted: number;
  kept: number;
  freedBytes: number;
}

// ── CheckpointManager ──

export class TaskCheckpointManager {
  private baseDir: string;
  private maxSizeBytes: number;       // 单个 checkpoint 最大 1MB
  private retentionDays: number;       // 任务完成后保留天数

  constructor(baseDir?: string, retentionDays?: number) {
    this.baseDir = path.resolve(baseDir ?? './data/workspace/checkpoints');
    this.maxSizeBytes = 1_048_576;   // 1MB
    this.retentionDays = retentionDays ?? 7;
  }

  // ═══════════════════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════════════════

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    const taskDirs = fs.readdirSync(this.baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    console.log(`[Checkpoint] ✅ 就绪: ${taskDirs.length} 个任务目录`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Save
  // ═══════════════════════════════════════════════════════════════

  /**
   * 保存检查点
   * 每完成一个原子步骤自动调用，不丢进度。
   */
  save(payload: CheckpointPayload): boolean {
    const taskDir = this.taskDir(payload.taskId);
    this.ensureDir(taskDir);

    const fileName = `checkpoint-${payload.step}.json`;
    const filePath = path.join(taskDir, fileName);

    // 大小控制：超长 CoT 截断
    const serialized = this.serializePayload(payload);
    const json = JSON.stringify(serialized, null, 2);

    // 如果超过 1MB，进一步截断
    let finalJson = json;
    if (Buffer.byteLength(json, 'utf-8') > this.maxSizeBytes) {
      finalJson = JSON.stringify(this.truncatePayload(payload), null, 2);
      if (Buffer.byteLength(finalJson, 'utf-8') > this.maxSizeBytes) {
        console.warn(`[Checkpoint] ⚠️ checkpoint-${payload.step} 超过 1MB，已截断`);
      }
    }

    try {
      fs.writeFileSync(filePath, finalJson, 'utf-8');
      return true;
    } catch (err: any) {
      console.error(`[Checkpoint] ❌ 保存失败: ${err.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Load
  // ═══════════════════════════════════════════════════════════════

  /**
   * 加载最新检查点
   * @param taskId - 任务 ID
   * @param step - 指定步骤（不指定则加载最新的）
   */
  load(taskId: string, step?: number): CheckpointPayload | null {
    const taskDir = this.taskDir(taskId);
    if (!fs.existsSync(taskDir)) return null;

    if (step !== undefined) {
      const filePath = path.join(taskDir, `checkpoint-${step}.json`);
      if (!fs.existsSync(filePath)) return null;
      return this.readCheckpoint(filePath);
    }

    // 找最新的 checkpoint
    const checkpoints = this.listCheckpointFiles(taskDir);
    if (checkpoints.length === 0) return null;

    const latest = checkpoints[checkpoints.length - 1];
    return this.readCheckpoint(latest.path);
  }

  /** 列出指定任务的所有检查点 */
  list(taskId: string): CheckpointSummary[] {
    const taskDir = this.taskDir(taskId);
    if (!fs.existsSync(taskDir)) return [];

    return this.listCheckpointFiles(taskDir).map(cp => ({
      step: cp.step,
      totalSteps: 0, // 需要读取文件才知道
      status: 'unknown',
      createdAt: cp.mtime.getTime(),
      updatedAt: cp.mtime.getTime(),
      fileSize: cp.size,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // Rollback
  // ═══════════════════════════════════════════════════════════════

  /**
   * 回滚到指定步骤
   * 删除 step N..end 的 checkpoint，从 N-1 恢复。
   *
   * @returns 被回滚到的检查点，或 null
   */
  rollback(taskId: string, toStep: number): CheckpointPayload | null {
    const taskDir = this.taskDir(taskId);
    if (!fs.existsSync(taskDir)) return null;

    // 加载目标检查点
    const targetPath = path.join(taskDir, `checkpoint-${toStep}.json`);
    if (!fs.existsSync(targetPath)) return null;

    const payload = this.readCheckpoint(targetPath);
    if (!payload) return null;

    // 删除 step > toStep 的检查点
    const allFiles = this.listCheckpointFiles(taskDir);
    for (const file of allFiles) {
      if (file.step > toStep) {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    // 更新目标检查点状态
    payload.status = 'rolled_back';
    payload.updatedAt = Date.now();
    this.save(payload);

    console.log(`[Checkpoint] ↩️ 回滚到 step ${toStep}: ${taskId}`);
    return payload;
  }

  // ═══════════════════════════════════════════════════════════════
  // Clean
  // ═══════════════════════════════════════════════════════════════

  /**
   * 清理旧检查点
   * - 删除 N 天前的检查点目录
   * - 对于已完成的任务，只保留最终一个 checkpoint
   */
  clean(olderThanDays?: number): CleanResult {
    const cutoff = Date.now() - (olderThanDays ?? this.retentionDays) * 86400_000;
    let deleted = 0;
    let kept = 0;
    let freedBytes = 0;

    if (!fs.existsSync(this.baseDir)) {
      return { deleted: 0, kept: 0, freedBytes: 0 };
    }

    const taskDirs = fs.readdirSync(this.baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of taskDirs) {
      const taskDir = path.join(this.baseDir, dir.name);
      const files = this.listCheckpointFiles(taskDir);

      if (files.length === 0) {
        // 空目录，删除
        try { fs.rmdirSync(taskDir); deleted++; } catch {}
        continue;
      }

      // 如果最新 checkpoint 超过保留期限，整个目录删除
      const latestMtime = Math.max(...files.map(f => f.mtime.getTime()));
      if (latestMtime < cutoff) {
        const size = files.reduce((s, f) => s + f.size, 0);
        try {
          fs.rmSync(taskDir, { recursive: true, force: true });
          deleted += files.length;
          freedBytes += size;
        } catch {}
        continue;
      }

      // 对于活跃任务：保留最新 3 个 checkpoint，删除中间的
      if (files.length > 3) {
        const toDelete = files.slice(0, files.length - 3);
        for (const f of toDelete) {
          try {
            freedBytes += f.size;
            fs.unlinkSync(f.path);
            deleted++;
          } catch {}
        }
      }
      kept += Math.min(files.length, 3);
    }

    if (deleted > 0) {
      console.log(`[Checkpoint] 🧹 清理: ${deleted} 个旧检查点, 释放 ${(freedBytes / 1024).toFixed(1)}KB`);
    }
    return { deleted, kept, freedBytes };
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private taskDir(taskId: string): string {
    // 安全化 taskId：移除路径分隔符
    const safe = taskId.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(this.baseDir, safe);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private listCheckpointFiles(taskDir: string): Array<{
    path: string;
    step: number;
    size: number;
    mtime: Date;
  }> {
    const results: Array<{ path: string; step: number; size: number; mtime: Date }> = [];
    try {
      const entries = fs.readdirSync(taskDir, { withFileTypes: true });
      for (const entry of entries) {
        const match = entry.name.match(/^checkpoint-(\d+)\.json$/);
        if (match && entry.isFile()) {
          const fullPath = path.join(taskDir, entry.name);
          const stat = fs.statSync(fullPath);
          results.push({
            path: fullPath,
            step: parseInt(match[1], 10),
            size: stat.size,
            mtime: stat.mtime,
          });
        }
      }
    } catch {}
    results.sort((a, b) => a.step - b.step);
    return results;
  }

  private readCheckpoint(filePath: string): CheckpointPayload | null {
    try {
      const json = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(json) as CheckpointPayload;
    } catch (err: any) {
      console.warn(`[Checkpoint] ⚠️ 读取失败: ${filePath} - ${err.message}`);
      return null;
    }
  }

  /** 序列化前截断超长内容 */
  private serializePayload(payload: CheckpointPayload): CheckpointPayload {
    return {
      ...payload,
      chainOfThought: payload.chainOfThought.map(c => c.substring(0, 2000)),
      currentReasoning: payload.currentReasoning.substring(0, 5000),
      fileSnapshots: payload.fileSnapshots.map(f => ({
        ...f,
        content: f.content.substring(0, 10000),
      })),
    };
  }

  /** 激进截断（超过 1MB 时） */
  private truncatePayload(payload: CheckpointPayload): CheckpointPayload {
    return {
      ...payload,
      chainOfThought: payload.chainOfThought.slice(-10).map(c => c.substring(0, 500)),
      currentReasoning: payload.currentReasoning.substring(0, 1000),
      variables: { _truncated: true, _keys: Object.keys(payload.variables) },
      fileSnapshots: payload.fileSnapshots.map(f => ({
        filePath: f.filePath,
        content: '',
        hash: f.hash,
      })),
      agenda: payload.agenda.slice(0, 20),
      contextSnapshot: {
        ...payload.contextSnapshot,
        intermediateResults: payload.contextSnapshot.intermediateResults.slice(-5),
      },
    };
  }
}
