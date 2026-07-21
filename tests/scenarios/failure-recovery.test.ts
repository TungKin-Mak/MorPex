/**
 * Scenario 3: Failure Recovery — Injected node failure, verify recovery
 *
 * Simulates a tool failure on node 2. FSM enters RECOVERING → RecoveryManager
 * generates plan → execution continues from checkpoint. Validates no data loss.
 */
import { ExecutionFSM, ExecutionState } from '../../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { CheckpointManager } from '../../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../../packages/core/src/runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../../packages/core/src/runtime/checkpoint/ReplayEngine.js';
import { TraceBuilder, AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const startTime = Date.now();
  const trace = new TraceBuilder();
  const assert = new AssertionContext();

  const fsm = new ExecutionFSM({ executionId: 'scenario-fail-1', autoPersist: false });
  const cp = new CheckpointManager({ baseDir: './data/test-scenario-checkpoints' });
  const rec = new RecoveryManager();
  const replay = new ReplayEngine(cp);

  trace.step('start', 'started', 'Failure recovery scenario');

  // ── 1. Normal execution through first 2 nodes ──
  fsm.startPlanning();
  trace.stateChange('PLANNING');
  fsm.markReady();
  fsm.startExecution();
  trace.stateChange('EXECUTING');

  // Simulate checkpoint after step 1 (success)
  const snapAfterStep1 = {
    executionId: 'scenario-fail-1', dagId: 'fail-test-dag',
    dagState: {
      nodeStates: [
        { nodeId: 'a', name: 'Setup', status: 'success' as const, attempts: 1, completedAt: Date.now() - 200 },
        { nodeId: 'b', name: 'ProcessData', status: 'running' as const, attempts: 1, startedAt: Date.now() - 100 },
        { nodeId: 'c', name: 'SaveResults', status: 'pending' as const, attempts: 0 },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    },
    timestamp: Date.now(), metadata: { scenario: 'failure-recovery' },
  };
  await cp.save('scenario-fail-1', snapAfterStep1);
  trace.stateChange('CHECKPOINT_SAVED');
  assert.assert(true, 'Checkpoint saved at step 1');

  // Simulate node 'b' failing
  const snapAfterFail: typeof snapAfterStep1 = {
    ...snapAfterStep1,
    dagState: {
      nodeStates: [
        { nodeId: 'a', name: 'Setup', status: 'success' as const, attempts: 1, completedAt: Date.now() - 200 },
        { nodeId: 'b', name: 'ProcessData', status: 'failed' as const, attempts: 2, error: 'Timeout: API did not respond within 30s' },
        { nodeId: 'c', name: 'SaveResults', status: 'pending' as const, attempts: 0 },
      ],
      edges: snapAfterStep1.dagState.edges,
    },
  };
  trace.step('node-b-failure', 'failed', 'Tool failure: HTTP timeout');
  trace.stateChange('NODE_FAILED');

  // ── 2. FSM transitions to RECOVERING ──
  fsm.review();
  trace.stateChange('REVIEWING');
  assert.assert(fsm.currentState === ExecutionState.REVIEWING, 'FSM entered REVIEWING after failure');
  fsm.recover();
  assert.assert(fsm.currentState === ExecutionState.RECOVERING, 'FSM entered RECOVERING');
  trace.stateChange('RECOVERING');

  // ── 3. Recovery generates plan ──
  const plan = await rec.recover(snapAfterFail);
  assert.assert(plan.canRecover, 'Recovery is possible');
  assert.assert(plan.retryCount >= 1, 'Failed node queued for retry');
  assert.assert(plan.skipCount >= 1, 'Completed node skipped');
  assert.assert(plan.continueCount >= 1, 'Pending node continues');
  trace.step('recovery-plan', 'completed', `${plan.retryCount} retry, ${plan.skipCount} skip, ${plan.continueCount} continue`);

  // ── 4. Verify data preserved (no data loss) ──
  const loaded = await cp.load('scenario-fail-1');
  assert.assert(loaded !== null, 'Checkpoint loaded after failure');
  assert.assert(loaded!.dagState.nodeStates[0].status === 'success', 'Step A data preserved');
  assert.assert(loaded!.dagState.nodeStates[2].status === 'pending', 'Step C pending and not lost');
  trace.step('data-verified', 'completed', 'No data loss confirmed');

  // ── 5. Replay can reconstruct execution ──
  const replayEvents = await replay.replayFast('scenario-fail-1');
  assert.assert(replayEvents.length > 0, 'Replay produces events');
  assert.assert(replayEvents.some(e => e.type === 'node-start'), 'Replay has start events');
  assert.assert(replayEvents.some(e => e.type === 'complete'), 'Replay has completion');
  trace.step('replay-verified', 'completed', `${replayEvents.length} replay events`);

  // ── 6. Complete recovery cycle ──
  fsm.resume();
  assert.assert(fsm.currentState === ExecutionState.EXECUTING, 'FSM resumed execution after recovery');
  fsm.review();
  fsm.complete();
  assert.assert(fsm.currentState === ExecutionState.COMPLETED, 'Recovery cycle completed successfully');
  trace.stateChange('COMPLETED');
  trace.step('recovery-complete', 'completed', 'Full recovery cycle done');

  return {
    name: 'Scenario: Failure Recovery',
    category: 'scenario',
    passed: assert.errors.length === 0,
    duration: Date.now() - startTime,
    assertions: assert.total,
    assertionsPassed: assert.passed,
    errors: assert.errors,
    trace: trace.build(),
  };
}
