/**
 * Scenario 1: Simple Task — "Build a simple REST endpoint"
 */
import { ExecutionFSM, ExecutionState } from '../../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { DAGRuntime } from '../../packages/core/src/runtime/dag/DAGRuntime.js';
import { AgentHarness } from '../../packages/core/src/planes/agent-plane/AgentHarness.js';
import { GoalExtractor } from '../../packages/core/src/planes/control-plane/intent/GoalExtractor.js';
import { ConstraintAnalyzer } from '../../packages/core/src/planes/control-plane/intent/ConstraintAnalyzer.js';
import { ExperienceExtractor } from '../../packages/core/src/learning/ExperienceExtractor.js';
import { TraceBuilder, AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const startTime = Date.now();
  const trace = new TraceBuilder();
  const assert = new AssertionContext();
  const goal = 'Build a REST endpoint for task management with Express.js and TypeScript';
  trace.step('start', 'started');

  const goalExt = new GoalExtractor(); const ca = new ConstraintAnalyzer();
  const g = goalExt.extract(goal); const c = ca.analyze(goal);
  assert.assert(g.primary !== '', 'Goal'); assert.assert(c.technical.length >= 1, 'Tech constraints');
  trace.stateChange('INTENT_READY');

  const fsm = new ExecutionFSM({ executionId:'sc-simple', autoPersist:false });
  fsm.startPlanning(); fsm.markReady();
  const dag = new DAGRuntime({ maxParallel:2 });
  const d = { id:'simple-dag', createdAt:Date.now(),
    nodes:[{ id:'s1', name:'Setup', agentType:'e', description:'', deps:[], status:'pending' as const, priority:1, retryCount:0, maxRetries:2 },
           { id:'s2', name:'Code', agentType:'e', description:'', deps:['s1'], status:'pending' as const, priority:1, retryCount:0, maxRetries:2 }],
    edges:[{ from:'s1', to:'s2', weight:1 }],
    status:{ totalNodes:2, totalEdges:1, mutations:0, isCyclic:false, canRollback:true, isComplete:false } };
  fsm.startExecution();
  const r = await dag.run(d, {});
  assert.assert(r.success, 'DAG'); assert.assert(r.completedNodes === 2, '2 nodes');
  trace.stateChange('EXECUTING');

  const harness = await AgentHarness.create(b => b.setIntent(goal, c.technical).setPlan('p1', d).setExecutionState('completed').injectMemory([{ id:'m1', content:'Express', type:'pattern', relevanceScore:0.9, timestamp:Date.now() }]));
  assert.assert(harness.getContext().memory.relevantMemories.length >= 1, 'Memory');
  trace.stateChange('HARNESS_READY');

  const ex = new ExperienceExtractor();
  const er = { executionId:'s1', goal, planId:'p1', nodes:[{ id:'s1', name:'Setup', status:'success', duration:500 },{ id:'s2', name:'Code', status:'success', duration:1500 }], success:true, duration:2000, errors:[], startTime:Date.now()-2000, endTime:Date.now() };
  const exp = ex.extract(er);
  assert.assert(exp !== null, 'Experience');
  trace.learning({ experienceExtracted:!!exp, evaluationScore:1, suggestionsCount:exp?.lessons.length??0, templateUpdated:false });

  fsm.review(); fsm.complete();
  assert.assert(fsm.currentState === ExecutionState.COMPLETED, 'Done');
  trace.stateChange('COMPLETED');

  return { name:'Scenario: Simple REST Task', category:'scenario', passed:assert.errors.length===0, duration:Date.now()-startTime, assertions:assert.total, assertionsPassed:assert.passed, errors:assert.errors, trace:trace.build() };
}
