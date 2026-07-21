import { ExecutionFSM, ExecutionState } from '../../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const assert = new AssertionContext();
  const start = Date.now();

  const fsm = new ExecutionFSM({ executionId: 'u1', autoPersist: false });
  assert.assert(fsm.currentState === ExecutionState.CREATED, 'init CREATED');
  fsm.startPlanning(); assert.assert(fsm.currentState === ExecutionState.PLANNING, '→PLANNING');
  fsm.markReady(); assert.assert(fsm.currentState === ExecutionState.READY, '→READY');
  fsm.startExecution(); assert.assert(fsm.currentState === ExecutionState.EXECUTING, '→EXECUTING');
  fsm.wait(); assert.assert(fsm.currentState === ExecutionState.WAITING, '→WAITING');
  fsm.resume(); assert.assert(fsm.currentState === ExecutionState.EXECUTING, 'resume');
  fsm.review(); assert.assert(fsm.currentState === ExecutionState.REVIEWING, '→REVIEWING');
  fsm.recover(); assert.assert(fsm.currentState === ExecutionState.RECOVERING, '→RECOVERING');
  fsm.resume(); fsm.review(); fsm.complete(); assert.assert(fsm.currentState === ExecutionState.COMPLETED, '→COMPLETED');
  assert.assert(fsm.isTerminal, 'terminal');

  try {
    const f2 = new ExecutionFSM({ executionId: 'u2', autoPersist: false });
    f2.transition(ExecutionState.EXECUTING);
    assert.assert(false, 'should reject');
  } catch (e: any) { assert.assert(e.message.includes('Invalid'), 'invalid rejected'); }

  const ev: string[] = [];
  const f3 = new ExecutionFSM({ executionId: 'u3', autoPersist: false, onEnter: s => ev.push('in:'+s), onExit: s => ev.push('out:'+s) });
  f3.startPlanning();
  assert.assert(ev.includes('out:CREATED'), 'exit');
  assert.assert(ev.includes('in:PLANNING'), 'enter');

  const f4 = new ExecutionFSM({ executionId: 'u4', autoPersist: false });
  f4.startPlanning(); f4.transition(ExecutionState.FAILED);
  assert.assert(f4.currentState === ExecutionState.FAILED, '→FAILED');
  assert.assert(f4.isTerminal, 'FAILED terminal');

  const f5 = new ExecutionFSM({ executionId: 'u5', autoPersist: false });
  f5.startPlanning(); f5.markReady(); f5.cancel();
  assert.assert(f5.currentState === ExecutionState.CANCELLED, '→CANCELLED');

  const f6 = new ExecutionFSM({ executionId: 'persist', persistDir: './data/test-fsm-u', autoPersist: true });
  f6.startPlanning(); f6.markReady(); await f6.persist();
  const restored = await ExecutionFSM.restore('persist', './data/test-fsm-u');
  assert.assert(restored !== null, 'restored');
  assert.assert(restored!.currentState === ExecutionState.READY, 'state restored');
  assert.assert(restored!.getStats().totalTransitions >= 2, 'stats');

  return {
    name: 'Unit: FSM', category: 'unit',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
