/**
 * SchedulerEngine — STUB (replaced by DAG Runtime's Scheduler)
 * @deprecated Use Scheduler from runtime/dag/
 */
export class SchedulerEngine {
  runningCount = 0; queueDepth = 0;
  private queue: Map<string, any> = new Map();
  /** Retain completed/failed/cancelled tasks for getTask() */
  private completedTasks: Map<string, any> = new Map();
  private pendingQueue: string[] = [];
  private _completed: number = 0;
  private _failed: number = 0;
  private _cancelled: number = 0;
  private maxConcurrent: number;
  private maxQueueDepth: number;
  private enableBackpressure: boolean;
  private backpressureThreshold: number;
  onTaskReady?: (t: any) => void;
  onBackpressure?: () => void;

  constructor(opts?: any) {
    this.maxConcurrent = opts?.maxConcurrent ?? 10;
    this.maxQueueDepth = opts?.maxQueueDepth ?? 100;
    this.enableBackpressure = opts?.enableBackpressure ?? false;
    this.backpressureThreshold = opts?.backpressureThreshold ?? 0.8;
    this.runningCount = 0;
  }

  enqueue(task: any) {
    const id = task.id;
    this.queue.set(id, { ...task, state: 'queued' });
    this.pendingQueue.push(id);

    // Check backpressure
    if (this.enableBackpressure) {
      const pendingDepth = this.pendingQueue.length + this.runningCount;
      const threshold = Math.floor(this.backpressureThreshold * (this.maxConcurrent + this.maxQueueDepth));
      if (pendingDepth > threshold) {
        this.onBackpressure?.();
      }
    }

    // Dispatch if under limit
    if (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift()!;
      const nextTask = this.queue.get(nextId)!;
      nextTask.state = 'running';
      this.runningCount++;
      this.onTaskReady?.(nextTask);
    }

    this.queueDepth = this.pendingQueue.length;
    return 'enqueued';
  }

  completeTask(id: string, result?: any) {
    const task = this.queue.get(id);
    if (task) {
      task.state = 'completed';
      task.result = result;
      this.completedTasks.set(id, { ...task });
    }
    this._completed++;
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.queue.delete(id);

    // Dispatch next pending task
    if (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift()!;
      const nextTask = this.queue.get(nextId)!;
      nextTask.state = 'running';
      this.runningCount++;
      this.onTaskReady?.(nextTask);
    }

    this.queueDepth = this.pendingQueue.length;
  }

  failTask(id: string, err: string) {
    const task = this.queue.get(id);
    if (task) {
      task.state = 'failed';
      task.error = err;
      this.completedTasks.set(id, { ...task });
    }
    this._failed++;
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.queue.delete(id);

    // Dispatch next pending task
    if (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift()!;
      const nextTask = this.queue.get(nextId)!;
      nextTask.state = 'running';
      this.runningCount++;
      this.onTaskReady?.(nextTask);
    }

    this.queueDepth = this.pendingQueue.length;
  }

  cancelTask(id: string) {
    const task = this.queue.get(id);
    if (task) {
      task.state = 'cancelled';
      this.completedTasks.set(id, { ...task });
    }
    this._cancelled++;
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.queue.delete(id);
    this.pendingQueue = this.pendingQueue.filter(i => i !== id);
    this.queueDepth = this.pendingQueue.length;
  }

  getTask(id: string) {
    const task = this.queue.get(id);
    if (task) return { ...task };
    // Check if task was already completed/failed/cancelled
    const completed = this.completedTasks.get(id);
    if (completed) return { ...completed };
    return undefined;
  }

  get isIdle() {
    return this.queue.size === 0 && this.pendingQueue.length === 0 && this.runningCount === 0;
  }

  getStats() {
    const backpressureLevel =
      this.queueDepth > this.maxQueueDepth * this.backpressureThreshold ? 'high'
      : this.queueDepth > this.maxQueueDepth * 0.5 ? 'medium'
      : this.queueDepth > 0 ? 'low'
      : 'none';
    return {
      totalEnqueued: this._completed + this._failed + this._cancelled,
      totalCompleted: this._completed,
      totalFailed: this._failed,
      totalCancelled: this._cancelled,
      backpressureLevel,
    };
  }
}
