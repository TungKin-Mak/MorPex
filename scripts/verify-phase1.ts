import { ExecutionFSM, ExecutionState } from '../packages/core/src/runtime/state-machine/index.js';
import { DAGRuntime, TaskNode, TaskGraph } from '../packages/core/src/runtime/dag/index.js';
import { CheckpointManager } from '../packages/core/src/runtime/checkpoint/index.js';
import type { ExecutionDAG, DAGNode, DAGEdge } from '../packages/core/src/planes/runtime-kernel/dag/types.js';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) { if (cond) { passed++; console.log(`  ✅ ${msg}`); } else { failed++; console.error(`  ❌ ${msg}`); } }

async function main() {
  console.log('\n═══ Phase 1 Verification ═══\n');
  console.log('1. ExecutionFSM');
  const fsm = new ExecutionFSM({ executionId: 'test-1', autoPersist: false });
  assert(fsm.currentState === ExecutionState.CREATED, 'Initial CREATED');
  assert(fsm.canTransition(ExecutionState.PLANNING), 'Can→PLANNING');
  assert(!fsm.canTransition(ExecutionState.EXECUTING), 'Cannot→EXECUTING');
  fsm.startPlanning(); assert(fsm.currentState === ExecutionState.PLANNING, '→PLANNING');
  fsm.markReady(); assert(fsm.currentState === ExecutionState.READY, '→READY');
  fsm.startExecution(); assert(fsm.currentState === ExecutionState.EXECUTING, '→EXECUTING');
  fsm.review(); assert(fsm.currentState === ExecutionState.REVIEWING, '→REVIEWING');
  fsm.complete(); assert(fsm.currentState === ExecutionState.COMPLETED, '→COMPLETED');
  assert(fsm.isTerminal, 'Terminal');
  assert(fsm.history.length === 5, '5 audit entries');
  assert(fsm.getAllowedNextStates().length === 0, 'No next states (terminal)');

  const fsm2 = new ExecutionFSM({ executionId: 'test-2', autoPersist: false });
  fsm2.startPlanning(); fsm2.markReady(); fsm2.startExecution(); fsm2.review(); fsm2.recover(); fsm2.startExecution(); fsm2.review(); fsm2.complete();
  assert(fsm2.currentState === ExecutionState.COMPLETED, 'Complex lifecycle');
  assert(fsm2.history.length === 8, '8 audit entries');
  assert(fsm2.isRunning === false, 'Not running (completed)');
  console.log();

  console.log('2. DAG Runtime');
  const dagNodes: DAGNode[] = [
    { id: 'A', name: 'Task A', agentType: 'agent', description: '', deps: [], status: 'pending', priority: 1, retryCount: 0, maxRetries: 3 },
    { id: 'B', name: 'Task B', agentType: 'agent', description: '', deps: ['A'], status: 'pending', priority: 1, retryCount: 0, maxRetries: 3 },
    { id: 'C', name: 'Task C', agentType: 'agent', description: '', deps: ['A'], status: 'pending', priority: 2, retryCount: 0, maxRetries: 3 },
    { id: 'D', name: 'Task D', agentType: 'agent', description: '', deps: ['B', 'C'], status: 'pending', priority: 1, retryCount: 0, maxRetries: 3 },
  ];
  const dagEdges: DAGEdge[] = [{ from: 'A', to: 'B', weight: 1 }, { from: 'A', to: 'C', weight: 1 }, { from: 'B', to: 'D', weight: 1 }, { from: 'C', to: 'D', weight: 1 }];
  const executionDAG: ExecutionDAG = { id: 'dag-test-1', nodes: dagNodes, edges: dagEdges, status: { totalNodes: 4, totalEdges: 4, mutations: 0, isCyclic: false, canRollback: true, isComplete: false }, createdAt: Date.now() };

  const graph = TaskGraph.fromExecutionDAG(executionDAG);
  assert(graph.nodes.length === 4, '4 nodes');
  assert(graph.edges.length === 4, '4 edges');
  assert(graph.getReadyNodes().length === 1 && graph.getReadyNodes()[0].id === 'A', 'A ready');
  assert(graph.topologicalSort()[0].id === 'A', 'A first in topo');

  const runtime = new DAGRuntime({ maxParallel: 2 });
  const result = await runtime.run(executionDAG, { input: 'test' });
  assert(result.success, 'DAG succeeded');
  assert(result.completedNodes === 4, 'All 4 completed');
  assert(result.executionTrace.length > 0, 'Trace recorded');
  console.log(`  Duration: ${result.duration}ms\n`);

  console.log('3. Checkpoint & Recovery');
  const cm = new CheckpointManager({ baseDir: './data/checkpoints-test' });
  await cm.save('test-snap-1', {
    executionId: 'exec-1', dagId: 'dag-1',
    dagState: { nodeStates: [{ nodeId: 'A', name: 'A', status: 'success', attempts: 1, result: 'ok' }, { nodeId: 'B', name: 'B', status: 'failed', attempts: 2, error: 'err' }], edges: [{ from: 'A', to: 'B' }] },
    timestamp: Date.now(), metadata: {},
  });
  const loaded = await cm.load('test-snap-1');
  assert(loaded !== null, 'Loaded');
  assert(loaded!.dagState.nodeStates.length === 2, '2 nodes');

  const list = await cm.list();
  assert(list.includes('test-snap-1'), 'Listed');
  await cm.delete('test-snap-1');
  assert(!(await cm.list()).includes('test-snap-1'), 'Deleted');

  const fs = await import('node:fs');
  try { fs.rmSync('./data/checkpoints-test', { recursive: true, force: true }); } catch {}

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Phase 1: ✅ ${passed} passed, ❌ ${failed} failed`);
  console.log(`═══════════════════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(err => { console.error('FAILED:', err); process.exit(1); });
