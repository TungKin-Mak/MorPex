/**
 * Integration: Planning → Runtime — Plan Blueprint → Execution
 */
import { ExecutionFSM, ExecutionState } from '../../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { DAGRuntime } from '../../packages/core/src/runtime/dag/DAGRuntime.js';
import { AssertionContext, TraceBuilder, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const ctx = new AssertionContext();
  const trace = new TraceBuilder();
  const fsm = new ExecutionFSM({ executionId: 'int-pr', autoPersist: false });
  const dag = new DAGRuntime({ maxParallel: 2 });

  trace.step('FSM: CREATED→PLANNING→READY', 'started');
  ctx.assert(fsm.currentState === ExecutionState.CREATED, 'CREATED');
  fsm.startPlanning();
  ctx.assert(fsm.currentState === ExecutionState.PLANNING, '→PLANNING');
  fsm.markReady();
  ctx.assert(fsm.currentState === ExecutionState.READY, '→READY');
  trace.stateChange('READY');
  trace.step('FSM: CREATED→PLANNING→READY', 'completed');

  trace.step('DAG run', 'started');
  fsm.startExecution();
  const testDAG = {
    id: 'int-dag', createdAt: Date.now(),
    nodes: [
      { id: 'a', name: 'Setup', agentType: 'tool', description: '', deps: [], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'b', name: 'Build', agentType: 'agent', description: '', deps: ['a'], status: 'pending' as const, priority: 2, retryCount: 0, maxRetries: 2 },
    ],
    edges: [{ from: 'a', to: 'b', weight: 1 }],
    status: { totalNodes: 2, totalEdges: 1, mutations: 0, isCyclic: false, canRollback: true, isComplete: false },
  };
  const res = await dag.run(testDAG, {});
  ctx.assert(res.success, 'DAG success');
  ctx.assert(res.completedNodes === 2, '2 nodes completed');
  ctx.assert(res.failedNodes === 0, '0 failures');
  trace.step('DAG run', 'completed', `2/2, ${res.duration}ms`);

  trace.step('FSM: REVIEWING→COMPLETED', 'started');
  fsm.review();
  fsm.complete();
  ctx.assert(fsm.currentState === ExecutionState.COMPLETED, 'COMPLETED');
  ctx.assert(fsm.isTerminal, 'isTerminal');
  trace.stateChange('COMPLETED');
  trace.step('FSM: REVIEWING→COMPLETED', 'completed');

  return {
    name: 'Integration: Planning→Runtime',
    category: 'integration',
    passed: ctx.errors.length === 0,
    duration: Date.now() - start,
    assertions: ctx.total,
    assertionsPassed: ctx.passed,
    errors: ctx.errors,
    trace: trace.build(),
  };
}

export default run;
