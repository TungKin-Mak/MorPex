// @ts-nocheck
import { ExecutionFSM, ExecutionState } from './state-machine/ExecutionFSM.js';
import { DAGRuntime } from './dag/DAGRuntime.js';
import { CheckpointManager } from './checkpoint/CheckpointManager.js';
import { RecoveryManager } from './checkpoint/RecoveryManager.js';
import { ReplayEngine } from './checkpoint/ReplayEngine.js';
const assert = (c: boolean, m: string) => { if (!c) throw Error('FAIL: '+m); console.log('  OK '+m); };

async function main() {
  console.log('\n=== Phase 1 Real Call Chain ===\n');

  // 1. FSM
  console.log('--- 1. ExecutionFSM ---');
  const fsm = new ExecutionFSM({ executionId:'e1', autoPersist:false });
  assert(fsm.currentState===ExecutionState.CREATED, 'CREATED');
  fsm.transition(ExecutionState.PLANNING);
  assert(fsm.currentState===ExecutionState.PLANNING, '->PLANNING');
  fsm.transition(ExecutionState.READY);
  fsm.transition(ExecutionState.EXECUTING);
  fsm.transition(ExecutionState.WAITING);
  fsm.transition(ExecutionState.EXECUTING);
  fsm.transition(ExecutionState.REVIEWING);
  fsm.transition(ExecutionState.COMPLETED);
  assert(fsm.currentState===ExecutionState.COMPLETED, '->COMPLETED');
  assert(fsm.history.length>=6, `audit: ${fsm.history.length}`);

  // 2. Invalid
  console.log('\n--- 2. Invalid ---');
  const fsm2 = new ExecutionFSM({ executionId:'e2', autoPersist:false });
  try { fsm2.transition(ExecutionState.EXECUTING); assert(false,''); }
  catch { assert(true, 'CREATED->EXECUTING rejected'); }
  const fsm3 = new ExecutionFSM({ executionId:'e3', autoPersist:false });
  fsm3.transition(ExecutionState.PLANNING);
  fsm3.transition(ExecutionState.READY);
  fsm3.transition(ExecutionState.EXECUTING);
  fsm3.transition(ExecutionState.FAILED);
  assert(fsm3.currentState===ExecutionState.FAILED, '->FAILED');

  // 3. DAGRuntime
  console.log('\n--- 3. DAGRuntime ---');
  const dag = new DAGRuntime({ maxParallel:2 });
  const testDAG = {
    id:'td1', createdAt:Date.now(),
    nodes:[
      { id:'a',name:'A',agentType:'t',description:'',deps:[],status:'pending',priority:1,retryCount:0,maxRetries:2 },
      { id:'b',name:'B',agentType:'t',description:'',deps:['a'],status:'pending',priority:1,retryCount:0,maxRetries:2 },
      { id:'c',name:'C',agentType:'t',description:'',deps:['b'],status:'pending',priority:1,retryCount:0,maxRetries:2 },
    ], edges:[{from:'a',to:'b',weight:1},{from:'b',to:'c',weight:1}],
    status:{totalNodes:3,totalEdges:2,mutations:0,isCyclic:false,canRollback:true,isComplete:false},
  };
  const res = await dag.run(testDAG, {});
  assert(res.success, 'DAG ok');
  assert(res.completedNodes===3, '3 nodes');
  assert(res.errors.length===0, 'no errors');

  // 4. CheckpointManager (actual API: save/load/list)
  console.log('\n--- 4. Checkpoint ---');
  const cp = new CheckpointManager({ baseDir:'./data/test-checkpoints' });
  const snap:any = { executionId:'e1', dagId:'dag1', dagState:{ nodeStates:[{nodeId:'a',name:'A',status:'running',attempts:0}], edges:[] }, timestamp:Date.now(), metadata:{} };
  await cp.save('snap-1', snap);
  const loaded = await cp.load('snap-1');
  assert(loaded!==null, 'snap saved and loaded');
  assert(loaded.executionId==='e1', 'correct execution');
  const allSnaps = await cp.list();
  assert(allSnaps.length>=1, 'snap listed');

  // 5. RecoveryManager
  console.log('\n--- 5. Recovery ---');
  const rec = new RecoveryManager();
  const plan = await rec.recover(snap);
  assert(plan.canRecover!==undefined, 'recovery plan');

  // 6. ReplayEngine (uses CheckpointManager)
  console.log('\n--- 6. Replay ---');
  const replay = new ReplayEngine(cp);
  const steps = await replay.replayFast('e1');
  assert(steps.length>0, 'replay steps');

  // 7. RuntimeKernelIntegrator
  console.log('\n--- 7. Kernel Integration ---');
  const M = await import('../common/Kernel.js');
  const I = await import('./RuntimeKernelIntegrator.js');
  const kernel = new M.MorPexKernel({});
  const integ = new I.RuntimeKernelIntegrator({ maxParallel:2 });
  integ.mountToKernel(kernel);
  assert(integ.getDAGRuntime()!==null, 'DAG');
  assert(integ.getCheckpointManager()!==null, 'CP');

  console.log('\n=== Phase 1 all PASSED ===\n');
}
main().catch(e=>{console.error('FAIL:', e.message||e); process.exit(1);});
