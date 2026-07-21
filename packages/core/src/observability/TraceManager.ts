/**
 * TraceManager — 追踪管理器
 *
 * MorPex v8.8: 记录每个 Mission 的完整执行追踪。
 * 每个 Span 代表一个阶段（Intent/Plan/Task/Verification），
 * 形成树形追踪结构。
 */

export interface TraceSpan {
  spanId: string
  missionId: string
  name: string
  parentSpanId?: string
  startTime: number
  endTime?: number
  status: 'started' | 'completed' | 'failed'
  metadata: Record<string, unknown>
}

export interface MissionTrace {
  missionId: string
  spans: TraceSpan[]
  totalDuration: number
  status: 'completed' | 'failed' | 'in_progress'
  rootSpan: TraceSpan
}

// ═══════════════════════════════════════════════════════════════
// TraceManager
// ═══════════════════════════════════════════════════════════════

export class TraceManager {
  private spans: Map<string, TraceSpan> = new Map()
  private missions: Map<string, string[]> = new Map() // missionId → spanIds
  private spanCounter = 0

  /**
   * startSpan — 开始一个新的追踪 Span
   *
   * @param missionId - Mission ID
   * @param name - Span 名称
   * @param parentSpanId - 父 Span ID（可选）
   * @returns TraceSpan
   */
  startSpan(missionId: string, name: string, parentSpanId?: string): TraceSpan {
    const spanId = `span_${Date.now()}_${++this.spanCounter}`
    const span: TraceSpan = {
      spanId,
      missionId,
      name,
      parentSpanId,
      startTime: Date.now(),
      status: 'started',
      metadata: {},
    }

    this.spans.set(spanId, span)

    if (!this.missions.has(missionId)) {
      this.missions.set(missionId, [])
    }
    this.missions.get(missionId)!.push(spanId)

    return span
  }

  /**
   * endSpan — 结束一个追踪 Span
   *
   * @param spanId - Span ID
   * @param status - 完成状态
   * @param metadata - 额外元数据（可选）
   */
  endSpan(spanId: string, status: 'completed' | 'failed', metadata?: Record<string, unknown>): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.endTime = Date.now()
    span.status = status
    if (metadata) {
      span.metadata = { ...span.metadata, ...metadata }
    }
  }

  /**
   * getTrace — 获取 Mission 的完整追踪
   *
   * @param missionId - Mission ID
   * @returns MissionTrace | undefined
   */
  getTrace(missionId: string): MissionTrace | undefined {
    const spanIds = this.missions.get(missionId)
    if (!spanIds || spanIds.length === 0) return undefined

    const spans = spanIds.map(id => this.spans.get(id)).filter((s): s is TraceSpan => s !== undefined)
    const rootSpan = spans.find(s => !s.parentSpanId)

    if (!rootSpan) return undefined

    const completedSpans = spans.filter(s => s.status === 'completed' || s.status === 'failed')
    const totalDuration = completedSpans.length > 0
      ? Math.max(...completedSpans.map(s => (s.endTime || s.startTime) - s.startTime))
      : 0

    const anyFailed = spans.some(s => s.status === 'failed')
    const allCompleted = spans.every(s => s.status !== 'started')

    return {
      missionId,
      spans,
      totalDuration,
      status: anyFailed ? 'failed' : allCompleted ? 'completed' : 'in_progress',
      rootSpan,
    }
  }

  /**
   * getActiveTraces — 获取所有活跃追踪
   */
  getActiveTraces(): MissionTrace[] {
    const active: MissionTrace[] = []
    for (const [missionId] of this.missions) {
      const trace = this.getTrace(missionId)
      if (trace && trace.status === 'in_progress') {
        active.push(trace)
      }
    }
    return active
  }

  /**
   * exportTree — 导出追踪的树形文本表示
   *
   * @param missionId - Mission ID
   * @returns 树形结构文本
   */
  exportTree(missionId: string): string {
    const trace = this.getTrace(missionId)
    if (!trace) return `Trace not found: ${missionId}`

    const spanMap = new Map<string, TraceSpan>()
    for (const span of trace.spans) {
      spanMap.set(span.spanId, span)
    }

    const children = new Map<string, TraceSpan[]>()
    for (const span of trace.spans) {
      if (span.parentSpanId) {
        if (!children.has(span.parentSpanId)) {
          children.set(span.parentSpanId, [])
        }
        children.get(span.parentSpanId)!.push(span)
      }
    }

    const render = (spanId: string, depth: number): string => {
      const span = spanMap.get(spanId)
      if (!span) return ''

      const indent = '  '.repeat(depth)
      const duration = span.endTime ? `${span.endTime - span.startTime}ms` : 'in_progress'
      const statusIcon = span.status === 'completed' ? '✓' : span.status === 'failed' ? '✗' : '…'
      let result = `${indent}${statusIcon} ${span.name} (${duration})`

      const childSpans = children.get(spanId) || []
      for (const child of childSpans) {
        result += '\n' + render(child.spanId, depth + 1)
      }

      return result
    }

    return `Trace: ${missionId}\n${render(trace.rootSpan.spanId, 0)}`
  }
}
