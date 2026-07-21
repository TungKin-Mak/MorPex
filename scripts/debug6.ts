import { CheckpointManager } from '../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../packages/core/src/runtime/checkpoint/RecoveryManager.js';

const baseDir = './data/val-checkpoints';
const cp = new CheckpointManager({ baseDir });
const rec = new RecoveryManager();

// Test 1: Tool failure should retry
const toolSnapshot = {
  executionId: 'tool-fail-test',
  dagId: 'dag-tool',
  dagState: {
    nodeStates: [
      { nodeId: 't1', name: 'CallAPI', status: 'failed' as const, attempts: 2, error: 'HTTP 500' },
      { nodeId: 't2', name: 'Process', status: 'pending' as const, attempts: 0 },
      { nodeId: 't3', name: 'Save', status: 'pending' as const, attempts: 0 },
    ],
    edges: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }],
  },
  timestamp: Date.now(),
  metadata: { scenario: 'tool-failure' },
};

const plan = await rec.recover(toolSnapshot);
console.log('Plan actions:', JSON.stringify(plan.actions));
const t1Action = plan.actions.find(a => a.nodeId === 't1');
console.log('t1 action:', JSON.stringify(t1Action));
console.log('Expected retry, got:', t1Action?.action);
console.log('Test 1:', t1Action?.action === 'retry' ? 'PASS' : 'FAIL');
