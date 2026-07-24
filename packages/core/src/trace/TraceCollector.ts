import type { TraceSpan } from './TraceSpan.js';

export class TraceCollector {
  private spans: TraceSpan[] = [];
  private activeSpans: Map<string, TraceSpan> = new Map();

  start(name: string, type: TraceSpan['type'], parentSpanId?: string): string {
    const span: TraceSpan = {
      spanId: `span_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      parentSpanId, name, type, status: 'STARTED', startTime: Date.now(), metadata: {}, tags: [],
    };
    this.activeSpans.set(span.spanId, span);
    return span.spanId;
  }

  end(spanId: string, metadata?: Record<string, unknown>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.status = 'COMPLETED';
    span.endTime = Date.now();
    span.duration = Date.now() - span.startTime;
    if (metadata) span.metadata = { ...span.metadata, ...metadata };
    this.activeSpans.delete(spanId);
    this.spans.push(span);
  }

  fail(spanId: string, error: string): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.status = 'FAILED';
    span.endTime = Date.now();
    span.duration = Date.now() - span.startTime;
    span.metadata.error = error;
    this.activeSpans.delete(spanId);
    this.spans.push(span);
  }

  getTrace(goalId?: string): TraceSpan[] {
    return goalId ? this.spans.filter(s => s.metadata.goalId === goalId) : [...this.spans];
  }
  getActiveSpans(): TraceSpan[] { return [...this.activeSpans.values()]; }
  clear(): void { this.spans = []; this.activeSpans.clear(); }
  getAll(): TraceSpan[] { return [...this.spans, ...this.activeSpans.values()]; }
}
