/**
 * Scenario 2: Multi-step Task — "Build full-stack app" with 5-node DAG
 */
import { ExecutionFSM, ExecutionState } from '../../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { DAGRuntime } from '../../packages/core/src/runtime/dag/DAGRuntime.js';
import { AgentHarness } from '../../packages/core/src/planes/agent-plane/AgentHarness.js';
import { GoalExtractor } from '../../packages/core/src/planes/control-plane/intent/GoalExtractor.js';
import { TraceBuilder, AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const startTime = Date.now();
  const trace = new TraceBuilder(); const assert = new AssertionContext();
  const goal = 'Build a task management full-stack app with React frontend and Express backend';
  trace.step('start', 'started');
  const goalExt = new GoalExtractor(); const g = goalExt.extract(goal);
  assert.assert(g.primary !== '', 'Goal');
  trace.stateChange('GOAL');

  const fsm = new ExecutionFSM({ executionId:'sc-multi', autoPersist:false });
  fsm.startPlanning(); fsm.markReady(); fsm.startExecution();
  const dag = new DAGRuntime({ maxParallel:2 });
  const d = { id:'multi-dag', createdAt:Date.now(),
    nodes:[
      { id:'p', name:'Plan', agentType:'l', description:'', deps:[], status:'pending' as const, priority:5, retryCount:0, maxRetries:2 },
      { id:'be', name:'Backend', agentType:'e', description:'', deps:['p'], status:'pending' as const, priority:4, retryCount:0, maxRetries:2 },
      { id:'fe', name:'Frontend', agentType:'e', description:'', deps:['be'], status:'pending' as const, priority:3, retryCount:0, maxRetries:2 },
      { id:'t', name:'Test', agentType:'e', description:'', deps:['fe'], status:'pending' as const, priority:2, retryCount:0, maxRetries:2 },
      { id:'d', name:'Deploy', agentType:'e', description:'', deps:['t'], status:'pending' as const, priority:1, retryCount:0, maxRetries:2 },
    ], edges:[{ from:'p', to:'be', weight:1 }, { from:'be', to:'fe', weight:1 }, { from:'fe', to:'t', weight:1 }, { from:'t', to:'d', weight:1 }],
    status:{ totalNodes:5, totalEdges:4, mutations:0, isCyclic:false, canRollback:true, isComplete:false } };
  const r = await dag.run(d, {});
  assert.assert(r.success, 'DAG'); assert.assert(r.completedNodes === 5, '5 nodes');
  assert.assert(r.executionTrace.some(t => t.action==='complete'), 'Trace');
  trace.stateChange('EXECUTING');

  const harness = await AgentHarness.create(b => b.setIntent(goal, []).setPlan('p2', d).setExecutionState('completed').attachArtifact({ id:'a1', name:'Backend', type:'code', version:'1', uri:'u1' }));
  assert.assert(harness.getContext().artifact.availableArtifacts.length >= 1, 'Artifact');
  fsm.review(); fsm.complete();
  trace.stateChange('COMPLETED');

  return { name:'Scenario: Multi-step Full-stack App', category:'scenario', passed:assert.errors.length===0, duration:Date.now()-startTime, assertions:assert.total, assertionsPassed:assert.passed, errors:assert.errors, trace:trace.build() };
}
