/**
 * P2 优化测试（会话 16l·3）
 *
 * 覆盖：
 *   1. batch 并发自适应（currentAdaptiveConcurrency 纯函数）：限流降并发/恢复、禁用时恒返回上限
 *   2. TraceRecorder 采样/开关：disabled 零记录、sampleRate 采样、maxCalls 上限
 */

import { describe, it, expect } from 'vitest';
import { currentAdaptiveConcurrency } from '../../../scripts/batch-run.js';
import { createTraceSession } from '../../../scripts/tracing/TraceRecorder.js';

// ═══════════════════════════════════════════════════════════════
// P2-9 batch 并发自适应
// ═══════════════════════════════════════════════════════════════

describe('batch 并发自适应（P2-9）', () => {
  const cfg = { enabled: true, maxConcurrency: 5, minConcurrency: 2 };

  it('禁用时恒返回上限并发（尊重显式 --concurrency）', () => {
    const r = currentAdaptiveConcurrency({ enabled: false, maxConcurrency: 5, minConcurrency: 2 }, 0, 0, 5);
    expect(r).toBe(5);
  });

  it('上一批大量限流（>50%）→ 本批并发减半（不低于 min）', () => {
    const r = currentAdaptiveConcurrency(cfg, 1, 4, 5); // 4/5 = 80% 限流
    expect(r).toBeLessThan(5);
    expect(r).toBeGreaterThanOrEqual(2);
  });

  it('上一批零限流 → 并发恢复上限', () => {
    // 先限流降并发
    const low = currentAdaptiveConcurrency(cfg, 1, 5, 5); // 全限流 → 降
    expect(low).toBeLessThan(5);
    // 下一批零限流 → 恢复
    const recovered = currentAdaptiveConcurrency(cfg, 2, 0, 5);
    expect(recovered).toBe(5);
  });

  it('结果不越界（始终在 [min, max] 内）', () => {
    for (let i = 0; i < 10; i++) {
      const r = currentAdaptiveConcurrency(cfg, i, i % 2 === 0 ? 5 : 0, 5);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// P2-10 TraceRecorder 采样/开关
// ═══════════════════════════════════════════════════════════════

describe('TraceRecorder 采样/开关（P2-10）', () => {
  class SampleSvc {
    hello(x: string): string { return `hi:${x}`; }
    add(a: number, b: number): number { return a + b; }
  }

  it('disabled → 零记录、零丢弃（wrap 安全跳过）', () => {
    const trace = createTraceSession('t', { enabled: false });
    const svc = new SampleSvc();
    trace.wrap(svc, 'svc');
    svc.hello('x');
    svc.add(1, 2);
    expect(trace.size()).toBe(0);
    expect(trace.stats().recorded).toBe(0);
    // 原始行为不被破坏
    expect(svc.hello('x')).toBe('hi:x');
  });

  it('默认全量 → 每次调用都记录', () => {
    const trace = createTraceSession('t');
    const svc = new SampleSvc();
    trace.wrap(svc, 'svc', ['hello', 'add']);
    svc.hello('a');
    svc.add(1, 2);
    svc.hello('b');
    expect(trace.size()).toBe(3);
    const report = trace.report();
    expect(report[0].fn).toBe('svc.hello');
    expect(report[0].ok).toBe(true);
  });

  it('maxCalls 上限 → 超出停止记录（droppedByCap）', () => {
    const trace = createTraceSession('t', { maxCalls: 2 });
    const svc = new SampleSvc();
    trace.wrap(svc, 'svc', ['hello']);
    svc.hello('1');
    svc.hello('2');
    svc.hello('3'); // 超出上限 → 丢弃
    expect(trace.size()).toBe(2);
    expect(trace.stats().droppedByCap).toBe(1);
  });

  it('sampleRate=1 → 全量；sampleRate=0 → 全丢弃', () => {
    const all = createTraceSession('t', { sampleRate: 1 });
    const svc = new SampleSvc();
    all.wrap(svc, 'svc', ['hello']);
    svc.hello('x');
    expect(all.size()).toBe(1);

    const none = createTraceSession('t2', { sampleRate: 0 });
    const svc2 = new SampleSvc();
    none.wrap(svc2, 'svc', ['hello']);
    svc2.hello('y');
    expect(none.size()).toBe(0);
    expect(none.stats().droppedBySample).toBe(1);
  });

  it('采样率 0.5 → 记录约半（统计字段可见）', () => {
    const trace = createTraceSession('t', { sampleRate: 0.5 });
    const svc = new SampleSvc();
    trace.wrap(svc, 'svc', ['hello']);
    for (let i = 0; i < 100; i++) svc.hello(String(i));
    const stats = trace.stats();
    expect(stats.recorded + stats.droppedBySample).toBe(100);
    expect(stats.recorded).toBeGreaterThan(0);
    expect(stats.recorded).toBeLessThan(100);
  });
});
