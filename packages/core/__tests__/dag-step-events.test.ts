/**
 * dag-step-events.test.ts — U2+U3 步骤级事件溯源测试
 * 覆盖：① 状态变迁→事件落盘 ② 重放重建节点状态 ③ 降级路径显式告警
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PersistentMissionStore } from '../src/execution/runtime/PersistentMissionStore.js';
import { StepEventRecorder } from '../src/execution/runtime/StepEventRecorder.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { DAGRuntime } from '../src/execution/runtime/dag/DAGRuntime.js';
import type { ExecutionDAG } from '../src/execution/runtime/dag/types.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
// Windows 下 better-sqlite3 文件句柄释放滞后，rmSync 常 EPERM——临时目录交给 OS 清理，不强删
afterEach(() => {
  dirs.length = 0;
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dag-step-events-'));
  dirs.push(dir);
  return join(dir, 'missions.db');
}

function makeDag(): ExecutionDAG {
  return {
    id: `dag_${Date.now()}`,
    nodes: [
      { id: 'a', name: '步骤A', agentType: 'step', description: '会失败的一步', deps: [], maxRetries: 0 },
      { id: 'b', name: '步骤B', agentType: 'step', description: '依赖A的一步', deps: ['a'] },
    ],
    edges: [{ from: 'a', to: 'b' }],
  } as unknown as ExecutionDAG;
}

describe('U2+U3 步骤级事件溯源', () => {
  it('状态变迁 → step.* 事件落盘，重放重建节点状态', async () => {
    const dbPath = tempDb();
    const bus = new EventBus();
    const store = new PersistentMissionStore(dbPath);
    await store.init();
    expect(store.isReady()).toBe(true);

    const recorder = new StepEventRecorder();
    recorder.attach(bus, store);

    // 模拟总线事件流（与 DAGRuntime emit 的载荷形态一致）
    bus.emit({ id: 'e1', type: 'workflow.step_started', timestamp: Date.now(), executionId: 'g1', source: 'test', payload: { missionId: 'm1', nodeId: 's1', nodeName: '构建' } });
    bus.emit({ id: 'e2', type: 'workflow.step_completed', timestamp: Date.now() + 1, executionId: 'g1', source: 'test', payload: { missionId: 'm1', nodeId: 's1', nodeName: '构建', output: '构建产物 ABC', truncated: false } });
    bus.emit({ id: 'e3', type: 'workflow.step_failed', timestamp: Date.now() + 2, executionId: 'g1', source: 'test', payload: { missionId: 'm1', nodeId: 's2', nodeName: '测试', error: '断言失败' } });

    // append 是异步的，轮询等待落盘+apply
    for (let i = 0; i < 50 && (store.getStepStates('m1').get('s2')?.status !== 'failed'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const states = store.getStepStates('m1');
    expect(states.get('s1')?.status).toBe('success');
    expect(states.get('s1')?.outputPreview).toContain('ABC');
    expect(states.get('s2')?.status).toBe('failed');
    expect(states.get('s2')?.error).toBe('断言失败');

    // 重放：新实例同库 init 后应重建出一致的步骤状态
    const store2 = new PersistentMissionStore(dbPath);
    await store2.init();
    const replayed = store2.getStepStates('m1');
    expect(replayed.get('s1')?.status).toBe('success');
    expect(replayed.get('s1')?.outputPreview).toContain('ABC');
    expect(replayed.get('s2')?.status).toBe('failed');
    recorder.detach();
  });

  it('DAGRuntime 失败传播 → 下游 skipped 落事件源', async () => {
    const dbPath = tempDb();
    const bus = new EventBus();
    const store = new PersistentMissionStore(dbPath);
    await store.init();
    new StepEventRecorder().attach(bus, store);

    // 默认 continueOnFailure=true：a 失败后下游 b 被标 skipped，流程继续
    const runtime = new DAGRuntime({ eventBus: bus, nodeHandler: async (n: { id: string }) => {
      if (n.id === 'a') throw new Error('boom');
      return 'ok';
    } });
    const dag = makeDag();
    const context = { missionId: 'm-dag', goal: '验证失败传播' };

    await runtime.run(dag, context);

    for (let i = 0; i < 50 && (store.getStepStates('m-dag').get('b')?.status !== 'skipped'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const states = store.getStepStates('m-dag');
    expect(states.get('a')?.status).toBe('failed');
    expect(states.get('b')?.status).toBe('skipped');
  });

  it('初始化失败 → 显式降级（isReady=false + 告警），内存模式仍可用', async () => {
    const spy: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { spy.push(args.join(' ')); };
    try {
      const badStore = new PersistentMissionStore(join(tmpdir(), 'no-such-dir-should-fail', `${Date.now()}.db`));
      await badStore.init();
      expect(badStore.isReady()).toBe(false);
      expect(spy.some((line) => line.includes('事件源初始化失败'))).toBe(true);
      // 内存模式仍可工作（append 走 applyDirect）
      badStore.append('step.started', 'm-x', { nodeId: 'n1' });
      expect(badStore.getStepStates('m-x').get('n1')?.status).toBe('running');
    } finally {
      console.error = origError;
    }
  });
});
