/**
 * Scheduler — DAG 调度器
 *
 * 决定下一批可执行的节点，支持优先级和并发控制。
 */
import { TaskNode } from './TaskNode.js';
import { TaskGraph } from './TaskGraph.js';
import { DependencyResolver } from './DependencyResolver.js';

export interface SchedulerConfig {
  /** 最大并行执行数 */
  maxParallel?: number;
  /** 是否启用优先级调度 */
  enablePriority?: boolean;
}

export class Scheduler {
  private config: Required<SchedulerConfig>;

  constructor(config?: SchedulerConfig) {
    this.config = {
      maxParallel: config?.maxParallel ?? 4,
      enablePriority: config?.enablePriority ?? true,
    };
  }

  get maxParallel(): number { return this.config.maxParallel; }
  set maxParallel(value: number) { this.config.maxParallel = value; }

  /**
   * 调度下一个批次的节点
   */
  schedule(graph: TaskGraph): TaskNode[] {
    const resolver = new DependencyResolver(graph);
    const resolved = resolver.resolveAll();

    // 获取就绪节点（依赖满足且待执行）
    const readyNodes = graph.nodes.filter(n =>
      n.status === 'pending' && resolved.pending.includes(n.id)
    );

    // 考虑正在运行的节点数量
    const runningCount = graph.getRunningNodes().length;
    const availableSlots = Math.max(0, this.config.maxParallel - runningCount);

    if (availableSlots === 0 || readyNodes.length === 0) {
      return [];
    }

    // 优先级排序
    if (this.config.enablePriority) {
      readyNodes.sort((a, b) => b.priority - a.priority);
    }

    return readyNodes.slice(0, availableSlots);
  }

  /**
   * 获取当前运行状态摘要
   */
  getStatus(graph: TaskGraph): SchedulerStatus {
    const resolver = new DependencyResolver(graph);
    const resolved = resolver.resolveAll();
    const running = graph.getRunningNodes().length;

    return {
      running,
      pending: resolved.pending.length,
      blocked: resolved.blocked.length,
      completed: resolved.completed.length,
      failed: resolved.failed.length,
      availableSlots: Math.max(0, this.config.maxParallel - running),
      isComplete: graph.isComplete(),
    };
  }
}

export interface SchedulerStatus {
  running: number;
  pending: number;
  blocked: number;
  completed: number;
  failed: number;
  availableSlots: number;
  isComplete: boolean;
}
