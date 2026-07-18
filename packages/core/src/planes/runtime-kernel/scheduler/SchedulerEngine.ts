/**
 * SchedulerEngine — 全局调度器引擎
 *
 * 从 src/core/global-scheduler.ts 迁移。
 * 负责任务队列管理、优先级排序、并发控制、背压检测。
 *
 * 架构：
 *   enqueue(task)
 *     │
 *     ▼
 *   Priority Queue（按综合优先级排序）
 *     │
 *     ▼
 *   Dispatcher（取最高优先级任务，受并发限制）
 *     │
 *     ├─ running < maxConcurrent → 执行
 *     └─ running ≥ maxConcurrent → 等待
 *           │
 *           ▼
 *   Backpressure Detection（队列深度告警）
 */

import type {
  SchedulerTask,
  SchedulerTaskStatus,
  TaskPriority,
  SchedulerStats,
  BackpressureLevel,
  SchedulerEngineConfig,
} from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<SchedulerEngineConfig> = {
  maxConcurrent: 16,
  maxQueueDepth: 200,
  enableBackpressure: true,
  backpressureThreshold: 0.8,
  priorityWeights: { roi: 0.5, cost: 0.2, latency: 0.3 },
};

/**
 * SchedulerEngine — 全局调度器
 *
 * 管理任务优先级队列，控制并发执行，检测背压。
 */
export class SchedulerEngine {
  private queue: SchedulerTask[] = [];
  private running: Map<string, SchedulerTask> = new Map();
  private completed: SchedulerTask[] = [];
  private config: Required<SchedulerEngineConfig>;

  private stats: SchedulerStats = {
    totalEnqueued: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalCancelled: 0,
    currentlyRunning: 0,
    queueDepth: 0,
    avgQueueTime: 0,
    avgExecutionTime: 0,
    backpressureLevel: 'none',
  };

  /** 任务就绪回调（调度器决定可以执行时触发） */
  onTaskReady: ((task: SchedulerTask) => void) | null = null;

  /** 背压告警回调 */
  onBackpressure: ((level: BackpressureLevel, queueDepth: number) => void) | null = null;

  /** 统计变更回调 */
  onStatsChanged: ((stats: SchedulerStats) => void) | null = null;

