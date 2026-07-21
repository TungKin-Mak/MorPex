import { CheckpointManager } from '../../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../../packages/core/src/runtime/checkpoint/RecoveryManager.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const assert = new AssertionContext();
  const start = Date.now();

  const cp = new CheckpointManager({ baseDir: './data/test-chaos-cp' });
  const rec = new RecoveryManager();

  const snap = {
    executionId: 'agent-crash', dagId: 'd1',
    dagState: {
      nodeStates: [
        { nodeId: 'a', name: 'RunningAgent', status: 'running' as const, attempts: 1, startedAt: Date.now() - 100 },
        { nodeId: 'b', name: 'PendingTask', status: 'pending' as const, attempts: 0 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    },
    timestamp: Date.now(), metadata: { scenario: 'agent-crash' },
  };

  await cp.save('agent-crash', snap);
  const loaded = await cp.load('agent-crash');
  assert.assert(loaded !== null, 'checkpoint saved after agent crash');

  const plan = await rec.recover(snap);
  assert.assert(plan.canRecover, 'recovery possible after agent crash');
  assert.assert(plan.actions.some(a => a.action === 'continue'), 'running agent continues');
  assert.assert(plan.skipCount === 0, 'no completed nodes (all crashed)');

  return {
    name: 'Chaos: Agent Crash', category: 'chaos',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
