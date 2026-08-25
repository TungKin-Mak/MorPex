/**
 * u23-run-control.test.ts — U2+U3 运行控制与断点续跑测试
 * 覆盖：① pause 停住调度 ② cancel → pending 全 skipped + 重启不复活 ③ 冷恢复只重跑未完成步骤
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
  // Windows 下 sqlite 句柄释放滞后，不强删（OS 兜底）
  while (dirs.length) dirs.pop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'u23-'));
  dirs.push(dir);
  const bus = new EventBus();
  const store = new PersistentMissionStore(join(dir, 'missions.db'));
  return { bus, store, ready: store.init().then(() => new StepEventRecorder().attach(bus, store)) };
}

describe('U2+U3 运行控制与断点续跑', () => {
  it('pause 后当前步骤完成即停（不再调度后续步骤）', async () => {
    const { bus, store, ready } = setup();
    await ready;
    const executed: string[] = [];

    const runtime = new DAGRuntime({
      eventBus: bus,
      nodeHandler: async (n: { id: string }) => {
        executed.push(n.id);
        await sleep(60);
        return `out-${n.id}`;
      },
      // a 执行完成后即暂停（模拟“跑到一半踩刹车”），b 不应再被调度
      shouldPause: () => executed.includes('a'),
    });

    const dag = {
      id: 'dag-p', nodes: [
        { id: 'a', name: 'A', agentType: 'step', description: '', deps: [], maxRetries: 0 },
        { id: 'b', name: 'B', agentType: 'step', description: '', deps: ['a'] },
      ], edges: [{ from: 'a', to: 'b' }], status: 'RUNNING', createdAt: Date.now(),
    } as never;
    RunRegistry.pause('m-pause');
    const result = await runtime.run(dag, { missionId: 'm-pause' });
    RunRegistry.resume('m-pause');

    expect(result.paused).toBe(true);
    expect(result.endedBy).toBe('paused');
    expect(executed).toContain('a');
    expect(executed).not.toContain('b'); // b 未被调度
    void store;
  });

  it('cancel → pending 节点全部 skipped，事件源记录且重启后不复活', async () => {
    const { bus, store, ready } = setup();
    await ready;
    const dbDir = dirs[dirs.length - 1];

    const runtime = new DAGRuntime({
      eventBus: bus,
      shouldCancel: (mid) => RunRegistry.isCancelled(mid),
      nodeHandler: async () => {
        await sleep(40);
        return 'out';
      },
    });

    // 执行前就取消：所有节点应直接 skipped
    RunRegistry.cancel('m-cancel');
    // 模拟 StudioServer 路由行为：经总线发 run.cancelled（事件源记录，重启不复活）
    bus.emit({ id: `rc-${Date.now()}`, type: 'run.cancelled', timestamp: Date.now(), executionId: 'm-cancel', source: 'test', payload: { missionId: 'm-cancel' } });
    const dag = {
      id: 'dag-c', nodes: [
        { id: 'x', name: 'X', agentType: 'step', description: '', deps: [] },
        { id: 'y', name: 'Y', agentType: 'step', description: '', deps: ['x'] },
      ], edges: [{ from: 'x', to: 'y' }], status: 'RUNNING', createdAt: Date.now(),
    } as never;
    const result = await runtime.run(dag, { missionId: 'm-cancel' });

    expect(result.cancelled).toBe(true);
    expect(result.endedBy).toBe('cancelled');

    for (let i = 0; i < 30 && ([...store.getStepStates('m-cancel').values()].filter((s) => s.status === 'skipped').length < 2); i++) {
      await sleep(20);
    }
    const statuses = [...store.getStepStates('m-cancel').values()].map((s) => s.status);
    expect(statuses.filter((s) => s === 'skipped').length).toBe(2);

    // 重启不复活：新实例同库重放，run 态仍是 cancelled
    const store2 = new PersistentMissionStore(join(dbDir, 'missions.db'));
    await store2.init();
    expect(store2.getRunState('m-cancel')).toBe('cancelled');
  });

  it('冷恢复：已完成步骤不重跑，下游可消费其结果预览', async () => {
    const { bus, store, ready } = setup();
    await ready;

    // 手动模拟"a 完成后进程中断"：直接落 started/completed 事件 + 计划快照
    bus.emit({ id: 'p1', type: 'execution.dag', timestamp: Date.now(), executionId: 'g-r', source: 'test', payload: { missionId: 'm-resume', nodes: [{ id: 'a', name: 'A', deps: [] }, { id: 'b', name: 'B', deps: ['a'] }], edges: [{ from: 'a', to: 'b' }] } });
    bus.emit({ id: 'p2', type: 'workflow.step_started', timestamp: Date.now(), executionId: 'g-r', source: 'test', payload: { missionId: 'm-resume', nodeId: 'a', nodeName: 'A' } });
    bus.emit({ id: 'p3', type: 'workflow.step_completed', timestamp: Date.now() + 1, executionId: 'g-r', source: 'test', payload: { missionId: 'm-resume', nodeId: 'a', nodeName: 'A', output: 'A 的成果预览' } });
    await sleep(80);

    // 从事件源重建 DAG：a 恢复为 success（带结果预览），b 待执行
    const plan = store.getDagPlan('m-resume');
    expect(plan).not.toBeNull();
    const states = store.getStepStates('m-resume');
    const rebuilt = {
      id: `resume_m-resume`,
      nodes: plan!.nodes.map((n) => ({
        ...(n as Record<string, unknown>),
        deps: Array.isArray(n.deps) ? n.deps : [],
        initialStatus: states.get(String(n.id))?.status === 'success' ? 'success' : undefined,
        initialOutput: states.get(String(n.id))?.outputPreview ?? undefined,
      })),
      edges: plan!.edges,
      status: 'RUNNING',
      createdAt: Date.now(),
    } as never;

    let bSawUpstream: unknown = null;
    const runtime = new DAGRuntime({
      eventBus: bus,
      nodeHandler: async (n: { id: string }, ctx: unknown) => {
        if (n.id === 'b') {
          const up = (ctx as { upstreamResults?: Map<string, unknown> }).upstreamResults;
          bSawUpstream = up?.get('a') ?? null;
        }
        return `out-${n.id}`;
      },
    });
    const result = await runtime.run(rebuilt, { missionId: 'm-resume' });

    // 等 b 的完成事件异步落盘
    for (let i = 0; i < 50; i++) {
      const c = [...store.getStepStates('m-resume').values()].filter((s) => s.status === 'success').length;
      if (c >= 2) break;
      await sleep(20);
    }

    expect(result.success).toBe(true);
    expect(bSawUpstream).toBe('A 的成果预览'); // 下游消费到 a 的恢复结果
    const executedStatuses = [...store.getStepStates('m-resume').values()].map((s) => s.status);
    expect(executedStatuses.filter((s) => s === 'success').length).toBe(2); // a(恢复)+b(新执行)
  });
});
