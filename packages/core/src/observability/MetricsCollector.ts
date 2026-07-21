/**
 * MetricsCollector — 指标收集器
 *
 * MorPex v8.8: 收集运行时指标的时序数据。
 * 支持按名称查询、时间窗口聚合。
 */

export interface MetricPoint {
  name: string
  value: number
  tags: Record<string, string>
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════
// MetricsCollector
// ═══════════════════════════════════════════════════════════════

export class MetricsCollector {
  private series: Map<string, MetricPoint[]> = new Map()
  private maxPointsPerMetric: number

  constructor(maxPointsPerMetric: number = 10000) {
    this.maxPointsPerMetric = maxPointsPerMetric
  }

  /**
   * record — 记录一个指标点
   *
   * @param name - 指标名称
   * @param value - 指标值
   * @param tags - 标签（可选）
   */
  record(name: string, value: number, tags?: Record<string, string>): void {
    const point: MetricPoint = {
      name,
      value,
      tags: tags || {},
      timestamp: Date.now(),
    }

    if (!this.series.has(name)) {
      this.series.set(name, [])
    }

    const points = this.series.get(name)!
    points.push(point)

    // 容量保护
    if (points.length > this.maxPointsPerMetric) {
      points.splice(0, points.length - this.maxPointsPerMetric)
    }
  }

  /**
   * getSeries — 获取指标的时间序列
   *
   * @param name - 指标名称
   * @param since - 起始时间（可选）
   * @returns MetricPoint[]
   */
  getSeries(name: string, since?: number): MetricPoint[] {
    const points = this.series.get(name)
    if (!points) return []

    if (since !== undefined) {
      return points.filter(p => p.timestamp >= since)
    }
    return [...points]
  }

  /**
   * getLatest — 获取指定指标的最新值
   *
   * @param name - 指标名称
   * @returns MetricPoint | undefined
   */
  getLatest(name: string): MetricPoint | undefined {
    const points = this.series.get(name)
    if (!points || points.length === 0) return undefined
    return points[points.length - 1]
  }

  /**
   * aggregate — 对时间窗口内的指标进行聚合
   *
   * @param name - 指标名称
   * @param start - 窗口起始
   * @param end - 窗口结束
   * @returns { avg, min, max, count }
   */
  aggregate(name: string, start: number, end: number): { avg: number; min: number; max: number; count: number } {
    const points = this.series.get(name)
    if (!points) return { avg: 0, min: 0, max: 0, count: 0 }

    const filtered = points.filter(p => p.timestamp >= start && p.timestamp <= end)
    if (filtered.length === 0) return { avg: 0, min: 0, max: 0, count: 0 }

    const values = filtered.map(p => p.value)
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    }
  }

  /**
   * getMetricNames — 获取所有指标名称
   */
  getMetricNames(): string[] {
    return [...this.series.keys()]
  }

  /**
   * reset — 清空所有指标
   */
  reset(): void {
    this.series.clear()
  }
}
