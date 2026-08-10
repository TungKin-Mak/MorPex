export { MetricsCollector } from './MetricsCollector.js'
export type { MetricPoint, V9Metrics } from './MetricsCollector.js'

export { TraceManager } from './TraceManager.js'
export type { TraceSpan, MissionTrace } from './TraceManager.js'

export { WorkflowMetrics } from './WorkflowMetrics.js'
export type { WorkflowMetricsSnapshot } from './WorkflowMetrics.js'

export { CompactionService } from './CompactionService.js'
export type { CompactionConfig, CompactionResult } from './CompactionService.js'

export { PrometheusExporter } from './PrometheusExporter.js'
export type { PrometheusMetrics } from './PrometheusExporter.js'

export { HealthCheckService } from './HealthCheckService.js'
export type { HealthStatus, HealthCheck } from './HealthCheckService.js'

export { bootstrapObservability } from './ObservabilityBootstrap.js'
export type { ObservabilityConfig } from './ObservabilityBootstrap.js'

// ── 去黑盒化公共基础设施（L0/L1/L2 三层记录，docs/DEBLACKBOX_PLAN.md）──
export { RecordPolicy } from './deblackbox/index.js'
export type { DeblackboxLevel, RecordPolicySnapshot } from './deblackbox/index.js'
export { DEBLACKBOX_DEFAULT_TTL, DEBLACKBOX_DEFAULT_SAMPLING } from './deblackbox/index.js'
export { DeblackboxDetailStore } from './deblackbox/index.js'
export type { DeblackboxDetailRecord } from './deblackbox/index.js'
export { DeblackboxRecorder, getSharedDeblackboxRecorder, resetSharedDeblackboxRecorder } from './deblackbox/index.js'
export type { DeblackboxRecord } from './deblackbox/index.js'
export { RecordCleaner } from './deblackbox/index.js'
export type { RecordCleanerResult } from './deblackbox/index.js'
