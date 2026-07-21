/**
 * FSM Tests — 10-state lifecycle validation
 */
import { ExecutionFSM, ExecutionState } from '../src/runtime/state-machine/ExecutionFSM.js';

const assert = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); };

// Test 1: All valid transitions
const fsm = new ExecutionFSM({ executionId: 't1', autoPersist: false });
assert(fsm.currentState === ExecutionState.CREATED, 'initial CREATED');
fsm.startPlanning();
assert(fsm.currentState === ExecutionState.PLANNING, '→PLANNING');
fsm.markReady();
assert(fsm.currentState === ExecutionState.READY, '→READY');
fsm.startExecution();
assert(fsm.currentState === ExecutionState.EXECUTING, '→EXECUTING');
fsm.wait();
assert(fsm.currentState === ExecutionState.WAITING, '→WAITING');
fsm.resume();
assert(fsm.currentState === ExecutionState.EXECUTING, 'resume→EXECUTING');
fsm.review();
assert(fsm.currentState === ExecutionState.REVIEWING, '→REVIEWING');
fsm.complete();
assert(fsm.currentState === ExecutionState.COMPLETED, '→COMPLETED');
assert(fsm.isTerminal, 'terminal');

// Test 2: Recovery path
const fsm2 = new ExecutionFSM({ executionId: 't2', autoPersist: false });
fsm2.startPlanning(); fsm2.markReady(); fsm2.startExecution();
fsm2.review(); fsm2.recover();
assert(fsm2.currentState === ExecutionState.RECOVERING, '→RECOVERING');
fsm2.resume();
assert(fsm2.currentState === ExecutionState.EXECUTING, 'recover→EXECUTING');

// Test 3: Cancel paths
const fsm3 = new ExecutionFSM({ executionId: 't3', autoPersist: false });
fsm3.startPlanning(); fsm3.markReady(); fsm3.cancel();
assert(fsm3.currentState === ExecutionState.CANCELLED, '→CANCELLED from READY');

const fsm4 = new ExecutionFSM({ executionId: 't4', autoPersist: false });
fsm4.startPlanning(); fsm4.markReady(); fsm4.startExecution();
fsm4.wait(); fsm4.cancel();
assert(fsm4.currentState === ExecutionState.CANCELLED, '→CANCELLED from WAITING');

// Test 4: enter/exit events
const events: string[] = [];
const fsm5 = new ExecutionFSM({
  executionId: 't5', autoPersist: false,
  onEnter: (s) => events.push('enter:' + s),
  onExit: (s) => events.push('exit:' + s),
});
fsm5.startPlanning();
assert(events.includes('exit:CREATED'), 'exit CREATED');
assert(events.includes('enter:PLANNING'), 'enter PLANNING');

// Test 5: Invalid transition rejection
try {
  const fsm6 = new ExecutionFSM({ executionId: 't6', autoPersist: false });
  fsm6.transition(ExecutionState.EXECUTING);
  assert(false, 'should have thrown');
} catch (e: any) {
  assert(e.message.includes('Invalid transition'), 'invalid rejected');
}

console.log('FSM Tests: ALL PASSED');
