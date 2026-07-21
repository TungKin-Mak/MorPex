import { CheckpointManager } from '../../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const ctx = new AssertionContext(); const startedAt = Date.now();
  const cp = new CheckpointManager({ baseDir: './data/ut-checkpoints' });
  const snap: any = { executionId:'ut-cp-1', dagId:'d1', dagState:{ nodeStates:[{ nodeId:'a', name:'A', status:'success', attempts:1 }], edges:[] }, timestamp:Date.now(), metadata:{} };
  await cp.save('ut-cp-1', snap); ctx.assert(true, 'saved');
  const loaded = await cp.load('ut-cp-1'); ctx.assert(loaded !== null, 'loaded');
  ctx.assert(loaded!.executionId === 'ut-cp-1', 'correct id');
  const snap2: any = { executionId:'ut-cp-2', dagId:'d2', dagState:{ nodeStates:[{ nodeId:'b', name:'B', status:'running', attempts:1 }], edges:[] }, timestamp:Date.now(), metadata:{} };
  await cp.save('ut-cp-2', snap2);
  const list = await cp.list(); ctx.assert(list.length >= 2, '2 checkpoints');
  ctx.assert(list.includes('ut-cp-1'), 'cp1 in list');
  const del = await cp.delete('ut-cp-2'); ctx.assert(del, 'deleted');
  const rem = await cp.cleanup(0); ctx.assert(rem >= 1, 'cleanup');
  return { name:'Unit: Checkpoint', category:'unit', passed: ctx.errors.length === 0, duration: Date.now()-startedAt, assertions: ctx.total, assertionsPassed: ctx.passed, errors: ctx.errors };
}
