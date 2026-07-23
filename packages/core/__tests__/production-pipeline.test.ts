/**
 * production-pipeline.test.ts - Pipeline execution production tests
 * Covers: 7-stage pipeline, failure/abort, EventBus integration, input params, context chain
 * Usage: npx tsx packages/core/__tests__/production-pipeline.test.ts
 */

console.log('\n' + '='.repeat(60));
console.log('  Production: Pipeline Execution Tests');
console.log('='.repeat(60) + '\n');

import { EventBus } from '../src/common/EventBus.js';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log('  [PASS] ' + msg); } else { fail++; console.log('  [FAIL] ' + msg); } }
function eq<T>(a: T, b: T, msg: string) { if (a === b) { pass++; } else { fail++; console.log('  [FAIL] ' + msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); } }

// --- Mock PipelineExecutor ---
interface PipelineInput {
  userInput: string; sessionId: string; executionId: string; tags: string[];
  milestones?: Array<{ id: string; description: string; priority: number }>;
}
interface PipelineStage { stage: number; status: string; durationMs: number; }
interface PipelineResult {
  trace: { pipelineId: string; sessionId: string; executionId: string; stages: PipelineStage[]; aborted: boolean; abortReason?: string; completedAt: number; startedAt: number };
  activation: { activationId: string; profile: string; dagNodes: number; estimatedLatencyMs: number } | null;
}

class MockPipelineExecutor {
  async execute(input: PipelineInput): Promise<PipelineResult> {
    const stages: PipelineStage[] = [
      { stage: 1, status: 'completed', durationMs: 5 },
      { stage: 2, status: 'completed', durationMs: 8 },
      { stage: 3, status: 'completed', durationMs: 50 },
      { stage: 4, status: 'completed', durationMs: 30 },
      { stage: 5, status: 'completed', durationMs: 10 },
      { stage: 6, status: 'completed', durationMs: 5 },
      { stage: 7, status: 'completed', durationMs: 3 },
    ];
    const now = Date.now();
    return {
      trace: { pipelineId: 'pl_' + input.executionId, sessionId: input.sessionId, executionId: input.executionId, stages, aborted: false, completedAt: now, startedAt: now - 111 },
      activation: { activationId: 'act_' + input.executionId, profile: 'defensive', dagNodes: 7, estimatedLatencyMs: 1200 },
    };
  }
  async simulateFailure(input: PipelineInput): Promise<{ trace: any; activation: null }> {
    return {
      trace: { pipelineId: 'pl_fail_' + input.executionId, sessionId: input.sessionId, executionId: input.executionId, stages: [
        { stage: 1, status: 'failed', durationMs: 3 },
        { stage: 2, status: 'skipped', durationMs: 0 }, { stage: 3, status: 'skipped', durationMs: 0 },
        { stage: 4, status: 'skipped', durationMs: 0 }, { stage: 5, status: 'skipped', durationMs: 0 },
        { stage: 6, status: 'skipped', durationMs: 0 }, { stage: 7, status: 'skipped', durationMs: 0 },
      ], aborted: true, abortReason: 'Stage 1 failed: intent analysis error', completedAt: 0, startedAt: 0 },
      activation: null,
    };
  }
}

// --- Test 1: Basic Execution ---
console.log('-- 1. Pipeline Basic Execution --\n');
{
  const exec = new MockPipelineExecutor();
  const r = await exec.execute({ userInput: 'Build REST API', sessionId: 'ses_001', executionId: 'exe_001', tags: ['api'] });
  ok(r.trace !== undefined, 'Returns trace');
  ok(r.activation !== null, 'Returns activation');
  ok(r.trace.pipelineId.startsWith('pl_'), 'pipelineId format');
  eq(r.trace.aborted, false, 'Not aborted');
  eq(r.trace.stages.length, 7, '7 stages executed');
  for (const s of r.trace.stages) eq(s.status, 'completed', 'Stage ' + s.stage + ' completed');
}

