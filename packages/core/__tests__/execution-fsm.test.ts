/**
 * ExecutionFSM 测试（L5 Execution / 运行时状态机）— 此前零直接测试
 *
 * 覆盖：
 *   - 状态机合法路径：CREATED→PLANNING→READY→EXECUTING→REVIEWING→COMPLETED
 *   - WAITING⇄EXECUTING 挂起/恢复、REVIEWING→RECOVERING→EXECUTING 恢复
 *   - 非法转换抛错 + 终态（COMPLETED/FAILED/CANCELLED）不可再转
 *   - onEnter/onExit/onTransition 回调与审计历史（exit+enter 成对）
 *   - autoPersist + restore 快照恢复 + listExecutions
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExecutionFSM, ExecutionState } from '../src/execution/runtime/state-machine/ExecutionFSM.js';

const TMP = path.join(os.tmpdir(), `morpex-fsm-test-${Date.now()}`);

describe('ExecutionFSM — 状态机合法路径', () => {
  it('初始状态 CREATED，未运行、非终态', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_1', autoPersist: false });
    expect(fsm.currentState).toBe(ExecutionState.CREATED);
    expect(fsm.isRunning).toBe(false);
    expect(fsm.isTerminal).toBe(false);
  });

  it('完整生命周期 CREATED→PLANNING→READY→EXECUTING→REVIEWING→COMPLETED', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_2', autoPersist: false });
    fsm.startPlanning('用户提交目标');
    expect(fsm.currentState).toBe(ExecutionState.PLANNING);
    fsm.markReady();
    expect(fsm.currentState).toBe(ExecutionState.READY);
    fsm.startExecution();
    expect(fsm.currentState).toBe(ExecutionState.EXECUTING);
    expect(fsm.isRunning).toBe(true);
    fsm.review();
    expect(fsm.currentState).toBe(ExecutionState.REVIEWING);
    fsm.complete();
    expect(fsm.currentState).toBe(ExecutionState.COMPLETED);
    expect(fsm.isTerminal).toBe(true);
    expect(fsm.isRunning).toBe(false);
  });

  it('WAITING ⇄ EXECUTING 挂起与恢复', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_3', autoPersist: false });
    fsm.startPlanning(); fsm.markReady(); fsm.startExecution();
    fsm.wait('等待人工审批');
    expect(fsm.currentState).toBe(ExecutionState.WAITING);
    fsm.resume();
    expect(fsm.currentState).toBe(ExecutionState.EXECUTING);
  });

  it('REVIEWING→RECOVERING→EXECUTING 故障恢复路径', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_4', autoPersist: false });
    fsm.startPlanning(); fsm.markReady(); fsm.startExecution(); fsm.review();
    fsm.recover();
    expect(fsm.currentState).toBe(ExecutionState.RECOVERING);
    fsm.resume();
    expect(fsm.currentState).toBe(ExecutionState.EXECUTING);
  });
});

describe('ExecutionFSM — 非法转换与终态', () => {
  it('非法转换抛错（CREATED→COMPLETED）', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_5', autoPersist: false });
    expect(() => fsm.transition(ExecutionState.COMPLETED)).toThrow(/Invalid transition/);
    expect(fsm.currentState).toBe(ExecutionState.CREATED); // 状态不变
  });

  it('跳过中间状态被拒绝（PLANNING→EXECUTING）', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_6', autoPersist: false });
    fsm.startPlanning(); // PLANNING
    expect(() => fsm.startExecution()).toThrow(/Invalid transition/);
  });

  it('FAILED 是终态，不可再转换', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_7', autoPersist: false });
    fsm.startPlanning(); fsm.fail('执行失败');
    expect(fsm.currentState).toBe(ExecutionState.FAILED);
    expect(fsm.isTerminal).toBe(true);
    expect(() => fsm.markReady()).toThrow(/Invalid transition/);
  });

  it('CANCELLED 是终态', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_8', autoPersist: false });
    fsm.startPlanning(); fsm.markReady(); fsm.cancel('用户取消');
    expect(fsm.currentState).toBe(ExecutionState.CANCELLED);
    expect(fsm.isTerminal).toBe(true);
  });
});

describe('ExecutionFSM — 回调与审计历史', () => {
  it('onEnter/onExit/onTransition 回调收到正确 from/to', () => {
    const events: Array<{ kind: string; from: string; to: string }> = [];
    const fsm = new ExecutionFSM({
      executionId: 'exe_9',
      autoPersist: false,
      onEnter: (s, e) => events.push({ kind: 'enter', from: e.from, to: e.to }),
      onExit: (s, e) => events.push({ kind: 'exit', from: e.from, to: e.to }),
      onTransition: (e) => events.push({ kind: 'transition', from: e.from, to: e.to }),
    });
    fsm.startPlanning();
    // startPlanning() 是 CREATED→PLANNING：exit(离开 CREATED) + enter(进入 PLANNING) + transition
    expect(events.some(e => e.kind === 'exit' && e.from === 'CREATED')).toBe(true);
    expect(events.some(e => e.kind === 'enter' && e.to === 'PLANNING')).toBe(true);
    expect(events.some(e => e.kind === 'transition' && e.from === 'CREATED' && e.to === 'PLANNING')).toBe(true);
  });

  it('审计历史：每次转换记录 exit+enter 成对', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_10', autoPersist: false });
    fsm.startPlanning(); fsm.markReady(); fsm.startExecution();
    // 3 次转换 → 6 条审计（exit+enter）
    expect(fsm.history).toHaveLength(6);
  });

  it('transition 返回事件带 reason 与时间戳', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_11', autoPersist: false });
    const evt = fsm.startPlanning('目标已理解');
    expect(evt.from).toBe(ExecutionState.CREATED);
    expect(evt.to).toBe(ExecutionState.PLANNING);
    expect(evt.reason).toBe('目标已理解');
    expect(evt.timestamp).toBeGreaterThan(0);
  });

  it('setMetadata/getMetadata 保存执行元数据', () => {
    const fsm = new ExecutionFSM({ executionId: 'exe_12', autoPersist: false });
    fsm.setMetadata({ goal: '写代码', mode: 'auto' });
    expect(fsm.getMetadata().goal).toBe('写代码');
  });
});

describe('ExecutionFSM — 持久化与恢复', () => {
  it('persist 写入快照 → restore 恢复到同一状态', async () => {
    const dir = path.join(TMP, 'persist');
    fs.mkdirSync(dir, { recursive: true });
    const id = 'exe_persist_1';
    // autoPersist:false + 单一显式 persist，避免异步 appendFile 乱序覆盖最新快照
    const fsm = new ExecutionFSM({ executionId: id, persistDir: dir, autoPersist: false });
    fsm.startPlanning(); fsm.markReady(); fsm.startExecution();
    fsm.setMetadata({ note: 'restore-me' });
    await fsm.persist();

    const restored = await ExecutionFSM.restore(id, dir);
    expect(restored).not.toBeNull();
    expect(restored!.currentState).toBe(ExecutionState.EXECUTING);
    expect(restored!.getMetadata().note).toBe('restore-me');
    expect(restored!.executionId).toBe(id);
  }, 10000);

  it('restore 不存在的执行 → null', async () => {
    const dir = path.join(TMP, 'persist');
    const restored = await ExecutionFSM.restore('exe_never_exists', dir);
    expect(restored).toBeNull();
  }, 10000);

  it('listExecutions 列出已持久化的执行', async () => {
    const dir = path.join(TMP, 'list');
    fs.mkdirSync(dir, { recursive: true });
    const fsm = new ExecutionFSM({ executionId: 'exe_list_1', persistDir: dir, autoPersist: true });
    await fsm.persist();
    const ids = await ExecutionFSM.listExecutions(dir);
    expect(ids).toContain('exe_list_1');
  }, 10000);
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
