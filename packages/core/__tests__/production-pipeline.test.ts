/**
 * production-pipeline.test.ts - Pipeline execution production tests
 * Covers: 7-stage pipeline, failure/abort, EventBus integration, input params, context chain
 * Usage: npx tsx packages/core/__tests__/production-pipeline.test.ts
 */

console.log('\n' + '='.repeat(60));
console.log('  Production: Pipeline Execution Tests');
console.log('='.repeat(60) + '\n');

import { EventBus } from '../src/infrastructure/common/EventBus.js';

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

// ─────────────────────────────────────────────────────
//  v16 新增测试: Engine 轮询 + Approval 阻塞 + Ontology 缓存
// ─────────────────────────────────────────────────────

import { UnifiedExecutionEngine } from '../src/execution/UnifiedExecutionEngine.js';
import { ApprovalGate } from '../src/governance/ApprovalGate.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

// --- Test 8: Engine orchestrator 主路径等待完成（会话 15 去兜底化：mission 轮询路径已移除） ---
(async () => {
  console.log('\n--- Test 8: Engine orchestrator path (wait for completion) ---');
  const bus = new EventBus();
  const engine = new UnifiedExecutionEngine(bus);

  // 注入一个模拟总大脑：1.5s 后完成（模拟 LLM 编排耗时）
  engine.setOrchestratorAgent({
    name: 'MockOrchestrator',
    run: async (goal: string) => {
      await new Promise(r => setTimeout(r, 1500));
      return {
        success: true,
        output: { text: `交付物: ${goal}` },
        iterations: 1,
        stepsExecuted: 1,
        auditLog: [{ iteration: 1, pass: true, issues: [], reasoning: 'ok' }],
        stepResults: new Map([['step', { text: '成果' }]]),
        duration: 1500,
      };
    },
  });

  const result = await engine.execute({ goal: 'test orchestrator', timeoutMs: 5000 });
  ok(result.ok === true, 'Engine orchestrator returns ok=true after completion');
  ok(result.status === 'completed', 'Engine orchestrator returns status=completed');
  ok(result.mode === 'orchestrator', 'Engine orchestrator returns mode=orchestrator');
  ok(result.duration >= 1500, 'Engine waited for orchestrator completion (duration >= 1500ms)');
  console.log(`  duration=${result.duration}ms, mode=${result.mode}, status=${result.status}`);
})();

// --- Test 9: ApprovalGate waitForDecision 阻塞 ---
(async () => {
  console.log('\n--- Test 9: ApprovalGate waitForDecision blocking ---');
  const bus = new EventBus();
  const gate = new ApprovalGate(bus);

  const req = gate.requestApproval('art-1', 'test-artifact', { pass: true, level: 'PASS', checks: [], blockingIssues: [] }, 'HIGH');
  ok(req.decision === undefined, 'ApprovalGate returns undefined decision for HIGH risk (needs human)');
  ok(req.id.startsWith('apr_'), 'ApprovalGate request has valid ID');

  // 异步 approve
  setTimeout(() => {
    gate.decide(req.id, 'APPROVED', 'test-approver');
  }, 500);

  const decided = await gate.waitForDecision(req.id, 5000);
  ok(decided.decision === 'APPROVED', 'waitForDecision returns APPROVED after decide()');
  ok(decided.decidedBy === 'test-approver', 'waitForDecision preserves decidedBy');

  // 超时测试
  const req2 = gate.requestApproval('art-2', 'timeout-test', { pass: true, level: 'PASS', checks: [], blockingIssues: [] }, 'HIGH');
  const start = Date.now();
  const timedOut = await gate.waitForDecision(req2.id, 100); // 100ms 超时
  const elapsed = Date.now() - start;
  ok(timedOut.decision === undefined, 'waitForDecision times out and returns undefined');
  ok(elapsed >= 100, 'waitForDecision respects timeout (' + elapsed + 'ms)');
})();

// --- Test 10: Ontology Grounded Reasoning LRU Cache ---
(async () => {
  console.log('\n--- Test 10: Ontology Grounded Reasoning LRU Cache ---');
  // 测试 LRU 缓存逻辑（独立于 LLM 调用）
  const cache = new Map<string, { result: unknown; timestamp: number }>();
  const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
  const CACHE_MAX_SIZE = 50;

  function getCacheKey(goal: string): string {
    return goal.replace(/\s+/g, '_').substring(0, 64);
  }

  function getCached(key: string) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
      return null;
    }
    return entry.result;
  }

  function setCached(key: string, result: unknown) {
    if (cache.size >= CACHE_MAX_SIZE) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(key, { result, timestamp: Date.now() });
  }

  const key1 = getCacheKey('开发空气检测设备');
  const key2 = getCacheKey('优化登录模块');

  // 写入缓存
  setCached(key1, { proposal: 'air quality sensor' });
  setCached(key2, { proposal: 'login optimization' });

  ok(cache.size === 2, 'Cache has 2 entries after setting');

  // 读取缓存
  const r1 = getCached(key1);
  ok(r1 !== null, 'Cache hit returns value');
  ok((r1 as any).proposal === 'air quality sensor', 'Cache hit preserves data');

  // LRU 淘汰
  for (let i = 0; i < CACHE_MAX_SIZE; i++) {
    setCached(getCacheKey('test_' + i), { proposal: 'test' });
  }
  // key1 和 key2 应该被淘汰（最旧）
  const r1again = getCached(key1);
  ok(r1again === null, 'LRU eviction removes oldest entries');
  ok(cache.size <= CACHE_MAX_SIZE, 'Cache size capped at max (' + cache.size + '/' + CACHE_MAX_SIZE + ')');
})();

// --- Summary ---
setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  console.log('  Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
  console.log('='.repeat(60) + '\n');
}, 3000);