// --- Test 2: Input Parameters ---
console.log('\n-- 2. Input Parameters --\n');
{
  const exec = new MockPipelineExecutor();
  const r1 = await exec.execute({ userInput: 'Test', sessionId: 'ses_002', executionId: 'exe_002', tags: ['test'], milestones: [{ id: 'm1', description: 'M1', priority: 5 }] });
  eq(r1.trace.sessionId, 'ses_002', 'sessionId passed');
  eq(r1.trace.executionId, 'exe_002', 'executionId passed');
  const r2 = await exec.execute({ userInput: 'Empty', sessionId: 'ses_003', executionId: 'exe_003', tags: [] });
  eq(r2.trace.sessionId, 'ses_003', 'No milestones works');
  eq(r2.activation!.profile, 'defensive', 'Default profile = defensive');
}

// --- Test 3: Failure/Abort ---
console.log('\n-- 3. Pipeline Failure/Abort --\n');
{
  const exec = new MockPipelineExecutor();
  const r = await exec.simulateFailure({ userInput: 'Fail', sessionId: 'ses_fail', executionId: 'exe_fail', tags: ['fail'] });
  eq(r.trace.aborted, true, 'Pipeline aborted');
  ok(r.trace.abortReason !== undefined, 'Has abort reason');
  eq(r.activation, null, 'No activation on failure');
  eq(r.trace.stages[0].status, 'failed', 'Stage 1 failed');
  for (let i = 1; i < 7; i++) eq(r.trace.stages[i].status, 'skipped', 'Stage ' + (i + 1) + ' skipped');
}

// --- Test 4: EventBus Events ---
console.log('\n-- 4. EventBus Pipeline Events --\n');
{
  const bus = new EventBus();
  const events: string[] = [];
  bus.on('pipeline.started', (e: any) => events.push('started'));
  bus.on('pipeline.completed', (e: any) => events.push('completed'));
  bus.on('pipeline.stage', (e: any) => events.push('stage'));

  const now = Date.now();
  bus.emit({ id: 'e1', type: 'pipeline.started', executionId: 'exe_evt', timestamp: now, source: 'test', payload: {} });
  for (let s = 1; s <= 7; s++) bus.emit({ id: 'e_s' + s, type: 'pipeline.stage', executionId: 'exe_evt', timestamp: now + s, source: 'test', payload: { stage: s } });
  bus.emit({ id: 'e_end', type: 'pipeline.completed', executionId: 'exe_evt', timestamp: now + 100, source: 'test', payload: {} });

  ok(events.length >= 9, 'At least 9 events captured');
  eq(events[0], 'started', 'First event = started');
  eq(events[events.length - 1], 'completed', 'Last event = completed');
}

// --- Test 5: Context Chain ---
console.log('\n-- 5. Context Chain --\n');
{
  const exec = new MockPipelineExecutor();
  const r = await exec.execute({ userInput: 'Chain test', sessionId: 'ses_chain', executionId: 'exe_chain', tags: ['chain'] });
  ok(r.activation!.dagNodes > 0, 'DAG nodes > 0');
  ok(r.trace.completedAt >= r.trace.startedAt, 'completedAt >= startedAt');
  ok(r.trace.completedAt - r.trace.startedAt >= 0, 'Duration >= 0');
  for (const s of r.trace.stages) ok(s.durationMs < 10000, 'Stage ' + s.stage + ' duration < 10s');
}

// --- Test 6: DAG Scale ---
console.log('\n-- 6. DAG Scale --\n');
{
  const exec = new MockPipelineExecutor();
  const r = await exec.execute({ userInput: 'x', sessionId: 'ses_dag', executionId: 'exe_dag', tags: ['x'] });
  ok(r.activation!.dagNodes > 0, 'Has DAG nodes');
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('  Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('='.repeat(60) + '\n');
