import { RecoveryManager } from '../../packages/core/src/runtime/checkpoint/RecoveryManager.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const assert = new AssertionContext();
  const start = Date.now();

  const rec = new RecoveryManager();

  const snap = {
    executionId: 'tool-fail', dagId: 'd1',
    dagState: {
      nodeStates: [
        { nodeId: 'api', name: 'CallExternalAPI', status: 'failed' as const, attempts: 2, error: 'HTTP 503 Service Unavailable' },
        { nodeId: 'save', name: 'SaveResults', status: 'pending' as const, attempts: 0 },
      ],
      edges: [{ from: 'api', to: 'save' }],
    },
    timestamp: Date.now(), metadata: { scenario: 'tool-failure' },
  };

  const plan = await rec.recover(snap);
  assert.assert(plan.canRecover, 'recovery possible after tool failure');
  assert.assert(plan.retryCount >= 1, 'failed tool scheduled for retry');
  assert.assert(plan.actions.some(a => a.nodeId === 'api' && a.action === 'retry'), 'API call retried');
  assert.assert(plan.continueCount >= 1, 'pending nodes continue');
  assert.assert(plan.skipCount === 0, 'no completed nodes to skip');

  return {
    name: 'Chaos: Tool Failure', category: 'chaos',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
