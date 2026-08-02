/**
 * 混沌并发测试（L8/L10 韧性）— 填补并发与崩溃注入缺口
 *
 * EventBus 崩溃韧性（扩展 eventbus-idempotency 的单一错误隔离）：
 *   - 消费者在通配符 handler 崩溃 → 不阻塞其他通配符 handler
 *   - 消费者在 projected listener 崩溃 → 其他 projected listener 仍收到
 *   - 多次崩溃后 bus 仍可继续 emit（状态不腐坏）
 *
 * EvolutionSandbox TOCTOU 并发守卫：
 *   - 并发 approveAndApply → apply() 只执行一次（inflight Set 防双执行）
 *   - 并发 rollback → revert() 只执行一次
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../src/infrastructure/common/types.js';
import { EvolutionSandbox } from '../src/evolution/EvolutionSandbox.js';
import type { KnowledgeContextPackage } from '../src/gate/context.js';

function validGateContext(): KnowledgeContextPackage {
  return {
    executionId: `test-exec-${Math.random().toString(36).slice(2)}`,
    riskTier: 'tier-0',
    queryCallCount: 1,
    retrievedIds: ['o1'],
    referenceCheck: { valid: true, missing: [], knownCount: 1 },
    issuedAt: Date.now(),
  };
}

function makeEvent(type: string, overrides: Partial<MorPexEvent> = {}): MorPexEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: Date.now(),
    executionId: 'exe-chaos',
    source: 'chaos-test',
    payload: {},
    ...overrides,
  };
}

describe('EventBus — 崩溃韧性（混沌注入）', () => {
  it('通配符 handler 崩溃 → 不阻塞其他通配符 handler', () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.on('runtime.*', () => { throw new Error('wildcard boom'); });
    bus.on('runtime.*', (e) => received.push(e.type));
    bus.emit(makeEvent('runtime.task.completed'));
    expect(received).toEqual(['runtime.task.completed']);
  });

  it('projected listener 崩溃 → 其他 projected listener 仍收到', () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.onProjected(() => { throw new Error('projected boom'); });
    bus.onProjected((e) => received.push(e.type));
    bus.emit(makeEvent('artifact.created'));
    expect(received).toEqual(['artifact.created']);
  });

  it('多次崩溃后 bus 状态不腐坏（仍可正常 emit/订阅）', () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.on('agent.started', () => { throw new Error('crash 1'); });
    bus.on('agent.started', () => { throw new Error('crash 2'); });
    for (let i = 0; i < 5; i++) {
      bus.emit(makeEvent('agent.started')); // 两个 handler 每次都崩，但 emit 不抛
    }
    bus.on('agent.started', (e) => received.push(e.type)); // 崩溃后仍可加订阅
    bus.emit(makeEvent('agent.started'));
    expect(received).toHaveLength(1);
    expect(bus.getMetrics().errorCount).toBeGreaterThan(0);
  });

  it('崩溃 handler 不影响非崩溃 handler 的精确匹配投递', () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.on('kernel.booted', () => { throw new Error('kernel boom'); });
    bus.on('runtime.execution.started', (e) => received.push(e.type));
    bus.emit(makeEvent('kernel.booted'));
    bus.emit(makeEvent('runtime.execution.started'));
    expect(received).toEqual(['runtime.execution.started']);
  });
});

describe('EvolutionSandbox — TOCTOU 并发守卫', () => {
  it('并发 approveAndApply → apply() 只执行一次（inflight 防双执行）', async () => {
    const sb = new EvolutionSandbox({ goldenTasks: [{ id: 'g1', run: () => true }] });
    let applyCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const rec = await sb.proposeChange({
      summary: '并发测试变更',
      apply: async () => {
        applyCount++;
        await gate; // 让 apply 挂起，制造并发窗口
      },
      revert: async () => {},
    });
    expect(rec.status).toBe('pending_approval');

    // 两个并发调用（第二个应在 inflight 守卫处立即返回）
    const p1 = sb.approveAndApply(rec.id, validGateContext());
    const p2 = sb.approveAndApply(rec.id, validGateContext());
    const r2 = await p2; // inflight 守卫 → 立即 resolve（不进入 apply）
    expect(r2?.id).toBe(rec.id);
    release(); // 释放 apply 挂起点
    const r1 = await p1;

    expect(applyCount).toBe(1); // 关键断言：只执行一次
    const final = sb.getChange(rec.id);
    expect(final?.status).toBe('applied');
  }, 15000);

  it('并发 rollback → revert() 只执行一次', async () => {
    const sb = new EvolutionSandbox({ goldenTasks: [{ id: 'g1', run: () => true }] });
    let revertCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const rec = await sb.proposeChange({
      summary: '回滚并发测试',
      apply: async () => {},
      revert: async () => {
        revertCount++;
        await gate;
      },
    });
    await sb.approveAndApply(rec.id, validGateContext());
    expect(sb.getChange(rec.id)?.status).toBe('applied');

    const p1 = sb.rollback(rec.id);
    const p2 = sb.rollback(rec.id);
    const r2 = await p2; // inflight 守卫 → 立即返回
    expect(r2?.id).toBe(rec.id);
    release();
    const r1 = await p1;

    expect(revertCount).toBe(1);
    expect(sb.getChange(rec.id)?.status).toBe('rolled_back');
  }, 15000);
});
