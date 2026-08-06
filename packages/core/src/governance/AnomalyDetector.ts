/**
 * AnomalyDetector — 异常告警（会话 16d · P3 可观测性与运维 2）
 *
 * 监听 EventBus 事件流，检测运行异常并发射 observability.anomaly：
 *   - empty-param-spike     空参率突升（近 20 步 retryable 失败率 > 30%——79.4% 瓶颈的实时告警）
 *   - repeated-primitive    同节点连续失败 ≥ 3 次（原语持续失败）
 *   - assembly-timeout      装配耗时 > 5000ms（上下文膨胀风险）
 *
 * 去抖：同类型 30s 冷却（避免风暴刷屏）。历史可查 getAnomalies（供观测端点/UI）。
 *
 * @packageDocumentation
 */

import type { EventBus } from '../infrastructure/common/EventBus.js';

export type AnomalyType = 'empty-param-spike' | 'repeated-primitive' | 'assembly-timeout';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: 'warning' | 'critical';
  detail: string;
  timestamp: number;
}

/** 空参率突升阈值（近 20 步 retryable 失败占比） */
const EMPTY_PARAM_RATE_THRESHOLD = 0.3;
/** 连续失败告警阈值 */
const CONSECUTIVE_FAIL_THRESHOLD = 3;
/** 装配超时阈值（ms） */
const ASSEMBLY_TIMEOUT_MS = 5000;
/** 同类告警冷却（ms） */
const ALERT_COOLDOWN_MS = 30000;

export class AnomalyDetector {
  private anomalies: Anomaly[] = [];
  private stepWindow: Array<{ success?: boolean; errorClass?: string }> = [];
  private consecutiveFails = new Map<string, number>();
  private lastAlertAt = new Map<AnomalyType, number>();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  /** 挂载事件监听（EventBus 就绪后调用） */
  init(eventBus: EventBus): void {
    this.eventBus = eventBus;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus.on('execution.step.result', (e: any) => this.onStepResult(e));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus.on('context.assembly.telemetry', (e: any) => this.onAssemblyTelemetry(e));
  }

  /** 最近告警（观测端点数据源） */
  getAnomalies(limit = 50): Anomaly[] {
    return this.anomalies.slice(-limit);
  }

  // ── 内部 ──

  private onStepResult(e: { payload?: { success?: boolean; errorClass?: string; nodeId?: string; nodeName?: string } }): void {
    const p = e.payload ?? {};
    // 滑动窗口（近 20 步）
    this.stepWindow.push({ success: p.success, errorClass: p.errorClass });
    if (this.stepWindow.length > 20) this.stepWindow.shift();

    // 1. 空参率突升（窗口够 10 步才判，避免小样本误报）
    if (this.stepWindow.length >= 10) {
      const emptyFails = this.stepWindow.filter(s => s.success === false && s.errorClass === 'retryable').length;
      const rate = emptyFails / this.stepWindow.length;
      if (rate > EMPTY_PARAM_RATE_THRESHOLD) {
        this.alert('empty-param-spike', 'warning', `近 ${this.stepWindow.length} 步 retryable/空参失败率 ${(rate * 100).toFixed(0)}% > ${EMPTY_PARAM_RATE_THRESHOLD * 100}%`);
      }
    }

    // 2. 同节点连续失败（原语持续失败）
    const key = p.nodeId ?? p.nodeName ?? 'unknown';
    if (p.success === false) {
      this.consecutiveFails.set(key, (this.consecutiveFails.get(key) ?? 0) + 1);
    } else {
      this.consecutiveFails.set(key, 0);
    }
    const consec = this.consecutiveFails.get(key) ?? 0;
    if (consec >= CONSECUTIVE_FAIL_THRESHOLD && consec % CONSECUTIVE_FAIL_THRESHOLD === 0) {
      this.alert('repeated-primitive', 'warning', `节点 ${key} 连续失败 ${consec} 次`);
    }
  }

  private onAssemblyTelemetry(e: { payload?: { durationMs?: number; missionId?: string } }): void {
    const duration = e.payload?.durationMs ?? 0;
    if (duration > ASSEMBLY_TIMEOUT_MS) {
      this.alert('assembly-timeout', 'warning', `装配耗时 ${duration}ms > ${ASSEMBLY_TIMEOUT_MS}ms（mission=${e.payload?.missionId ?? '?'}，上下文膨胀风险）`);
    }
  }

  private alert(type: AnomalyType, severity: 'warning' | 'critical', detail: string): void {
    // 冷却去抖
    const last = this.lastAlertAt.get(type) ?? 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(type, Date.now());

    const anomaly: Anomaly = {
      id: `anom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      severity,
      detail,
      timestamp: Date.now(),
    };
    this.anomalies.push(anomaly);
    this.eventBus?.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'observability.anomaly',
      timestamp: Date.now(),
      executionId: `anom_${type}`,
      source: 'anomaly-detector',
      payload: anomaly,
    });
    console.warn(`[AnomalyDetector] 🚨 [${type}] ${detail}`);
  }
}
