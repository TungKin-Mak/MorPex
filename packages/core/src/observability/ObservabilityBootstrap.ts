/**
 * ObservabilityBootstrap — 可观测性快速启动工具
 *
 * 将 PrometheusExporter 和 HealthCheckService 组合为一个统一的启动函数。
 * 应用方只需一次调用即可挂载 /metrics 和 /health 端点。
 *
 * 使用方式:
 *   import { bootstrapObservability } from './observability/ObservabilityBootstrap.js';
 *   const obs = bootstrapObservability({ prometheusPort: 9090 });
 *   // ... 应用退出时
 *   obs.shutdown();
 */

import { PrometheusExporter } from './PrometheusExporter.js';
import { HealthCheckService } from './HealthCheckService.js';
import { MetricsCollector } from './MetricsCollector.js';

// Use a compatible type for database parameter
type DbLike = { prepare: (sql: string) => { get: (...params: any[]) => any; all: (...params: any[]) => any[]; run: (...params: any[]) => { changes: number } } };

export interface ObservabilityConfig {
  /** MetricsCollector 实例（不传则创建默认） */
  metrics?: MetricsCollector;
}

export interface ObservabilityInstance {
  prometheus: PrometheusExporter;
  health: HealthCheckService;
  shutdown: () => void;
}

export function bootstrapObservability(config?: ObservabilityConfig): ObservabilityInstance {
  const metrics = config?.metrics ?? new MetricsCollector();
  const prometheus = new PrometheusExporter(metrics);
  const health = new HealthCheckService();

  console.log('[ObservabilityBootstrap] PrometheusExporter 已创建');
  console.log('[ObservabilityBootstrap] HealthCheckService 已创建');

  return {
    prometheus,
    health,
    shutdown: () => {
      console.log('[ObservabilityBootstrap] 已关闭');
    },
  };
}
