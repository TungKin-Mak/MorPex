/**
 * PrometheusExporter — 轻量 Prometheus 文本格式导出器
 *
 * v9.2 Phase 4: 将 MetricsCollector 的指标导出为 Prometheus text format。
 * 无外部依赖。同时返回 JSON 格式供内部 HTTP 端点使用。
 */

import { MetricsCollector, type V9Metrics } from './MetricsCollector.js'
import * as process from 'node:process'

export interface PrometheusMetrics {
  /** Prometheus 文本格式（用于 /metrics 端点） */
  text: string
  /** 扁平键值 JSON（用于 JSON 端点） */
  json: Record<string, number>
}

export class PrometheusExporter {
  private startTime = Date.now()
  private lastCpuUsage = process.hrtime.bigint()
  private lastCpuTime = process.cpuUsage()

  constructor(private metrics: MetricsCollector) {}

  export(): PrometheusMetrics {
    const lines: string[] = []
    const json: Record<string, number> = {}
    const now = Date.now()

    // ── 系统指标 ──
    lines.push('# HELP process_uptime_seconds Time since process start')
    lines.push('# TYPE process_uptime_seconds gauge')
    lines.push(`process_uptime_seconds{pid="${process.pid}"} ${((now - this.startTime) / 1000).toFixed(2)}`)
    json['process.uptime_seconds'] = (now - this.startTime) / 1000

    const mem = process.memoryUsage()
    lines.push('# HELP process_memory_heap_bytes Heap memory usage')
    lines.push('# TYPE process_memory_heap_bytes gauge')
    lines.push(`process_memory_heap_bytes{type="used"} ${mem.heapUsed}`)
    lines.push(`process_memory_heap_bytes{type="total"} ${mem.heapTotal}`)
    json['process.memory_heap_used'] = mem.heapUsed
    json['process.memory_heap_total'] = mem.heapTotal

    const cpu = this.getApproxCpuPercent()
    lines.push('# HELP process_cpu_percent Approximate CPU usage (%)')
    lines.push('# TYPE process_cpu_percent gauge')
    lines.push(`process_cpu_percent ${cpu.toFixed(2)}`)
    json['process.cpu_percent'] = cpu

    // ── 业务指标 ──
    const names = this.metrics.getMetricNames()
    for (const name of names) {
      const series = this.metrics.getSeries(name)
      if (series.length === 0) continue
      const last = series[series.length - 1]
      const promName = name.replace(/\./g, '_')
      const tagStr = Object.entries(last.tags).map(([k, v]) => `${k}="${v}"`).join(',')
      lines.push(`# HELP ${promName} ${name}`)
      lines.push(`# TYPE ${promName} gauge`)
      lines.push(tagStr ? `${promName}{${tagStr}} ${last.value}` : `${promName} ${last.value}`)
      json[name] = last.value
    }

    return { text: lines.join('\n') + '\n', json }
  }

  exportV9Json(): V9Metrics {
    return this.metrics.getV9Metrics()
  }

  private getApproxCpuPercent(): number {
    try {
      const now = process.hrtime.bigint()
      const nowCpu = process.cpuUsage()
      const elapsedNs = Number(now - this.lastCpuUsage)
      if (elapsedNs <= 0) return 0
      const userDelta = nowCpu.user - this.lastCpuTime.user
      const sysDelta = nowCpu.system - this.lastCpuTime.system
      this.lastCpuUsage = now
      this.lastCpuTime = nowCpu
      return ((userDelta + sysDelta) / (elapsedNs / 1000)) * 100
    } catch {
      return 0
    }
  }
}
