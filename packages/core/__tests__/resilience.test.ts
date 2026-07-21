/**
 * Resilience Module Tests — RetryPolicy, CircuitBreaker, ErrorHandlerService, CheckpointManager
 *
 * v9.2 Phase 1: Core Stability
 */

import Database from 'better-sqlite3';
import { RetryPolicy } from '../src/common/resilience/RetryPolicy.js';
import { CircuitBreaker, CircuitOpenError } from '../src/common/resilience/CircuitBreaker.js';
import { ErrorHandlerService } from '../src/common/resilience/ErrorHandlerService.js';
import { CheckpointManager } from '../src/runtime/checkpoint/CheckpointManager.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.error('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (a === b) pass++; else { console.error(`  ❌ ${m}: ${JSON.stringify(a)}≠${JSON.stringify(b)}`); fail++; } }

async function run() {
  console.log('\n=== Resilience Module Tests ===\n');

  // ── 1. RetryPolicy: delay calculation ──
  console.log('── 1. RetryPolicy ──');

  // 1.1 fixed
  const fixed = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 500, strategy: 'fixed' });
  eq(fixed.getDelay(0), 500, 'fixed delay 0');
  eq(fixed.getDelay(1), 500, 'fixed delay 1');
  eq(fixed.getDelay(10), 500, 'fixed delay 10 (no cap because < maxDelay)');

  // 1.2 exponential with max cap
  const exp = new RetryPolicy({ maxAttempts: 5, baseDelayMs: 1000, strategy: 'exponential', maxDelayMs: 5000 });
  eq(exp.getDelay(0), 1000, 'exp delay 0 = 1000');
  eq(exp.getDelay(1), 2000, 'exp delay 1 = 2000');
  eq(exp.getDelay(2), 4000, 'exp delay 2 = 4000');
  ok(exp.getDelay(3) <= 5000, 'exp delay 3 capped at 5000');

  // 1.3 linear
  const linear = new RetryPolicy({ baseDelayMs: 200, strategy: 'linear' });
  eq(linear.getDelay(0), 200, 'linear delay 0');
  eq(linear.getDelay(4), 1000, 'linear delay 4 = 200*5');

  // 1.4 shouldRetry filtering
  const filtered = new RetryPolicy({
    retryableErrors: ['timeout', 'retryable'],
    nonRetryableErrors: ['fatal'],
  });
  ok(filtered.shouldRetry(new Error('timeout occurred')), 'retry on timeout');
  ok(filtered.shouldRetry(new Error('this is retryable')), 'retry on retryable');
  ok(!filtered.shouldRetry(new Error('fatal error')), 'no retry on fatal');
  ok(!filtered.shouldRetry(new Error('validation error')), 'no retry on non-listed');

  // 1.5 presets
  eq(RetryPolicy.fast().maxAttempts, 5, 'fast preset maxAttempts');
  eq(RetryPolicy.standard().maxAttempts, 3, 'standard preset maxAttempts');
  eq(RetryPolicy.robust().maxAttempts, 5, 'robust preset maxAttempts');
  eq(RetryPolicy.noRetry().maxAttempts, 1, 'noRetry preset maxAttempts');

  // ── 2. CircuitBreaker ──
  console.log('\n── 2. CircuitBreaker ──');

  // 2.1 CLOSED→OPEN after threshold failures
  const cb = new CircuitBreaker('test', { failureThreshold: 3, openTimeoutMs: 5000 });
  eq(cb.getState(), 'CLOSED', 'starts CLOSED');
  cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
  eq(cb.getState(), 'OPEN', '→OPEN after 3 failures');

  // 2.2 OPEN throws CircuitOpenError
  let thrown = false;
  try { await cb.execute(async () => 'should not run'); }
  catch (e: any) { thrown = e instanceof CircuitOpenError; }
  ok(thrown, 'OPEN throws CircuitOpenError');

  // 2.3 OPEN→HALF_OPEN after timeout
  const cb2 = new CircuitBreaker('test2', { failureThreshold: 2, successThreshold: 2, openTimeoutMs: 10, halfOpenMaxRequests: 3 });
  cb2.recordFailure(); cb2.recordFailure();
  eq(cb2.getState(), 'OPEN', 'test2: OPEN');
  await new Promise(r => setTimeout(r, 20));
  eq(cb2.getState(), 'HALF_OPEN', '→HALF_OPEN after timeout');

  // 2.4 HALF_OPEN→CLOSED after successThreshold successes
  await cb2.execute(async () => 'ok');
  await cb2.execute(async () => 'ok');
  eq(cb2.getState(), 'CLOSED', '→CLOSED after 2 successes');

  // 2.5 reset
  const cb3 = new CircuitBreaker('test3', { failureThreshold: 2 });
  cb3.recordFailure(); cb3.recordFailure();
  eq(cb3.getState(), 'OPEN', 'test3: OPEN');
  cb3.reset();
  eq(cb3.getState(), 'CLOSED', 'reset → CLOSED');

  // ── 3. ErrorHandlerService ──
  console.log('\n── 3. ErrorHandlerService ──');

  // 3.1 successful execution (no retries)
  const ehs = new ErrorHandlerService();
  ehs.registerPolicy('test', RetryPolicy.fast());
  const result = await ehs.executeWithRecovery(async () => 'hello', {
    stage: 'test', missionId: 'm1', operation: 'op1',
  });
  eq(result, 'hello', 'successful execution returns value');

  // 3.2 retry then succeed
  let attempts = 0;
  const afterRetry = await ehs.executeWithRecovery(async () => {
    attempts++;
    if (attempts < 2) throw new Error('retryable timeout');
    return 'ok';
  }, { stage: 'test', missionId: 'm2', operation: 'op2' });
  eq(afterRetry, 'ok', 'retry then succeed');
  ok(attempts === 2, 'took 2 attempts');

  // 3.3 all retries exhausted → compensator called
  let compensated = false;
  let errMessage = '';
  try {
    await ehs.executeWithRecovery(async () => {
      throw new Error('persistent failure');
    }, {
      stage: 'test', missionId: 'm3', operation: 'op3',
      compensator: async (err) => { compensated = true; errMessage = err.message; },
    });
  } catch (e: any) {
    ok(e.message.includes('persistent'), 'threw after all retries');
  }
  ok(compensated, 'compensator was called');
  eq(errMessage, 'persistent failure', 'compensator received correct error');

  // 3.4 circuit breaker blocks when open
  const cb4 = new CircuitBreaker('breaker-test', { failureThreshold: 2, openTimeoutMs: 50000 });
  ehs.registerBreaker('breaker-stage', cb4);
  // trigger open
  try { await ehs.executeWithRecovery(async () => { throw new Error('fail1'); }, { stage: 'breaker-stage', missionId: 'm4', operation: 'op4' }); } catch {}
  try { await ehs.executeWithRecovery(async () => { throw new Error('fail2'); }, { stage: 'breaker-stage', missionId: 'm4', operation: 'op4' }); } catch {}
  eq(cb4.getState(), 'OPEN', 'breaker is OPEN');

  // third call should be blocked immediately
  try {
    await ehs.executeWithRecovery(async () => 'should not run', { stage: 'breaker-stage', missionId: 'm4', operation: 'op4' });
    ok(false, 'should have thrown');
  } catch (e: any) {
    ok(e instanceof CircuitOpenError || e.message.includes('OPEN'), 'blocked by circuit breaker');
  }

  // 3.5 error log
  const log = ehs.getErrorLog('m4');
  ok(log.length >= 2, 'error log has entries');

  // 3.6 breaker states
  const states = ehs.getBreakerStates();
  ok(states['breaker-stage'] === 'OPEN', 'breaker state reported');

  // ── 4. CheckpointManager (SQLite) ──
  console.log('\n── 4. CheckpointManager (SQLite) ──');

  const db = new Database(':memory:');
  const cpm = new CheckpointManager({ db: db as any });

  // 4.1 save/load
  await cpm.save('snap1', {
    executionId: 'exe1', dagId: 'dag1',
    dagState: { nodeStates: [], edges: [] },
    timestamp: Date.now(),
    metadata: { stage: 'execution' },
  });
  const loaded = await cpm.load('snap1');
  ok(loaded !== null, 'load returns snapshot');
  eq(loaded!.executionId, 'exe1', 'loaded executionId correct');

  // 4.2 saveMissionCheckpoint / loadMissionCheckpoint
  await cpm.saveMissionCheckpoint({
    missionId: 'mis1', stage: 'planning',
    contextSnapshotId: 'ctx_1', artifactVersions: { art1: 3 },
    agentTeamState: { leader: 'planner-001' },
    timestamp: Date.now(),
  });
  const mc = await cpm.loadMissionCheckpoint('mis1');
  ok(mc !== null, 'mission checkpoint loaded');
  eq(mc!.stage, 'planning', 'stage restored');
  eq(mc!.artifactVersions['art1'], 3, 'artifact version restored');

  // 4.3 listCheckpoints
  await cpm.saveMissionCheckpoint({
    missionId: 'mis1', stage: 'execution',
    contextSnapshotId: 'ctx_2', artifactVersions: {},
    agentTeamState: {}, timestamp: Date.now(),
  });
  const list = await cpm.listCheckpoints('mis1');
  ok(list.length >= 2, 'multiple checkpoints listed');

  // 4.4 cleanup
  const removed = await cpm.cleanup(0);
  ok(removed >= 0, 'cleanup returns count');

  // 4.5 delete
  await cpm.save('deletable', { executionId: 'd1', dagId: '', dagState: { nodeStates: [], edges: [] }, timestamp: 1, metadata: {} });
  const deleted = await cpm.delete('deletable');
  ok(deleted, 'delete returns true');
  const gone = await cpm.load('deletable');
  ok(gone === null, 'deleted checkpoint gone');

  db.close();

  // ── 5. JSONL fallback ──
  console.log('\n── 5. CheckpointManager (JSONL fallback) ──');

  const cpm2 = new CheckpointManager({ baseDir: './data/test-checkpoints' });
  await cpm2.save('jtest', { executionId: 'j1', dagId: '', dagState: { nodeStates: [], edges: [] }, timestamp: 123, metadata: { x: 1 } });
  const jloaded = await cpm2.load('jtest');
  ok(jloaded !== null, 'JSONL: load');
  eq(jloaded!.timestamp, 123, 'JSONL: timestamp preserved');
  await cpm2.delete('jtest');
  const jgone = await cpm2.load('jtest');
  ok(jgone === null, 'JSONL: deleted');
  await cpm2.cleanup(0);

  // Summary
  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
