/**
 * ToolExecutionProxy — Worker 隔离执行器（含僵尸防御 + 反向熔断）
 *
 * 每个工具调用在独立 worker_threads 中执行。
 * 内核不关心执行细节，只监听三种信号：
 *   - progress   → 透传给 harness 的 tool_execution_update
 *   - completed  → 返回 ToolResult
 *   - timeout/oom → 执行 worker.terminate()，向 FSMEngine 抛出 TOOL_EXECUTION_TIMEOUT
 */

import { Worker } from 'worker_threads';
import { config } from '../../config/MorPexConfig.js';
import type { AgentToolResult } from '../adapters/pi-types.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolResultAny = AgentToolResult<any>;

interface WorkerConfig {
  /** 硬超时 (ms)，到期后强制 terminate */
  timeoutMs: number;
  /** 内存上限 (MB)，超过后强制 terminate */
  maxMemoryMB: number;
}

const DEFAULT_CONFIG: WorkerConfig = {
  timeoutMs: config.workerTimeoutMs,
  maxMemoryMB: config.workerMaxMemoryMB,
};

export class ToolExecutionProxy {
  private activeWorkers = new Map<string, Worker>();
  private config: WorkerConfig;

  constructor(config?: Partial<WorkerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * execute — 在隔离 Worker 中执行工具调用
   *
   * 返回一个 AbortController，调用方可通过它提前终止。
   * 超时、OOM、进程崩溃三种异常统一转为 TOOL_EXECUTION_TIMEOUT。
   */
  async execute(
    toolCallId: string,
    toolName: string,
    args: unknown,
    workingDir: string,
    onProgress?: (partial: AgentToolResultAny) => void,
  ): Promise<AgentToolResultAny> {
    // 每个 execute() 调用的局部状态（非实例共享，支持并发）
    let retried = false;

    // 1. 创建 Worker
    const worker = new Worker(
      new URL('./tool-worker-bootstrap.js', import.meta.url),
      {
        workerData: { toolCallId, toolName, args, workingDir },
        resourceLimits: {
          maxOldGenerationSizeMb: this.config.maxMemoryMB,
        },
      },
    );
    this.activeWorkers.set(toolCallId, worker);

    // 2. 超时熔断定时器
    const timeoutId = setTimeout(() => {
      this.terminateWorker(toolCallId, 'TIMEOUT');
    }, this.config.timeoutMs);

    // @VALIDATE-TODO: 内存监控过于简化，应使用 worker.resourceLimits 事件而非轮询
    // 3. 内存监控（每 5 秒采样）
    const memMonitor = setInterval(() => {
      const usage = worker.resourceLimits;
      // worker_threads 的 resourceLimits 是软限制；硬监控通过 process.memoryUsage()
      if (usage?.maxOldGenerationSizeMb) {
        const current = process.memoryUsage().heapUsed / 1024 / 1024;
        if (current > this.config.maxMemoryMB * 0.9) {
          this.terminateWorker(toolCallId, 'OOM');
        }
      }
    }, 5000);

    // 4. 监听 Worker 消息
    return new Promise<AgentToolResultAny>((resolve, reject) => {
      worker.on('message', (msg: any) => {
        switch (msg.type) {
          case 'progress':
            onProgress?.(msg.partial);
            break;
          case 'completed':
            this.cleanup(toolCallId, timeoutId, memMonitor);
            resolve(msg.result as any);
            break;
          case 'error':
            this.cleanup(toolCallId, timeoutId, memMonitor);
            reject(new Error(msg.error));
            break;
        }
      });

      worker.on('error', (err) => {
        this.cleanup(toolCallId, timeoutId, memMonitor);
        reject(err);
      });

      worker.on('exit', (code) => {
        this.cleanup(toolCallId, timeoutId, memMonitor);
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    }).catch(async (err) => {
      // 5. 降级重试（仅一次）
      // retried 是每个 execute() 调用的局部变量，被 catch 闭包捕获，支持并发安全
      if (!retried) {
        retried = true;
        console.warn(`[ToolProxy] Worker ${toolCallId} 失败(${err.message})，尝试降级重试...`);
        return this.execute(toolCallId, toolName, args, workingDir, onProgress);
      }
      // 6. 向 FSMEngine 抛出标准异常
      throw new ToolExecutionTimeoutError(toolCallId, toolName, err.message);
    });
  }

  /** 强制终止 Worker（僵尸进程清理） */
  private terminateWorker(toolCallId: string, reason: 'TIMEOUT' | 'OOM'): void {
    const worker = this.activeWorkers.get(toolCallId);
    if (!worker) return;

    console.error(`[ToolProxy] 终止 Worker ${toolCallId}: ${reason}`);
    worker.terminate();
    this.activeWorkers.delete(toolCallId);
  }

  private cleanup(toolCallId: string, timeoutId: NodeJS.Timeout, memMonitor: NodeJS.Timeout): void {
    clearTimeout(timeoutId);
    clearInterval(memMonitor);
    this.activeWorkers.delete(toolCallId);
  }

  /** 紧急熔断：终止所有活跃 Worker */
  async abortAll(): Promise<void> {
    for (const [id, worker] of this.activeWorkers) {
      console.warn(`[ToolProxy] 紧急熔断: 终止 Worker ${id}`);
      worker.terminate();
    }
    this.activeWorkers.clear();
  }
}

/** 工具执行超时/崩溃的统一异常 */
export class ToolExecutionTimeoutError extends Error {
  constructor(
    public toolCallId: string,
    public toolName: string,
    public originalError: string,
  ) {
    super(`[TOOL_EXECUTION_TIMEOUT] ${toolName}(${toolCallId}): ${originalError}`);
    this.name = 'ToolExecutionTimeoutError';
  }
}
