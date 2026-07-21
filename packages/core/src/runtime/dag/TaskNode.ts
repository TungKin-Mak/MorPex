/**
 * TaskNode — DAG 执行节点
 *
 * 包装 DAGNode，添加运行时执行状态。
 */
import type { DAGNode, DAGNodeStatus } from '../../planes/runtime-kernel/dag/types.js';

export type TaskNodeStatus = 'pending' | 'ready' | 'running' | 'success' | 'failed' | 'skipped';

export interface TaskExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
}

export class TaskNode {
  public readonly id: string;
  public readonly name: string;
  public readonly agentType: string;
  public readonly description: string;
  public readonly deps: string[];
  public readonly priority: number;
  public readonly maxRetries: number;

  public status: TaskNodeStatus = 'pending';
  public attempts: number = 0;
  public result: TaskExecutionResult | null = null;
  public error: string | null = null;
  public startedAt: number | null = null;
  public completedAt: number | null = null;
  public metadata: Record<string, unknown> = {};

  /** Phase A2: 任务超时(ms)，0=无超时 */
  public timeout: number = 0;
  /** Phase A2: 重试延迟(ms) */
  public retryDelay: number = 100;

  private _handler: ((node: TaskNode, context: unknown) => Promise<unknown>) | null = null;

  constructor(dagNode: DAGNode) {
    this.id = dagNode.id;
    this.name = dagNode.name;
    this.agentType = dagNode.agentType;
    this.description = dagNode.description;
    this.deps = [...dagNode.deps];
    this.priority = dagNode.priority ?? 0;
    this.maxRetries = dagNode.maxRetries ?? 3;
    this.metadata = dagNode.metadata ? { ...dagNode.metadata } : {};
  }

  setHandler(handler: (node: TaskNode, context: unknown) => Promise<unknown>): void {
    this._handler = handler;
  }

  get isReady(): boolean {
    return this.status === 'pending' || this.status === 'ready';
  }

  get canRetry(): boolean {
    return this.attempts < this.maxRetries;
  }

  async execute(context: unknown): Promise<TaskExecutionResult> {
    this.status = 'running';
    this.attempts++;
    this.startedAt = Date.now();

    // Phase A2: 重试延迟
    if (this.attempts > 1 && this.retryDelay > 0) {
      await new Promise(r => setTimeout(r, Math.min(this.retryDelay * this.attempts, 5000)));
    }

    try {
      let output: unknown;
      if (this._handler) {
        // Phase A2: 超时控制
        if (this.timeout > 0) {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Task timeout after ${this.timeout}ms`)), this.timeout)
          );
          output = await Promise.race([this._handler(this, context), timeoutPromise]);
        } else {
          output = await this._handler(this, context);
        }
        this.result = { success: true, output, duration: Date.now() - this.startedAt! };
        this.status = 'success';
        this.completedAt = Date.now();
      } else {
        this.result = { success: true, output: null, duration: 0 };
        this.status = 'success';
        this.completedAt = Date.now();
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.error = msg;
      this.result = { success: false, error: msg, duration: Date.now() - this.startedAt! };
      this.status = this.canRetry ? 'pending' : 'failed';
      this.completedAt = this.status === 'failed' ? Date.now() : null;
    }

    return this.result!;
  }

  reset(): void {
    this.status = 'pending';
    this.attempts = 0;
    this.result = null;
    this.error = null;
    this.startedAt = null;
    this.completedAt = null;
  }

  toDAGNode(): DAGNode {
    return {
      id: this.id,
      name: this.name,
      agentType: this.agentType,
      description: this.description,
      deps: [...this.deps],
      status: this.status as DAGNodeStatus,
      priority: this.priority,
      retryCount: this.attempts,
      maxRetries: this.maxRetries,
      result: this.result?.output,
      error: this.error ?? undefined,
      startedAt: this.startedAt ?? undefined,
      completedAt: this.completedAt ?? undefined,
      metadata: this.metadata as Record<string, any>,
    };
  }
}
