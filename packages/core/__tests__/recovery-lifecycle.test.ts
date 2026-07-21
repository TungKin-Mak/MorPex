/**
 * Recovery Tests — Checkpoint + Recovery + Replay
 */
import { CheckpointManager } from '../src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../src/runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../src/runtime/checkpoint/ReplayEngine.js';

const assert = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); };

async function main() {
  const cp = new CheckpointManager({ baseDir: './data/test-rec-tests' });
  const rec = new RecoveryManager();

  // Test 1: Save and load checkpoint
  const snap = {
    executionId: 'test-1', dagId: 'd1',
    dagState: {
      nodeStates: [
        { nodeId: 'a', name: 'A', status: 'success' as const, attempts: 1, completedAt: Date.now() },
        { nodeId: 'b', name: 'B', status: 'running' as const, attempts: 1, startedAt: Date.now() },
        { nodeId: 'c', name: 'C', status: 'pending' as const, attempts: 0 },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    },
    timestamp: Date.now(), metadata: {},
  };
  await cp.save('test-1', snap);
  const loaded = await cp.load('test-1');
  assert(loaded !== null, 'snapshot saved and loaded');
  assert(loaded!.executionId === 'test-1', 'correct execution');

  // Test 2: Recovery plan — running nodes continue, completed skipped
  const plan = await rec.recover(snap);
  assert(plan.canRecover, 'recoverable');
  assert(plan.actions.some(a => a.nodeId === 'a' && a.action === 'skip'), 'completed skipped');
  assert(plan.actions.some(a => a.nodeId === 'b' && a.action === 'continue'), 'running continues');
  assert(plan.actions.some(a => a.nodeId === 'c' && a.action === 'continue'), 'pending continues');

  // Test 3: Recovery — failed node retries
  const failSnap = {
    executionId: 'test-2', dagId: 'd2',
    dagState: {
      nodeStates: [
        { nodeId: 'f1', name: 'Fail1', status: 'failed' as const, attempts: 1, error: 'timeout' },
      ],
      edges: [],
    },
    timestamp: Date.now(), metadata: {},
  };
  const failPlan = await rec.recover(failSnap);
  assert(failPlan.retryCount === 1, 'failed node retries');
  assert(failPlan.actions[0].action === 'retry', 'retry action');

  // Test 4: Recovery — exhausted retries
  const exhaustedSnap = {
    executionId: 'test-3', dagId: 'd3',
    dagState: {
      nodeStates: [
        { nodeId: 'e1', name: 'Exhausted', status: 'failed' as const, attempts: 3, error: 'token limit' },
      ],
      edges: [],
    },
    timestamp: Date.now(), metadata: {},
  };
  const exhaustedPlan = await rec.recover(exhaustedSnap);
  assert(!exhaustedPlan.canRecover, 'exhausted not recoverable');
  assert(exhaustedPlan.failedCount === 1, '1 failed');

  // Test 5: Replay
  const replay = new ReplayEngine(cp);
  const events = await replay.replayFast('test-1');
  assert(events.length > 0, 'replay produces events');
  assert(events.some(e => e.type === 'node-start'), 'has start events');
  assert(events.some(e => e.type === 'complete'), 'has complete event');

  console.log('Recovery Tests: ALL PASSED');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
