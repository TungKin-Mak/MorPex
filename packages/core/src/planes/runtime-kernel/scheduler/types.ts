/**
 * Scheduler Plugin — 类型定义
 *
 * 优先级队列、任务调度、背压控制相关类型。
 * 从 src/core/global-scheduler.ts 迁移。
 */

// ── 任务优先级 ──

/** 任务优先级（多维评分） */
export interface TaskPriority {
  roi: number;        // 投资回报率 0-1
  cost: number;       // 成本 0-1
  latency: number;    // 延迟敏感度 0-1
}

// ── 调度任务 ──

/** 调度任务状态 */
export type SchedulerTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 调度任务 */
export interface SchedulerTask {
  id: string;
  dagId: string;
  dagNodeId: string;
  agentType: string;
  priority: TaskPriority;
  estimatedDuration: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  deadline?: number;
  state: SchedulerTaskStatus;
  result?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ── 背压 ──

/** 背压等级 */
export type BackpressureLevel = 'none' | 'moderate' | 'severe';

// ── 调度器统计 ──

/** 调度器统计 */
export interface SchedulerStats {
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
  totalCancelled: number;
  currentlyRunning: number;
  queueDepth: number;
  avgQueueTime: number;
  avgExecutionTime: number;
  backpressureLevel: BackpressureLevel;
}

// ── 调度器配置 ──

/** Scheduler 引擎配置 */
export interface SchedulerEngineConfig {
  /** 最大并发数（默认 16） */
  maxConcurrent?: number;
  /** 最大队列深度（默认 200） */
  maxQueueDepth?: number;
  /** 是否启用背压（默认 true） */
  enableBackpressure?: boolean;
  /** 背压阈值 0-1（默认 0.8） */
  backpressureThreshold?: number;
  /** 优先级权重 */
  priorityWeights?: { roi: number; cost: number; latency: number };
}

/** Scheduler Plugin 配置 */
export interface SchedulerPluginConfig {
  engine?: SchedulerEngineConfig;
}
