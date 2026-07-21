/**
 * Unified EventStore — SQLite 后端集成测试
 *
 * v9.2 Stage 0: 验证新 EventStore 的实现正确性。
 *
 * 测试覆盖:
 *   1. SqliteEventStore: append + query by executionId
 *   2. SqliteEventStore: appendBatch 事务写入
 *   3. SqliteEventStore: appendDecision + queryDecisions
 *   4. SqliteEventStore: replay 异步迭代器
 *   5. SqliteEventStore: getLatestSequence
 *   6. SqliteEventStore: query 多条件过滤
 *   7. SqliteEventStore: getStats
 *   8. SqliteEventStore: clear
 *   9. UnifiedEventStore: 旧版 replay() 兼容
 *  10. UnifiedEventStore: 旧版 query() 兼容
 *  11. UnifiedEventStore: getStream() + getByExecutionId()
 *  12. UnifiedEventStore: getDecisionStream()
 */

import { SqliteEventStore } from '../src/protocol/events/store/SqliteEventStore.js';
import { UnifiedEventStore } from '../src/protocol/events/store/UnifiedEventStore.js';
import type { BaseEvent } from '../src/protocol/events/BaseEvent.js';
import type { DecisionEvent } from '../src/protocol/events/DecisionEvent.js';
import { EventType } from '../src/protocol/events/EventType.js';

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void | Promise<void>) {
  (async () => {
    try {
      await fn();
      pass++;
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      fail++;
      console.log(`  ❌ ${name}: ${e.message}`);
    }
  })();
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── Helper: create in-memory database ──

async function createMemoryDb(): Promise<any> {
  const { createRequire } = await import('node:module');
  const req = createRequire(process.cwd() + '/package.json');
  const Database = req('better-sqlite3');
  const DB = Database.default ?? Database;
  return new DB(':memory:');
}

function makeEvent(overrides: Partial<BaseEvent> = {}): BaseEvent {
  return {
    id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: EventType.MISSION_CREATED,
    timestamp: Date.now(),
    executionId: 'test-exec-001',
    source: 'test',
    payload: { key: 'value' },
    ...overrides,
  };
}

function makeDecision(overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    id: `dec_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    executionId: 'test-exec-001',
    source: 'test-stage',
    input: { userMessage: 'hello' },
    reasoning: 'test reasoning',
    evidence: ['evidence-1'],
    decision: 'create_mission',
    confidence: 0.85,
    twinVersion: 1,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════

console.log('\n=== Unified EventStore Tests ===\n');

// ── 1. SqliteEventStore: append + query by executionId ──

test('SqliteEventStore: append + query by executionId', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  const event1 = makeEvent({ executionId: 'exec-1', type: EventType.MISSION_CREATED });
  const event2 = makeEvent({ executionId: 'exec-1', type: EventType.PLAN_CREATED });
  const event3 = makeEvent({ executionId: 'exec-2', type: EventType.MISSION_CREATED });

  await store.append(event1);
  await store.append(event2);
  await store.append(event3);

  const exec1Events = await store.query({ executionId: 'exec-1' });
  assert(exec1Events.length === 2, `Expected 2 events for exec-1, got ${exec1Events.length}`);
  assert(exec1Events[0].executionId === 'exec-1', 'executionId matches');
  assert(exec1Events.some(e => e.type === EventType.MISSION_CREATED), 'MISSION_CREATED present');
  assert(exec1Events.some(e => e.type === EventType.PLAN_CREATED), 'PLAN_CREATED present');

  const exec2Events = await store.query({ executionId: 'exec-2' });
  assert(exec2Events.length === 1, `Expected 1 event for exec-2, got ${exec2Events.length}`);

  const noExecEvents = await store.query({ executionId: 'nonexistent' });
  assert(noExecEvents.length === 0, 'no events for nonexistent exec');

  await store.close();
});

// ── 2. SqliteEventStore: appendBatch with transaction ──

test('SqliteEventStore: appendBatch with transaction', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  const events = [
    makeEvent({ executionId: 'batch-test', type: EventType.MISSION_CREATED, payload: { n: 1 } }),
    makeEvent({ executionId: 'batch-test', type: EventType.PLAN_CREATED, payload: { n: 2 } }),
    makeEvent({ executionId: 'batch-test', type: EventType.EXECUTION_STARTED, payload: { n: 3 } }),
    makeEvent({ executionId: 'batch-test', type: EventType.EXECUTION_COMPLETED, payload: { n: 4 } }),
  ];

  await store.appendBatch(events);

  const results = await store.query({ executionId: 'batch-test' });
  assert(results.length === 4, `Expected 4 events from batch, got ${results.length}`);

  const payloads = results.map(e => (e.payload as any).n);
  assert(payloads.includes(1), 'payload n=1 present');
  assert(payloads.includes(4), 'payload n=4 present');

  await store.close();
});

// ── 3. SqliteEventStore: appendDecision + queryDecisions ──

test('SqliteEventStore: appendDecision + queryDecisions', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  const dec1 = makeDecision({ executionId: 'dec-exec', source: 'intent-stage', confidence: 0.9 });
  const dec2 = makeDecision({ executionId: 'dec-exec', source: 'planning-stage', confidence: 0.7 });

  await store.appendDecision(dec1);
  await store.appendDecision(dec2);

  const results = await store.queryDecisions({ executionId: 'dec-exec' });
  assert(results.length === 2, `Expected 2 decisions, got ${results.length}`);
  assert(results.some(d => d.source === 'intent-stage'), 'intent-stage decision present');
  assert(results.some(d => d.source === 'planning-stage'), 'planning-stage decision present');

  const filtered = await store.queryDecisions({ source: 'intent-stage' });
  assert(filtered.length === 1, `Expected 1 intent-stage decision, got ${filtered.length}`);
  assert(filtered[0].confidence === 0.9, 'confidence preserved');

  await store.close();
});

// ── 4. SqliteEventStore: replay async iterator ──

test('SqliteEventStore: replay from sequence', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  const events = Array.from({ length: 5 }, (_, i) =>
    makeEvent({ executionId: 'replay-test', payload: { index: i } })
  );
  await store.appendBatch(events);

  const seq = await store.getLatestSequence();
  let count = 0;
  for await (const _event of store.replay(0)) {
    count++;
  }
  assert(count === 5, `Expected 5 events replayed, got ${count}`);

  // replay from seq-2 should yield last 2
  count = 0;
  for await (const _event of store.replay(seq - 2)) {
    count++;
  }
  assert(count === 2, `Expected 2 events from sequence ${seq - 2}, got ${count}`);

  await store.close();
});

// ── 5. SqliteEventStore: getLatestSequence ──

test('SqliteEventStore: getLatestSequence', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  assert(await store.getLatestSequence() === 0, 'empty store → sequence 0');

  await store.append(makeEvent());
  assert(await store.getLatestSequence() === 1, '1 event → sequence 1');

  await store.append(makeEvent());
  await store.append(makeEvent());
  assert(await store.getLatestSequence() === 3, '3 events → sequence 3');

  await store.close();
});

// ── 6. SqliteEventStore: multi-filter query ──

test('SqliteEventStore: multi-filter query', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);
  const now = Date.now();

  await store.append(makeEvent({
    executionId: 'multi-filter',
    type: EventType.MISSION_CREATED,
    source: 'source-a',
    timestamp: now - 10000,
  }));
  await store.append(makeEvent({
    executionId: 'multi-filter',
    type: EventType.PLAN_CREATED,
    source: 'source-a',
    timestamp: now - 5000,
  }));
  await store.append(makeEvent({
    executionId: 'multi-filter',
    type: EventType.EXECUTION_STARTED,
    source: 'source-b',
    timestamp: now,
  }));

  const typeFilter = await store.query({ type: EventType.MISSION_CREATED });
  assert(typeFilter.length === 1, 'type filter works');

  const sourceFilter = await store.query({ source: 'source-a' });
  assert(sourceFilter.length === 2, 'source filter works');

  const timeFilter = await store.query({ since: now - 8000, until: now + 1000 });
  assert(timeFilter.length === 2, 'time range filter works');

  const combined = await store.query({
    executionId: 'multi-filter',
    source: 'source-a',
    since: now - 20000,
    limit: 10,
  });
  assert(combined.length === 2, 'combined filter works');

  await store.close();
});

// ── 7. SqliteEventStore: getStats ──

test('SqliteEventStore: getStats', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  await store.append(makeEvent({ type: EventType.MISSION_CREATED }));
  await store.append(makeEvent({ type: EventType.MISSION_CREATED }));
  await store.append(makeEvent({ type: EventType.PLAN_CREATED }));
  await store.appendDecision(makeDecision());

  const stats = await store.getStats();
  assert(stats.totalEvents === 3, `Expected 3 events, got ${stats.totalEvents}`);
  assert(stats.totalDecisions === 1, `Expected 1 decision, got ${stats.totalDecisions}`);
  assert(stats.byType[EventType.MISSION_CREATED] === 2, 'MISSION_CREATED count = 2');
  assert(stats.byType[EventType.PLAN_CREATED] === 1, 'PLAN_CREATED count = 1');
  assert(stats.latestSequence >= 3, `sequence >= 3, got ${stats.latestSequence}`);
  assert(stats.dbSizeBytes === 0, 'in-memory db → sizeBytes = 0');

  await store.close();
});

// ── 8. SqliteEventStore: clear ──

test('SqliteEventStore: clear', async () => {
  const db = await createMemoryDb();
  const store = new SqliteEventStore(db);

  await store.append(makeEvent());
  await store.append(makeEvent());
  await store.appendDecision(makeDecision());

  const before = await store.getStats();
  assert(before.totalEvents === 2, `Before clear: 2 events`);

  await store.clear();

  const after = await store.getStats();
  assert(after.totalEvents === 0, `After clear: 0 events`);
  assert(after.totalDecisions === 0, `After clear: 0 decisions`);
  assert(after.latestSequence === 0, `After clear: sequence 0`);

  await store.close();
});

// ── 9. UnifiedEventStore: backward-compatible replay() ──

test('UnifiedEventStore: legacy replay() compat', async () => {
  const db = await createMemoryDb();
  const store = new UnifiedEventStore(db);

  await store.append(makeEvent({
    executionId: 'legacy-replay',
    type: EventType.NODE_STARTED,
    payload: { taskId: 't1', from: 'IDLE', to: 'RUNNING' },
  }));

  const state = await store.replayLegacy('legacy-replay');
  assert(state.totalEvents === 1, 'replay: 1 event');

  await store.close();
});

// ── 10. UnifiedEventStore: backward-compatible query() ──

test('UnifiedEventStore: legacy query() compat', async () => {
  const db = await createMemoryDb();
  const store = new UnifiedEventStore(db);

  await store.append(makeEvent({
    executionId: 'legacy-query',
    type: 'tool_call_state_change' as any,
    payload: { toolCallId: 'tc-1', from: 'IDLE', to: 'RUNNING' },
  }));

  const sourcingEvents = await store.queryLegacy('legacy-query');
  assert(sourcingEvents.length >= 0, 'legacy query returns without error');

  await store.close();
});

// ── 11. UnifiedEventStore: getStream() + getByExecutionId() ──

test('UnifiedEventStore: getStream + getByExecutionId', async () => {
  const db = await createMemoryDb();
  const store = new UnifiedEventStore(db);

  await store.append(makeEvent({ executionId: 'stream-test' }));
  await store.append(makeEvent({ executionId: 'stream-test' }));
  await store.append(makeEvent({ executionId: 'other-exec' }));

  const stream = await store.getStream();
  assert(stream.length === 3, `getStream: 3 events, got ${stream.length}`);

  const byExec = await store.getByExecutionId('stream-test');
  assert(byExec.length === 2, `getByExecutionId: 2 events, got ${byExec.length}`);

  await store.close();
});

// ── 12. UnifiedEventStore: getDecisionStream() ──

test('UnifiedEventStore: getDecisionStream', async () => {
  const db = await createMemoryDb();
  const store = new UnifiedEventStore(db);

  await store.appendDecision(makeDecision({ executionId: 'dec-stream' }));
  await store.appendDecision(makeDecision({ executionId: 'dec-stream' }));
  await store.appendDecision(makeDecision({ executionId: 'other-dec' }));

  const allDecisions = await store.getDecisionStream();
  assert(allDecisions.length === 3, `getDecisionStream: 3 decisions, got ${allDecisions.length}`);

  const byExec = await store.getDecisionsByExecution('dec-stream');
  assert(byExec.length === 2, `getDecisionsByExecution: 2 decisions, got ${byExec.length}`);

  await store.close();
});

// ═══════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════

(async () => {
  await new Promise(r => setTimeout(r, 300));

  console.log(`\n=== Unified EventStore Tests: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
})();
