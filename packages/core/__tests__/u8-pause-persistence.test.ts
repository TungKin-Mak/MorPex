/**
 * u8-pause-persistence.test.ts — P0-2 运行控制态持久化测试
 * 覆盖：① run.paused 事件重放 → getRunState ② RunRegistry.hydrate 三态
 * ③ pause→模拟重启（新 store 重放+水合）→ 不自动调度 → resume → 继续
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PersistentMissionStore } from '../src/execution/runtime/PersistentMissionStore.js';
import { StepEventRecorder } from '../src/execution/runtime/StepEventRecorder.js';
import { RunRegistry } from '../src/execution/runtime/RunRegistry.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { DAGRuntime } from '../src/execution/runtime/dag/DAGRuntime.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
afterEach(() => {
  RunRegistry.resetForTest();
  while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* Windows 句柄滞后 */ } }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('P0-2 运行控制态持久化', () => {
  it('run.paused 事件重放 → 新 store 实例 getRunState=paused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u8-'));
    const db = join(dir, 'missions.db');
    const bus = new EventBus();
    const storeA = new PersistentMissionStore(db);
    await storeA.init();
    new StepEventRecorder().attach(bus, storeA);
    bus.emit({ id: 'e1', type: 'run.paused', timestamp: Date.now(), executionId: 'm1', source: 'test', payload: { missionId: 'm1' } } as never);
    await sleep(50); // 异步 append 落库

    const storeB = new PersistentMissionStore(db); // 模拟重启：全新实例重放同一 db
    await storeB.init();
    expect(storeB.getRunState('m1')).toBe('paused');
  });

  it('hydrate 三态：paused 置位 / cancelled 只置取消 / running 无操作', () => {
    RunRegistry.hydrate('a', 'paused');
    expect(RunRegistry.isPaused('a')).toBe(true);
    expect(RunRegistry.isCancelled('a')).toBe(false);

    RunRegistry.hydrate('b', 'cancelled');
    expect(RunRegistry.isCancelled('b')).toBe(true);
    expect(RunRegistry.isPaused('b')).toBe(false); // cancelled 不复活为暂停

    RunRegistry.hydrate('c', 'running');
    expect(RunRegistry.isPaused('c')).toBe(false);
    expect(RunRegistry.isCancelled('c')).toBe(false);
  });

  it('端到端：pause→重启(重放+水合)→不自动调度→resume→继续跑', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u8-'));
    const db = join(dir, 'missions.db');
    const executed: string[] = [];

    // ── 第一次"进程"：跑 a 后暂停（事件落库）──
    {
      const bus = new EventBus();
      const store = new PersistentMissionStore(db);
      await store.init();
      new StepEventRecorder().attach(bus, store);
      const runtime = new DAGRuntime({
        eventBus: bus,
        nodeHandler: async (n: { id: string }) => { executed.push(n.id); await sleep(40); return `out-${n.id}`; },
        shouldPause: () => executed.includes('a'),
      });
      await runtime.run({ id: 'dag-x', nodes: [{ id: 'a', deps: [] }, { id: 'b', deps: ['a'] }], edges: [] }, { missionId: 'm-r' });
      // 模拟 API 路由动作：pause 标志 + 事件发总线
      RunRegistry.pause('m-r');
      bus.emit({ id: 'e2', type: 'run.paused', timestamp: Date.now(), executionId: 'm-r', source: 'test', payload: { missionId: 'm-r' } } as never);
      await sleep(60);
    }

    // ── 第二次"进程"：新 store 重放 + RunRegistry 水合（ServiceContainer 同款逻辑）──
    {
      const store = new PersistentMissionStore(db);
      await store.init();
      for (const m of store.getAll()) {
        const rs = store.getRunState(m.missionId);
        if (rs === 'paused' || rs === 'cancelled') RunRegistry.hydrate(m.missionId, rs);
      }
      expect(executed).toEqual(['a']); // 第一进程只完成 a
    }
    expect(RunRegistry.isPaused('m-r')).toBe(true); // 水合后暂停态存活

    // ── 暂停期间不应自动调度 b；resume 后继续 ──
    const bus2 = new EventBus();
    const store2 = new PersistentMissionStore(db);
    await store2.init();
    new StepEventRecorder().attach(bus2, store2);
    const runtime2 = new DAGRuntime({
      eventBus: bus2,
      nodeHandler: async (n: { id: string }) => { executed.push(n.id); await sleep(30); return `out-${n.id}`; },
      shouldPause: () => RunRegistry.isPaused('m-r'),
    });
    const r2 = await runtime2.run({ id: 'dag-x2', nodes: [{ id: 'b', deps: [] }], edges: [] }, { missionId: 'm-r' });
    expect(r2.paused).toBe(true);      // 暂停水合生效：run 立即返回，不执行
    expect(executed).not.toContain('b');

    RunRegistry.resume('m-r');          // 解除暂停
    const r3 = await runtime2.run({ id: 'dag-x3', nodes: [{ id: 'b', deps: [] }], edges: [] }, { missionId: 'm-r' });
    void r3;
    await sleep(60);
    expect(executed).toContain('b');   // resume 后重入继续
  });
});
