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

export interface V9Metrics {
  teamFormations: { count: number; avgDurationMs: number; avgTeamSize: number }
  sharedMemory: { totalWrites: number; conflicts: number; conflictRate: number }
  marketplace: { totalBids: number; wonBids: number; winRate: number }
  distributed: { messagesSent: number; avgLatencyMs: number; errors: number }
  resilience: { circuitBreakerTrips: number; retriesTriggered: number; compensationsRun: number }
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

  // ═══ v9.2 Metrics ═══

  /** Record team formation event */
  recordTeamFormation(durationMs: number, teamSize: number): void {
    this.record('team_formation.duration', durationMs, { teamSize: String(teamSize) })
    this.record('team_formation.count', 1)
  }

  /** Record shared memory conflict */
  recordSharedMemoryConflict(key: string): void {
    this.record('shared_memory.conflict', 1, { key })
  }

  /** Record marketplace bid outcome */
  recordMarketplaceBid(listingId: string, won: boolean): void {
    this.record('marketplace.bid', won ? 1 : 0, { listingId, outcome: won ? 'won' : 'lost' })
  }

  /** Record distributed message latency */
  recordDistributedMessage(fromNode: string, toNode: string, latencyMs: number): void {
    this.record('distributed.message.latency', latencyMs, { from: fromNode, to: toNode })
    this.record('distributed.message.count', 1)
  }

  /** Record circuit breaker trip */
  recordCircuitBreakerTrip(breakerName: string): void {
    this.record('resilience.circuit_breaker_trip', 1, { breaker: breakerName })
  }

  /** Get structured v9.2 metrics from last 24h */
  getV9Metrics(): V9Metrics {
    const now = Date.now()
    const dayAgo = now - 86400000

    const teamFormationsCount = this.aggregate('team_formation.count', dayAgo, now).count
    const tfDurations = this.getSeries('team_formation.duration', dayAgo)
    const avgDurationMs = tfDurations.length > 0 ? tfDurations.reduce((s, p) => s + p.value, 0) / tfDurations.length : 0
    const avgTeamSize = tfDurations.length > 0
      ? tfDurations.reduce((s, p) => s + parseInt(p.tags.teamSize || '1', 10), 0) / tfDurations.length
      : 0

    const conflicts = this.getSeries('shared_memory.conflict', dayAgo).length
    const totalWrites = conflicts + this.aggregate('shared_memory.write', dayAgo, now).count

    const totalBids = this.aggregate('marketplace.bid', dayAgo, now).count
    const wonBids = this.getSeries('marketplace.bid', dayAgo).filter(p => p.value >= 1).length

    const msgCount = this.aggregate('distributed.message.count', dayAgo, now).count
    const msgLatencies = this.getSeries('distributed.message.latency', dayAgo)
    const avgMsgLatency = msgLatencies.length > 0 ? msgLatencies.reduce((s, p) => s + p.value, 0) / msgLatencies.length : 0
    const msgErrors = this.aggregate('distributed.message.error', dayAgo, now).count

    const cbTrips = this.aggregate('resilience.circuit_breaker_trip', dayAgo, now).count

    return {
      teamFormations: { count: teamFormationsCount, avgDurationMs, avgTeamSize: Math.round(avgTeamSize * 10) / 10 },
      sharedMemory: { totalWrites, conflicts, conflictRate: totalWrites > 0 ? Math.round((conflicts / totalWrites) * 1000) / 1000 : 0 },
      marketplace: { totalBids, wonBids, winRate: totalBids > 0 ? Math.round((wonBids / totalBids) * 1000) / 1000 : 0 },
      distributed: { messagesSent: msgCount, avgLatencyMs: Math.round(avgMsgLatency), errors: msgErrors },
      resilience: { circuitBreakerTrips: cbTrips, retriesTriggered: this.aggregate('resilience.retry', dayAgo, now).count, compensationsRun: this.aggregate('resilience.compensation', dayAgo, now).count },
    }
  }
}
