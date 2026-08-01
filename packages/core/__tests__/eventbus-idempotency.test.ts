/**
 * EventBus 幂等性与可靠性测试（L8 Infrastructure）
 *
 * 覆盖：
 *   1. at-least-once 投递语义（同事件重发两次 → 消费者收到两次，需消费侧幂等）
 *   2. 消费侧幂等模式：按 event.id 去重 → 重投只生效一次
 *   3. 单消费者抛错 → 不阻塞其他消费者（错误隔离）
 *   4. once 一次性订阅
 *   5. 通配符订阅（runtime.*）
 *   6. 领域作用域（emitToDomain / onDomain）
 *   7. 事件历史保留与 projected 历史
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../src/infrastructure/common/types.js';

function makeEvent(type: string, overrides: Partial<MorPexEvent> = {}): MorPexEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: Date.now(),
    executionId: 'exe-test',
    source: 'test',
    payload: {},
    ...overrides,
  };
}

describe('EventBus — 幂等性与可靠性', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('at-least-once：同事件重投两次 → 消费者收到两次', () => {
    const received: string[] = [];
    bus.on('runtime.task.completed', (e) => received.push(e.id));

    const event = makeEvent('runtime.task.completed', { id: 'evt_dup_1' });
    bus.emit(event);
    bus.emit(event); // 重投（至少一次语义允许重复投递）

    expect(received).toEqual(['evt_dup_1', 'evt_dup_1']);
  });

  it('消费侧幂等：按 event.id 去重 → 重投只生效一次', () => {
    // 幂等消费者：记录已处理 id，重复投递被忽略
    const processed = new Set<string>();
    let sideEffectCount = 0;
    bus.on('artifact.created', (e) => {
      if (processed.has(e.id)) return; // 幂等守卫
      processed.add(e.id);
      sideEffectCount++;
    });

    const event = makeEvent('artifact.created', { id: 'evt_artifact_42' });
    bus.emit(event);
    bus.emit(event); // 网络/重试导致的重投

    expect(sideEffectCount).toBe(1); // 副作用只发生一次
    expect(processed.has('evt_artifact_42')).toBe(true);
  });

  it('错误隔离：一个消费者抛错不阻塞其他消费者', () => {
    const calls: string[] = [];
    bus.on('runtime.execution.started', () => { throw new Error('consumer boom'); });
    bus.on('runtime.execution.started', (e) => calls.push(e.type));

    bus.emit(makeEvent('runtime.execution.started'));

    expect(calls).toEqual(['runtime.execution.started']); // 第二个消费者仍执行
    expect(bus.getMetrics().errorCount).toBeGreaterThan(0); // 错误被记录
  });

  it('once：一次性订阅只触发一次', () => {
    let count = 0;
    bus.once('kernel.booted', () => count++);
    bus.emit(makeEvent('kernel.booted'));
    bus.emit(makeEvent('kernel.booted'));
    expect(count).toBe(1);
  });

  it('通配符订阅：runtime.* 收到 runtime.task.completed', () => {
    const received: string[] = [];
    bus.on('runtime.*', (e) => received.push(e.type));
    bus.emit(makeEvent('runtime.task.completed'));
    bus.emit(makeEvent('runtime.phase.changed'));
    expect(received).toEqual(['runtime.task.completed', 'runtime.phase.changed']);
  });

  it('领域作用域：emitToDomain 只投递给 onDomain 监听器', () => {
    const scoped: string[] = [];
    const other: string[] = [];
    bus.onDomain('ecommerce', 'domain.task', (e) => scoped.push(e.type));
    bus.onDomain('hardware', 'domain.task', (e) => other.push(e.type));

    bus.emitToDomain('ecommerce', makeEvent('domain.task'));
    expect(scoped).toEqual(['domain.task']);
    expect(other).toEqual([]); // hardware 域不收到
  });

  it('取消订阅：on 返回的 unsub 生效后不再收到', () => {
    let count = 0;
    const unsub = bus.on('gateway.request', () => count++);
    bus.emit(makeEvent('gateway.request'));
    unsub();
    bus.emit(makeEvent('gateway.request'));
    expect(count).toBe(1);
  });

  it('历史保留：emit 后可从历史中回溯（含重投的重复事件）', () => {
    const event = makeEvent('kernel.booted');
    bus.emit(event);
    bus.emit(event);
    const history = bus.getHistory();
    expect(history.filter((h) => h.id === event.id)).toHaveLength(2);
  });

  it('projected 历史：projected 事件进入独立投射历史，internal 事件不进入', () => {
    bus.emit(makeEvent('artifact.created'));      // projected 前缀
    bus.emit(makeEvent('agent.started'));          // internal 前缀（agent.）
    const projected = bus.getProjectedHistory();
    expect(projected.some((p) => p.type === 'artifact.created')).toBe(true);
    expect(projected.some((p) => p.type === 'agent.started')).toBe(false);
  });

  it('事件类型校验：缺 executionId 与缺命名空间只告警不抛错', () => {
    expect(() => bus.emit({ id: 'x', type: 'flat', timestamp: Date.now(), executionId: '', source: 't', payload: {} })).not.toThrow();
    expect(() => bus.emit({ id: 'x', type: 'noexec', timestamp: Date.now(), executionId: '', source: 't', payload: {} })).not.toThrow();
  });
});
