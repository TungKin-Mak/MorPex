/**
 * SafetyMonitor — 安全监控器
 * Phase 2: 持续观察系统状态，检测异常模式
 */
import { EventBus } from '../common/EventBus.js';

export interface Observation {
  id: string;
  type: 'metric_anomaly' | 'failure_spike' | 'performance_degradation' | 'cost_surge' | 'quality_drop' | 'security_event';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
  source: string;
}

export class SafetyMonitor {
  private observations: Observation[] = [];
  private thresholds: Map<string, number> = new Map();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
    this.thresholds.set('task_success_rate', 0.7);
    this.thresholds.set('avg_latency_ms', 60000);
    this.thresholds.set('cost_per_task', 5.0);
    this.thresholds.set('retry_rate', 0.3);
    this.thresholds.set('artifact_quality', 0.6);
  }

  setThreshold(metric: string, value: number): void {
    this.thresholds.set(metric, value);
  }

  observe(metrics: { taskSuccessRate?: number; avgLatency?: number; costPerTask?: number; retryRate?: number; artifactQuality?: number }): Observation[] {
    const newObservations: Observation[] = [];

    if (metrics.taskSuccessRate !== undefined && metrics.taskSuccessRate < (this.thresholds.get('task_success_rate') || 0.7)) {
      newObservations.push({
        id: `obs_${Date.now()}_1`, type: 'metric_anomaly', severity: 'WARNING',
        metric: 'task_success_rate', value: metrics.taskSuccessRate,
        threshold: this.thresholds.get('task_success_rate') || 0.7,
        message: `任务成功率 ${Math.round(metrics.taskSuccessRate * 100)}% 低于阈值 ${Math.round((this.thresholds.get('task_success_rate') || 0.7) * 100)}%`,
        timestamp: Date.now(), source: 'safety-monitor',
      });
    }
    if (metrics.avgLatency !== undefined && metrics.avgLatency > (this.thresholds.get('avg_latency_ms') || 60000)) {
      newObservations.push({
        id: `obs_${Date.now()}_2`, type: 'performance_degradation', severity: 'WARNING',
        metric: 'avg_latency', value: metrics.avgLatency,
        threshold: this.thresholds.get('avg_latency_ms') || 60000,
        message: `平均延迟 ${Math.round(metrics.avgLatency / 1000)}s 超过阈值 ${(this.thresholds.get('avg_latency_ms') || 60000) / 1000}s`,
        timestamp: Date.now(), source: 'safety-monitor',
      });
    }
    if (metrics.retryRate !== undefined && metrics.retryRate > (this.thresholds.get('retry_rate') || 0.3)) {
      newObservations.push({
        id: `obs_${Date.now()}_3`, type: 'failure_spike', severity: 'CRITICAL',
        metric: 'retry_rate', value: metrics.retryRate,
        threshold: this.thresholds.get('retry_rate') || 0.3,
        message: `重试率 ${Math.round(metrics.retryRate * 100)}% 超过阈值 ${Math.round((this.thresholds.get('retry_rate') || 0.3) * 100)}%`,
        timestamp: Date.now(), source: 'safety-monitor',
      });
    }
    if (newObservations.length > 0) {
      this.observations.push(...newObservations);
      if (this.eventBus) {
        for (const obs of newObservations) {
          this.eventBus.emit({
            id: obs.id, type: `safety.${obs.severity.toLowerCase()}`, timestamp: Date.now(),
            executionId: 'safety', source: 'safety-monitor', payload: obs,
          });
        }
      }
    }
    return newObservations;
  }

  getRecent(limit: number = 20): Observation[] {
    return [...this.observations].reverse().slice(0, limit);
  }

  getCritical(): Observation[] {
    return this.observations.filter(o => o.severity === 'CRITICAL');
  }
}