  constructor(config?: SchedulerEngineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.priorityWeights) {
      this.config.priorityWeights = { ...DEFAULT_CONFIG.priorityWeights, ...config.priorityWeights };
    }
  }

  // ── 任务入队 ──

  /**
   * 将任务加入调度队列
   *
   * @returns 'enqueued' | 'rejected'（队列满）
   */
  enqueue(task: Omit<SchedulerTask, 'state' | 'createdAt'>): 'enqueued' | 'rejected' {
    // 背压检查
    if (this.config.enableBackpressure && this.isBackpressureActive()) {
      if (this.queue.length >= this.config.maxQueueDepth) {
        this.stats.totalFailed++;
        this.emitBackpressure();
        return 'rejected';
      }
    }

    const newTask: SchedulerTask = {
      ...task,
      state: 'queued',
      createdAt: Date.now(),
    };

    this.queue.push(newTask);
    this.stats.totalEnqueued++;
    this.updateStats();

    // 尝试派发
    this.tryDispatch();

    return 'enqueued';
  }

  // ── 任务状态更新 ──

  /** 标记任务开始执行 */
  startTask(taskId: string): boolean {
    // 从队列移到 running
    const idx = this.queue.findIndex(t => t.id === taskId);
    if (idx === -1) return false;

    const task = this.queue.splice(idx, 1)[0];
    task.state = 'running';
    task.startedAt = Date.now();
    this.running.set(taskId, task);
    this.updateStats();
    return true;
  }

  /** 标记任务完成 */
  completeTask(taskId: string, result?: any): boolean {
    const task = this.running.get(taskId);
    if (!task) return false;

    task.state = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    this.running.delete(taskId);
    this.completed.push(task);
    this.stats.totalCompleted++;
    this.updateStats();

    // 尝试派发下一个任务
    this.tryDispatch();
    return true;
  }

  /** 标记任务失败 */
  failTask(taskId: string, error: string): boolean {
    const task = this.running.get(taskId);
    if (!task) return false;

    task.state = 'failed';
    task.completedAt = Date.now();
    task.error = error;
    this.running.delete(taskId);
    this.completed.push(task);
    this.stats.totalFailed++;
    this.updateStats();

    this.tryDispatch();
    return true;
  }

  /** 取消任务 */
  cancelTask(taskId: string): boolean {
    // 从队列中取消
    const idx = this.queue.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const task = this.queue.splice(idx, 1)[0];
      task.state = 'cancelled';
      this.completed.push(task);
      this.stats.totalCancelled++;
      this.updateStats();
      return true;
    }

    // 从运行中取消
    const task = this.running.get(taskId);
    if (task) {
      task.state = 'cancelled';
      task.completedAt = Date.now();
      this.running.delete(taskId);
      this.completed.push(task);
      this.stats.totalCancelled++;
      this.updateStats();
      this.tryDispatch();
      return true;
    }

    return false;
  }

  // ── 查询 ──

  /** 获取队列中等待的任务数 */
  get queueDepth(): number {
    return this.queue.length;
  }

  /** 获取当前运行任务数 */
  get runningCount(): number {
    return this.running.size;
  }

  /** 检查调度器是否空闲 */
  get isIdle(): boolean {
    return this.queue.length === 0 && this.running.size === 0;
  }

  /** 获取统计 */
  getStats(): SchedulerStats {
    return { ...this.stats };
  }

  /** 获取队列中的任务 */
  getQueuedTasks(): SchedulerTask[] {
    return [...this.queue];
  }

  /** 获取运行中的任务 */
  getRunningTasks(): SchedulerTask[] {
    return [...this.running.values()];
  }

  /** 获取已完成的任务 */
  getCompletedTasks(): SchedulerTask[] {
    return [...this.completed];
  }

  /** 获取任务 */
  getTask(taskId: string): SchedulerTask | undefined {
    return this.queue.find(t => t.id === taskId)
      ?? this.running.get(taskId)
      ?? this.completed.find(t => t.id === taskId);
  }

  // ── 内部 ──

  /**
   * 尝试派发任务
   * 从队列中取最高优先级的任务，若并发未达上限则触发执行
   */
  private tryDispatch(): void {
    while (this.running.size < this.config.maxConcurrent && this.queue.length > 0) {
      // 按综合优先级排序，取最高
      const task = this.pickHighestPriority();

      // 从队列移除
      const idx = this.queue.findIndex(t => t.id === task.id);
      if (idx !== -1) this.queue.splice(idx, 1);

      // 标记运行
      task.state = 'running';
      task.startedAt = Date.now();
      this.running.set(task.id, task);
      this.updateStats();

      // 通知外部执行
      this.onTaskReady?.(task);
    }
  }

  /**
   * 计算综合优先级分数
   * score = roi * w_roi + (1-cost) * w_cost + latency * w_latency
   */
  private calculatePriority(task: SchedulerTask): number {
    const { roi, cost, latency } = task.priority;
    const { roi: wRoi, cost: wCost, latency: wLatency } = this.config.priorityWeights;
    return roi * wRoi + (1 - cost) * wCost + latency * wLatency;
  }

  /**
   * 取最高优先级任务
   */
  private pickHighestPriority(): SchedulerTask {
    let best = this.queue[0];
    let bestScore = this.calculatePriority(best);

    for (let i = 1; i < this.queue.length; i++) {
      const score = this.calculatePriority(this.queue[i]);
      if (score > bestScore) {
        best = this.queue[i];
        bestScore = score;
      }
    }

    return best;
  }

  /**
   * 检查是否处于背压状态
   */
  private isBackpressureActive(): boolean {
    return this.queue.length / this.config.maxQueueDepth >= this.config.backpressureThreshold;
  }

  /**
   * 检测并发射背压事件
   */
  private emitBackpressure(): void {
    const ratio = this.queue.length / this.config.maxQueueDepth;
    let level: BackpressureLevel;

    if (ratio >= 0.95) level = 'severe';
    else if (ratio >= this.config.backpressureThreshold) level = 'moderate';
    else level = 'none';

    if (level !== 'none') {
      this.stats.backpressureLevel = level;
      this.onBackpressure?.(level, this.queue.length);
    }
  }

  /**
   * 更新统计
   */
  private updateStats(): void {
    this.stats.currentlyRunning = this.running.size;
    this.stats.queueDepth = this.queue.length;

    // 计算平均排队时间
    const queuedWithTime = this.completed.filter(t => t.startedAt && t.completedAt);
    if (queuedWithTime.length > 0) {
      this.stats.avgQueueTime = queuedWithTime.reduce(
        (sum, t) => sum + ((t.startedAt ?? t.createdAt) - t.createdAt), 0,
      ) / queuedWithTime.length;

      this.stats.avgExecutionTime = queuedWithTime.reduce(
        (sum, t) => sum + ((t.completedAt ?? Date.now()) - (t.startedAt ?? t.createdAt)), 0,
      ) / queuedWithTime.length;
    }

    // 更新背压等级
    if (this.config.enableBackpressure) {
      this.emitBackpressure();
    }

    this.onStatsChanged?.(this.getStats());
  }

  /** 清空调度器 */
  clear(): void {
    this.queue = [];
    this.running.clear();
    this.completed = [];
    this.stats = {
      totalEnqueued: 0, totalCompleted: 0, totalFailed: 0, totalCancelled: 0,
      currentlyRunning: 0, queueDepth: 0, avgQueueTime: 0, avgExecutionTime: 0,
      backpressureLevel: 'none',
    };
  }
}
