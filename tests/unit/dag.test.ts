import { DAGRuntime } from '../../packages/core/src/runtime/dag/DAGRuntime.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const assert = new AssertionContext();
  const start = Date.now();

  const dag = new DAGRuntime({ maxParallel: 2 });
  const d1 = {
    id: 'd1', createdAt: Date.now(),
    nodes: [
      { id: 'a', name: 'A', agentType: 't', description: '', deps: [], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'b', name: 'B', agentType: 't', description: '', deps: ['a'], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'c', name: 'C', agentType: 't', description: '', deps: ['a'], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
    ],
    edges: [{ from: 'a', to: 'b', weight: 1 }, { from: 'a', to: 'c', weight: 1 }],
    status: { totalNodes: 3, totalEdges: 2, mutations: 0, isCyclic: false, canRollback: true, isComplete: false },
  };
  const r1 = await dag.run(d1, {});
  assert.assert(r1.success, 'DAG succeeded');
  assert.assert(r1.completedNodes === 3, '3 completed');
  assert.assert(r1.errors.length === 0, '0 errors');
  assert.assert(r1.duration < 500, 'fast execution');

  const trace = dag.executionTrace;
  assert.assert(trace.length > 0, 'trace recorded');
  assert.assert(trace.some(t => t.action === 'start'), 'trace: start');
  assert.assert(trace.some(t => t.action === 'complete'), 'trace: complete');

  return {
    name: 'Unit: DAG', category: 'unit',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
