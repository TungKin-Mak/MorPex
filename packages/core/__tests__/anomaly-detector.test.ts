/**
 * 异常告警检测器测试（会话 16d · P3 运维 2）
 *
 * 覆盖：
 *   1. 空参率突升（近 20 步 retryable 失败率 > 30%）→ empty-param-spike
 *   2. 同节点连续失败 ≥ 3 次 → repeated-primitive
 *   3. 装配耗时 > 5000ms → assembly-timeout
 *   4. 冷却去抖（同类 30s 内不重复告警）+ 正常流不误报
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { AnomalyDetector } from '../src/governance/AnomalyDetector.js';

function stepEvent(payload: { success?: boolean; errorClass?: string; nodeId?: string; nodeName?: string }): unknown {
  return { type: 'execution.step.result', payload };
}

function asmEvent(durationMs: number): unknown {
  return { type: 'context.assembly.telemetry', payload: { durationMs, missionId: 'm1' } };
}

describe('AnomalyDetector — 异常告警', () => {
  let bus: EventBus;
  let detector: AnomalyDetector;

  beforeEach(() => {
    bus = new EventBus();
    detector = new AnomalyDetector();
    detector.init(bus);
  });

  it('空参率突升（近 20 步 retryable 失败率高）→ empty-param-spike 告警', () => {
    // 造 20 步：7 步 retryable 失败（35% > 30%）
    for (let i = 0; i < 20; i++) {
      const fail = i < 7;
      bus.emit(stepEvent({ success: !fail, errorClass: fail ? 'retryable' : 'none', nodeId: `n${i}` }) as never);
    }
    const anomalies = detector.getAnomalies();
    expect(anomalies.some(a => a.type === 'empty-param-spike')).toBe(true);
    expect(anomalies[0].severity).toBe('warning');
  });

  it('正常流（低失败率）→ 不误报', () => {
    for (let i = 0; i < 20; i++) {
      bus.emit(stepEvent({ success: true, errorClass: 'none', nodeId: `n${i}` }) as never);
    }
    expect(detector.getAnomalies().filter(a => a.type === 'empty-param-spike')).toHaveLength(0);
  });

  it('同节点连续失败 ≥ 3 次 → repeated-primitive 告警', () => {
    for (let i = 0; i < 3; i++) {
      bus.emit(stepEvent({ success: false, errorClass: 'retryable', nodeId: 'shell', nodeName: '跑命令' }) as never);
    }
    const anomalies = detector.getAnomalies();
    expect(anomalies.some(a => a.type === 'repeated-primitive')).toBe(true);
    expect(anomalies.filter(a => a.type === 'repeated-primitive')[0].detail).toContain('shell');
  });

  it('装配耗时 > 5000ms → assembly-timeout 告警', () => {
    bus.emit(asmEvent(6000) as never);
    const anomalies = detector.getAnomalies();
    expect(anomalies.some(a => a.type === 'assembly-timeout')).toBe(true);
  });

  it('装配耗时正常 → 不告警', () => {
    bus.emit(asmEvent(800) as never);
    expect(detector.getAnomalies().some(a => a.type === 'assembly-timeout')).toBe(false);
  });

  it('同类告警冷却去抖（30s 内不重复）', () => {
    for (let i = 0; i < 20; i++) {
      bus.emit(stepEvent({ success: false, errorClass: 'retryable', nodeId: `n${i}` }) as never);
    }
    const count1 = detector.getAnomalies().filter(a => a.type === 'empty-param-spike').length;
    // 再触发一轮（冷却内 → 不新增）
    for (let i = 0; i < 20; i++) {
      bus.emit(stepEvent({ success: false, errorClass: 'retryable', nodeId: `n${i}` }) as never);
    }
    const count2 = detector.getAnomalies().filter(a => a.type === 'empty-param-spike').length;
    expect(count1).toBe(1);
    expect(count2).toBe(1); // 冷却生效
  });
});
