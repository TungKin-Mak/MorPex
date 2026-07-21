/**
 * Architecture: Runtime Graph — RuntimeKernelIntegrator accesses
 */
import { DAGRuntime } from '../../packages/core/src/runtime/dag/DAGRuntime.js';
import { CheckpointManager } from '../../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../../packages/core/src/runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../../packages/core/src/runtime/checkpoint/ReplayEngine.js';
import { ExecutionFSM, ExecutionState } from '../../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const assert = new AssertionContext();

  const dag = new DAGRuntime({ maxParallel: 2 });
  const cp = new CheckpointManager({ baseDir: './data/test-arch-cp' });
  const rec = new RecoveryManager();
  const replay = new ReplayEngine(cp);
  const fsm = new ExecutionFSM({ executionId: 'arch-rg', autoPersist: false });

  assert.assert(dag !== null, 'DAGRuntime created');
  assert.assert(cp !== null, 'CheckpointManager created');
  assert.assert(rec !== null, 'RecoveryManager created');
  assert.assert(replay !== null, 'ReplayEngine created');
  assert.assert(fsm !== null, 'ExecutionFSM created');

  fsm.startPlanning(); fsm.markReady(); fsm.startExecution();
  assert.assert(fsm.currentState === ExecutionState.EXECUTING, 'FSM can execute');

  const snap = { executionId:'arch-test', dagId:'d1', dagState:{ nodeStates:[{ nodeId:'a', name:'A', status:'success' as const, attempts:1 }], edges:[] }, timestamp:Date.now(), metadata:{} };
  await cp.save('arch-test', snap);
  const loaded = await cp.load('arch-test');
  assert.assert(loaded !== null, 'Checkpoint save/load');

  const plan = await rec.recover(snap);
  assert.assert(plan.canRecover, 'Recovery works');

  return {
    name: 'Architecture: Runtime Graph', category: 'architecture',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
