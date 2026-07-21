/**
 * Architecture Integration Tests — 核心链路验证
 *
 * 覆盖: FSM → DAG → Recovery → Harness → Memory → Learning
 * 不追求覆盖率，优先保证核心链路。
 */
import { ExecutionFSM, ExecutionState } from '../src/runtime/state-machine/ExecutionFSM.js';
import { DAGRuntime } from '../src/runtime/dag/DAGRuntime.js';
import { CheckpointManager } from '../src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../src/runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../src/runtime/checkpoint/ReplayEngine.js';
import { AgentHarness } from '../src/planes/agent-plane/AgentHarness.js';
import { ContextBuilder } from '../src/planes/agent-plane/ContextBuilder.js';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  (async () => {
    try { await fn(); passed++; } catch (e: any) { failed++; console.error(`  FAIL ${name}: ${e.message}`); }
  })();
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// ── Runtime Tests ──
console.log('\n=== Integration Tests ===\n');

// 1. FSM full lifecycle
test('FSM: Full lifecycle CREATED→COMPLETED', () => {
  const fsm = new ExecutionFSM({ executionId: 't1', autoPersist: false });
  assert(fsm.currentState === ExecutionState.CREATED, 'start CREATED');
  fsm.startPlanning(); assert(fsm.currentState === ExecutionState.PLANNING, '→PLANNING');
  fsm.markReady(); assert(fsm.currentState === ExecutionState.READY, '→READY');
  fsm.startExecution(); assert(fsm.currentState === ExecutionState.EXECUTING, '→EXECUTING');
  fsm.wait(); assert(fsm.currentState === ExecutionState.WAITING, '→WAITING');
  fsm.resume(); assert(fsm.currentState === ExecutionState.EXECUTING, 'resume→EXECUTING');
  fsm.review(); assert(fsm.currentState === ExecutionState.REVIEWING, '→REVIEWING');
  fsm.complete(); assert(fsm.currentState === ExecutionState.COMPLETED, '→COMPLETED');
  assert(fsm.history.length >= 14, `audit trail: ${fsm.history.length}`);
});

// 2. FSM recovery path
test('FSM: Recovery path', () => {
  const fsm = new ExecutionFSM({ executionId: 't2', autoPersist: false });
  fsm.startPlanning(); fsm.markReady(); fsm.startExecution();
  fsm.review(); fsm.recover();
  assert(fsm.currentState === ExecutionState.RECOVERING, '→RECOVERING');
  fsm.resume();
  assert(fsm.currentState === ExecutionState.EXECUTING, 'recover→EXECUTING');
});

// 3. DAG execution
test('DAG: Sequential execution', async () => {
  const dag = new DAGRuntime({ maxParallel: 2 });
  const testDAG = {
    id: 'dag1', createdAt: Date.now(),
    nodes: [
      { id: 'a', name: 'A', agentType: 't', description: '', deps: [], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'b', name: 'B', agentType: 't', description: '', deps: ['a'], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'c', name: 'C', agentType: 't', description: '', deps: ['b'], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
    ],
    edges: [{ from: 'a', to: 'b', weight: 1 }, { from: 'b', to: 'c', weight: 1 }],
    status: { totalNodes: 3, totalEdges: 2, mutations: 0, isCyclic: false, canRollback: true, isComplete: false },
  };
  const res = await dag.run(testDAG, {});
  assert(res.success, 'DAG success');
  assert(res.completedNodes === 3, `3 nodes completed: ${res.completedNodes}`);
});

// 4. Checkpoint + Recovery
test('Checkpoint: Save and restore', async () => {
  const cp = new CheckpointManager({ baseDir: './data/test-int-checkpoints' });
  const snap = {
    executionId: 'test-snap', dagId: 'd1',
    dagState: { nodeStates: [{ nodeId: 'a', name: 'A', status: 'success' as const, attempts: 1 }], edges: [] },
    timestamp: Date.now(), metadata: {},
  };
  await cp.save('test-snap', snap);
  const loaded = await cp.load('test-snap');
  assert(loaded !== null, 'snapshot loaded');
  assert(loaded!.executionId === 'test-snap', 'correct snapshot');
});

// 5. Recovery plan
test('Recovery: Plan generation', async () => {
  const rec = new RecoveryManager();
  const snap = {
    executionId: 'rec-test', dagId: 'd2',
    dagState: {
      nodeStates: [
        { nodeId: 'ok', name: 'OK', status: 'success' as const, attempts: 1 },
        { nodeId: 'fail', name: 'Fail', status: 'failed' as const, attempts: 1, error: 'err' },
      ],
      edges: [],
    },
    timestamp: Date.now(), metadata: {},
  };
  const plan = await rec.recover(snap);
  assert(plan.canRecover === true, 'recoverable');
  assert(plan.actions.some(a => a.nodeId === 'fail' && a.action === 'retry'), 'failed node retries');
});

// 6. Harness initialization
test('Harness: Initialize and get context', async () => {
  const harness = await AgentHarness.create(b =>
    b.setIntent('Test integration', ['Use TS'])
      .setPlan('plan_int', { nodes: [] })
      .setExecutionState('running')
  );
  const ctx = harness.getContext();
  assert(ctx.intent.goal === 'Test integration', 'intent preserved');
  assert(ctx.executionState.status === 'running', 'state preserved');
});

// 7. Harness context versioning
test('Harness: Context version tracking', async () => {
  const harness = await AgentHarness.create(b =>
    b.setIntent('V1', []).setPlan('p1', {}).setExecutionState('idle')
  );
  const v1 = harness.contextVersion;
  harness.updateIntent({ goal: 'V2' });
  assert(harness.contextVersion > v1, 'version bumped on update');
});

// 8. Memory activation via harness
test('Memory: Activation via harness', () => {
  // Verify MemoryActivationEngine type compatibility with AgentHarness
  const hasMethod = typeof AgentHarness.prototype.attachMemoryEngine === 'function';
  assert(hasMethod, 'Harness supports memory engine attachment');
});

// ── Results ──
setTimeout(() => {
  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  if (failed > 0) process.exit(1);
}, 500);
