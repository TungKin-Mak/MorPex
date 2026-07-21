import { RecoveryManager } from '../../packages/core/src/runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../../packages/core/src/runtime/checkpoint/ReplayEngine.js';
import { CheckpointManager } from '../../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const ctx = new AssertionContext(); const startedAt = Date.now();
  const cp = new CheckpointManager({ baseDir: './data/ut-recovery' });
  const rec = new RecoveryManager();

  const snap: any = { executionId:'ut-rec-1', dagId:'d1', dagState:{ nodeStates:[
    { nodeId:'a', name:'A', status:'success', attempts:1 },
    { nodeId:'b', name:'B', status:'running', attempts:1 },
    { nodeId:'c', name:'C', status:'pending', attempts:0 },
  ], edges:[] }, timestamp:Date.now(), metadata:{} };
  const plan = await rec.recover(snap);
  ctx.assert(plan.canRecover, 'recoverable');
  ctx.assert(plan.actions.some(a => a.nodeId==='a' && a.action==='skip'), 'skip completed');
  ctx.assert(plan.actions.some(a => a.nodeId==='b' && a.action==='continue'), 'continue running');
  ctx.assert(plan.actions.some(a => a.nodeId==='c' && a.action==='continue'), 'continue pending');

  const failSnap: any = { executionId:'ut-rec-2', dagId:'d2', dagState:{ nodeStates:[{ nodeId:'f1', name:'F1', status:'failed', attempts:1, error:'err' }], edges:[] }, timestamp:Date.now(), metadata:{} };
  const failPlan = await rec.recover(failSnap);
  ctx.assert(failPlan.retryCount === 1, 'retry failed node');

  const deadSnap: any = { executionId:'ut-rec-3', dagId:'d3', dagState:{ nodeStates:[{ nodeId:'d1', name:'D1', status:'failed', attempts:3, error:'exhausted' }], edges:[] }, timestamp:Date.now(), metadata:{} };
  const deadPlan = await rec.recover(deadSnap);
  ctx.assert(!deadPlan.canRecover, 'exhausted not recoverable');

  await cp.save('ut-rec-1', snap);
  const replay = new ReplayEngine(cp);
  const events = await replay.replayFast('ut-rec-1');
  ctx.assert(events.length > 0, 'replay events');
  ctx.assert(events.some(e => e.type === 'complete'), 'replay complete');

  const summary = rec.summarize(plan);
  ctx.assert(summary.includes('Recovery Plan'), 'summary header');

  return { name:'Unit: Recovery', category:'unit', passed: ctx.errors.length === 0, duration: Date.now()-startedAt, assertions: ctx.total, assertionsPassed: ctx.passed, errors: ctx.errors };
}
