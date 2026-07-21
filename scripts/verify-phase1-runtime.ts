import { ExecutionFSM, ExecutionState } from '../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { DAGRuntime } from '../packages/core/src/runtime/dag/DAGRuntime.js';
import { CheckpointManager } from '../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import * as fs from 'node:fs';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) { if (cond) { passed++; console.log(`  ✅ ${msg}`); } else { failed++; console.error(`  ❌ ${msg}`); } }

async function cleanup() {
  try { fs.unlinkSync('./data/fsm-states/verify-fsm-1.jsonl'); } catch {}
  try { fs.unlinkSync('./data/checkpoints/verify-cp-1.checkpoint.json'); } catch {}
}

async function testFSM() {
  console.log('\n═══ 1. ExecutionFSM ═══\n');
  await cleanup();

  const fsm = new ExecutionFSM({ executionId: 'verify-fsm-1', persistDir: './data/fsm-states', autoPersist: false });
  assert(fsm.currentState === ExecutionState.CREATED, 'Initial CREATED');
  assert(!fsm.isTerminal, 'Not terminal');

  fsm.transition(ExecutionState.PLANNING, 'Plan');
  fsm.transition(ExecutionState.READY, 'Ready');
  fsm.transition(ExecutionState.EXECUTING, 'Exec');
  assert(fsm.currentState === ExecutionState.EXECUTING, 'Reached EXECUTING');

  let threw = false;
  try { fsm.transition(ExecutionState.CREATED, 'Invalid'); } catch { threw = true; }
  assert(threw, 'Invalid transition rejected');

  fsm.transition(ExecutionState.REVIEWING, 'Review');
  fsm.transition(ExecutionState.COMPLETED, 'Done');
  assert(fsm.currentState === ExecutionState.COMPLETED, '→ COMPLETED');
  assert(fsm.isTerminal, 'Terminal');

  const audit = fsm.getAuditLog();
  assert(audit.length > 0, 'Audit log present');

  await fsm.persist();
  const restored = await ExecutionFSM.restore('verify-fsm-1', './data/fsm-states');
  assert(restored !== null, 'Restored from disk');
  assert(restored!.currentState === ExecutionState.COMPLETED, 'State restored correctly');

  console.log('\n  ✅ ExecutionFSM verified\n');
}

async function testDAG() {
  console.log('\n═══ 2. DAGRuntime ═══\n');
  const runtime = new DAGRuntime({ maxParallel: 2 });
  const dag: any = {
    id: 'verify-dag-1',
    nodes: [
      { id: 'A', name: 'Root', agentType: 'test', description: 'Root', deps: [], priority: 1, retryCount: 0, maxRetries: 1, status: 'pending' },
      { id: 'B', name: 'Mid', agentType: 'test', description: 'Mid', deps: ['A'], priority: 1, retryCount: 0, maxRetries: 1, status: 'pending' },
      { id: 'C', name: 'Leaf', agentType: 'test', description: 'Leaf', deps: ['B'], priority: 1, retryCount: 0, maxRetries: 1, status: 'pending' },
    ],
    edges: [{ from: 'A', to: 'B', weight: 1 }, { from: 'B', to: 'C', weight: 1 }],
    status: { totalNodes: 3, totalEdges: 2, mutations: 0, isCyclic: false, canRollback: true, isComplete: false },
    createdAt: Date.now(),
  };
  const result = await runtime.run(dag, { input: 'test' });
  assert(result.success === true, 'DAG succeeded');
  assert(result.totalNodes === 3, '3 nodes');
  assert(result.completedNodes === 3, '3 completed');
  assert(result.executionTrace.length >= 3, 'Trace recorded');
  console.log('\n  ✅ DAGRuntime verified\n');
}

async function testCheckpoint() {
  console.log('\n═══ 3. CheckpointManager ═══\n');
  const cm = new CheckpointManager({ baseDir: './data/checkpoints' });

  await cm.save('verify-cp-1', {
    executionId: 'exec-1',
    dagId: 'dag-1',
    dagState: {
      nodeStates: [
        { nodeId: 'A', name: 'A', status: 'success', attempts: 1, result: {} },
        { nodeId: 'B', name: 'B', status: 'success', attempts: 1, result: {} },
      ],
      edges: [{ from: 'A', to: 'B' }],
    },
    timestamp: Date.now(),
    metadata: {},
  });

  const loaded = await cm.load('verify-cp-1');
  assert(loaded !== null, 'Checkpoint saved & loaded');
  assert(loaded!.executionId === 'exec-1', 'Data integrity');

  const list = await cm.list();
  assert(list.includes('verify-cp-1'), 'Listable');

  console.log('\n  ✅ CheckpointManager verified\n');
}

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Phase 1 Verification: Runtime Kernel v2');
  console.log('═══════════════════════════════════════════════\n');
  await testFSM();
  await testDAG();
  await testCheckpoint();
  const total = passed + failed;
  console.log(`═══════════════════════════════════════════════`);
  console.log(`  ${passed}/${total} passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log(`  ✅ Phase 1 VERIFIED — Runtime Kernel v2 operational`);
  console.log(`═══════════════════════════════════════════════\n`);
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
