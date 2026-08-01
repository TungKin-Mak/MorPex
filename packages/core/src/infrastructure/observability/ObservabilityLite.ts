/**
 * ObservabilityLite — 精简版可观测性模块
 *
 * Phase 3 / 基础设施层
 *
 * 替代原有的 8 文件 Observability 模块（MetricsCollector、TraceManager、
 * CompactionService、WorkflowMetrics 等），保留核心监控能力：
 *   1. 计数器（事件处理数、错误数、任务数）
 *   2. 延迟统计（平均/最大/最小/百分位）
 *   3. 健康状态（各模块 up/down）
 *   4. 事件辅助队列（emitCount）
 *
 * 设计原则：
 *   - 单体文件，无子模块
 *   - 所有指标在内存中聚合，可被 Prometheus 拉取（预留 export 接口）
 *   - 不依赖 EventBus（由调用方在需要时调用）
 *
 * 使用方式：
 *   const obs = ObservabilityLite.getInstance();
 *   obs.incrementCounter('tasks.completed');
 *   obs.recordLatency('task.execution', 1250);
 *   obs.setHealth('department-manager', 'up');
 *   const snapshot = obs.snapshot();
 */

export type HealthState = 'up' | 'down' | 'degraded';

export interface MetricCounter {
  count: number;
  lastUpdated: number;
}

export interface LatencyStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface HealthEntry {
  state: HealthState;
  lastChecked: number;
  message?: string;
}

export interface ObservabilitySnapshot {
  counters: Record<string, number>;
  latencies: Record<string, { avg: number; p95: number; count: number }>;
  health: Record<string, HealthState>;
  uptime: number;
  timestamp: number;
}

export class ObservabilityLite {
  private static instance: ObservabilityLite;
  private counters: Map<string, MetricCounter> = new Map();
  private latencies: Map<string, number[]> = new Map();
  private health: Map<string, HealthEntry> = new Map();
  private startedAt = Date.now();

  private constructor() {}

  static getInstance(): ObservabilityLite {
    if (!ObservabilityLite.instance) {
      ObservabilityLite.instance = new ObservabilityLite();
    }
    return ObservabilityLite.instance;
  }

  // ── 计数器 ──

  incrementCounter(name: string, delta: number = 1): void {
    const existing = this.counters.get(name);
    if (existing) {
      existing.count += delta;
      existing.lastUpdated = Date.now();
    } else {
      this.counters.set(name, { count: delta, lastUpdated: Date.now() });
    }
  }

  getCounter(name: string): number {
    return this.counters.get(name)?.count ?? 0;
  }

  // ── 延迟 ──

  recordLatency(name: string, ms: number): void {
    const samples = this.latencies.get(name);
    if (samples) {
      samples.push(ms);
      // 限制内存占用：最多保留 1000 个样本
      if (samples.length > 1000) samples.shift();
    } else {
      this.latencies.set(name, [ms]);
    }
  }

  getLatencyStats(name: string): LatencyStats | undefined {
    const samples = this.latencies.get(name);
    if (!samples || samples.length === 0) return undefined;

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);

    return {
      count,
      avg: Math.round(sum / count),
      min: sorted[0],
      max: sorted[count - 1],
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  // ── 健康 ──

  setHealth(module: string, state: HealthState, message?: string): void {
    this.health.set(module, { state, lastChecked: Date.now(), message });
  }

  getHealth(module: string): HealthEntry | undefined {
    return this.health.get(module);
  }

  getAllHealth(): Record<string, HealthState> {
    const result: Record<string, HealthState> = {};
    for (const [module, entry] of this.health) {
      result[module] = entry.state;
    }
    return result;
  }

  // ── 快照 ──

  snapshot(): ObservabilitySnapshot {
    const counters: Record<string, number> = {};
    for (const [name, mc] of this.counters) {
      counters[name] = mc.count;
    }

    const latencies: Record<string, { avg: number; p95: number; count: number }> = {};
    for (const [name, samples] of this.latencies) {
      const sorted = [...samples].sort((a, b) => a - b);
      const count = sorted.length;
      if (count > 0) {
        latencies[name] = {
          avg: Math.round(sorted.reduce((s, v) => s + v, 0) / count),
          p95: sorted[Math.floor(count * 0.95)],
          count,
        };
      }
    }

    return {
      counters,
      latencies,
      health: this.getAllHealth(),
      uptime: Date.now() - this.startedAt,
      timestamp: Date.now(),
    };
  }

  reset(): void {
    this.counters.clear();
    this.latencies.clear();
    this.health.clear();
    this.startedAt = Date.now();
  }
}
