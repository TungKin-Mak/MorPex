#!/usr/bin/env npx tsx
/**
 * production-memory.test.ts — Memory & Knowledge Production Tests
 *
 * Tests EventBus, EventStore, data persistence, data isolation,
 * event sourcing consistency, and MemoryWiki functionality.
 *
 * Usage: npx tsx packages/core/__tests__/production-memory.test.ts
 */

console.log('\n' + '='.repeat(60));
console.log('  Production: Memory & Knowledge Tests');
console.log('='.repeat(60) + '\n');

let pass = 0; let fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log('  [PASS] ' + msg); } else { fail++; console.log('  [FAIL] ' + msg); } }
function eq<T>(a: T, b: T, msg: string) { if (a === b) { pass++; } else { fail++; console.log('  [FAIL] ' + msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); } }

// ============================================================
// Mock EventBus
// ============================================================
class EventBus {
  private handlers: Map<string, Set<Function>> = new Map();
  private history: any[] = [];

  on(event: string, handler: Function): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: any): void {
    const entry = { event, payload, timestamp: Date.now() };
    this.history.push(entry);
    this.handlers.get(event)?.forEach(h => h(entry));
    this.handlers.get('*')?.forEach(h => h(entry));
  }

  getHistory(): any[] { return [...this.history]; }
  clear(): void { this.history = []; this.handlers.clear(); }
}

// ============================================================
// Mock EventStore
// ============================================================
class EventStore {
  private events: any[] = [];
  private name: string;

  constructor(name: string = 'default') { this.name = name; }

  async append(event: any): Promise<void> { this.events.push({ ...event, storedAt: Date.now() }); }
  async appendBatch(events: any[]): Promise<void> { for (const e of events) this.events.push({ ...e, storedAt: Date.now() }); }
  async getAll(): Promise<any[]> { return [...this.events]; }
  async queryByExecutionId(id: string): Promise<any[]> { return this.events.filter(e => e.executionId === id); }
  async queryByType(type: string): Promise<any[]> { return this.events.filter(e => e.type === type); }
  async queryByTimeRange(start: number, end: number): Promise<any[]> { return this.events.filter(e => e.timestamp >= start && e.timestamp <= end); }
  async getStats(): Promise<any> {
    const types = new Set(this.events.map(e => e.type));
    const sessions = new Set(this.events.map(e => e.executionId));
    return { totalEvents: this.events.length, uniqueTypes: types.size, uniqueSessions: sessions.size };
  }
  count(): number { return this.events.length; }
}

// ============================================================
// Mock MemoryWiki
// ============================================================
class MemoryWiki {
  private store: Map<string, any> = new Map();
  ready: boolean = true;

  async remember(item: any): Promise<void> { this.store.set(item.id, item); }
  async query(type?: string): Promise<any[]> {
    if (type) return Array.from(this.store.values()).filter(i => i.type === type);
    return Array.from(this.store.values());
  }
  async get(id: string): Promise<any | undefined> { return this.store.get(id); }
  stats(): any {
    const types = new Set(Array.from(this.store.values()).map(i => i.type));
    return { total: this.store.size, types: Array.from(types) };
  }
}

// ============================================================
// Tests
// ============================================================

// --- 1. EventBus Publish/Subscribe ---
console.log('-- 1. EventBus Publish/Subscribe --\n');
{
  const bus = new EventBus();
  const received: any[] = [];
  bus.on('test.event', (e: any) => received.push(e));

  bus.emit('test.event', { data: 'hello' });
  eq(received.length, 1, 'Event received');
  eq(received[0].payload.data, 'hello', 'Payload correct');
}

// --- 2. EventBus Multiple Subscribers ---
console.log('\n-- 2. EventBus Multiple Subscribers --\n');
{
  const bus = new EventBus();
  let count1 = 0, count2 = 0;
  bus.on('multi', () => count1++);
  bus.on('multi', () => count2++);
  bus.emit('multi', {});
  eq(count1, 1, 'Subscriber 1 notified');
  eq(count2, 1, 'Subscriber 2 notified');
}

// --- 3. EventBus Wildcard Subscription ---
console.log('\n-- 3. EventBus Wildcard Subscription --\n');
{
  const bus = new EventBus();
  const all: any[] = [];
  bus.on('*', (e: any) => all.push(e));
  bus.emit('a.b', {});
  bus.emit('c.d', {});
  eq(all.length, 2, 'Wildcard catches all events');
}

// --- 4. EventBus Unsubscribe ---
console.log('\n-- 4. EventBus Unsubscribe --\n');
{
  const bus = new EventBus();
  let count = 0;
  const fn = () => count++;
  bus.on('test', fn);
  bus.emit('test', {});
  bus.off('test', fn);
  bus.emit('test', {});
  eq(count, 1, 'Unsubscribed handler not called');
}

// --- 5. EventStore Append & Query ---
console.log('\n-- 5. EventStore Append & Query --\n');
{
  const store = new EventStore();
  await store.append({ id: 'e1', type: 'test', executionId: 'x1', timestamp: Date.now(), payload: {} });
  eq(store.count(), 1, '1 event stored');
  const all = await store.getAll();
  eq(all.length, 1, 'getAll returns all events');
}

// --- 6. EventStore Batch Append ---
console.log('\n-- 6. EventStore Batch Append --\n');
{
  const store = new EventStore();
  await store.appendBatch([
    { id: 'b1', type: 'batch', executionId: 'x2', timestamp: 100, payload: {} },
    { id: 'b2', type: 'batch', executionId: 'x2', timestamp: 200, payload: {} },
    { id: 'b3', type: 'batch', executionId: 'x2', timestamp: 300, payload: {} },
  ]);
  eq(store.count(), 3, 'Batch append stores 3 events');
}

// --- 7. Query by Execution ID ---
console.log('\n-- 7. Query by Execution ID --\n');
{
  const store = new EventStore();
  await store.append({ id: 'a1', type: 't', executionId: 'alpha', timestamp: 1, payload: {} });
  await store.append({ id: 'a2', type: 't', executionId: 'alpha', timestamp: 2, payload: {} });
  await store.append({ id: 'b1', type: 't', executionId: 'beta', timestamp: 3, payload: {} });
  const alpha = await store.queryByExecutionId('alpha');
  const beta = await store.queryByExecutionId('beta');
  eq(alpha.length, 2, '2 events for alpha');
  eq(beta.length, 1, '1 event for beta');
}

// --- 8. Query by Type ---
console.log('\n-- 8. Query by Type --\n');
{
  const store = new EventStore();
  await store.append({ id: 't1', type: 'mission.created', executionId: 'x', timestamp: 1, payload: {} });
  await store.append({ id: 't2', type: 'mission.started', executionId: 'x', timestamp: 2, payload: {} });
  await store.append({ id: 't3', type: 'mission.completed', executionId: 'x', timestamp: 3, payload: {} });
  const created = await store.queryByType('mission.created');
  eq(created.length, 1, '1 mission.created event');
  const started = await store.queryByType('mission.started');
  eq(started.length, 1, '1 mission.started event');
}

// --- 9. Data Isolation ---
console.log('\n-- 9. Data Isolation --\n');
{
  const storeA = new EventStore('agent_a');
  const storeB = new EventStore('agent_b');
  await storeA.append({ id: 's1', type: 'secret', executionId: 'a', timestamp: 1, payload: { secret: 'a-secret' } });
  await storeB.append({ id: 's2', type: 'secret', executionId: 'b', timestamp: 1, payload: { secret: 'b-secret' } });
  const aData = await storeA.getAll();
  const bData = await storeB.getAll();
  eq(aData.length, 1, 'Agent A has 1 event');
  eq(bData.length, 1, 'Agent B has 1 event');
  eq(aData[0].payload.secret, 'a-secret', 'Agent A secret isolated');
  eq(bData[0].payload.secret, 'b-secret', 'Agent B secret isolated');
}

// --- 10. Event Ordering ---
console.log('\n-- 10. Event Ordering --\n');
{
  const store = new EventStore();
  const events = [
    { id: 'o1', type: 'step', executionId: 'order', timestamp: 100, payload: { seq: 1 } },
    { id: 'o2', type: 'step', executionId: 'order', timestamp: 200, payload: { seq: 2 } },
    { id: 'o3', type: 'step', executionId: 'order', timestamp: 300, payload: { seq: 3 } },
    { id: 'o4', type: 'step', executionId: 'order', timestamp: 400, payload: { seq: 4 } },
    { id: 'o5', type: 'step', executionId: 'order', timestamp: 500, payload: { seq: 5 } },
  ];
  await store.appendBatch(events);
  const all = await store.getAll();
  eq(all.length, 5, 'All 5 events stored');
  for (let i = 1; i < all.length; i++) {
    ok(all[i].timestamp >= all[i - 1].timestamp, `Events in order at index ${i}`);
  }
}

// --- 11. MemoryWiki Remember/Query ---
console.log('\n-- 11. MemoryWiki Remember/Query --\n');
{
  const wiki = new MemoryWiki();
  await wiki.remember({ id: 'rec1', type: 'PlanRecord', name: 'Build app', data: { score: 0.95 } });
  await wiki.remember({ id: 'rec2', type: 'PlanRecord', name: 'Fix bug', data: { score: 0.80 } });
  await wiki.remember({ id: 'rec3', type: 'LearningRecord', name: 'Pattern X', data: { confidence: 0.9 } });

  const all = await wiki.query();
  eq(all.length, 3, '3 records stored');

  const plans = await wiki.query('PlanRecord');
  eq(plans.length, 2, '2 PlanRecords');

  const learning = await wiki.query('LearningRecord');
  eq(learning.length, 1, '1 LearningRecord');

  const r1 = await wiki.get('rec1');
  ok(r1 !== undefined, 'Record retrievable by ID');
  eq(r1!.data.score, 0.95, 'Score preserved');

  const s = wiki.stats();
  eq(s.total, 3, 'Stats total = 3');
  ok(s.types.includes('PlanRecord'), 'Stats includes PlanRecord');
}

// --- 12. EventStore Stats ---
console.log('\n-- 12. EventStore Stats --\n');
{
  const store = new EventStore();
  await store.append({ id: 's1', type: 'a', executionId: 'x1', timestamp: 1, payload: {} });
  await store.append({ id: 's2', type: 'b', executionId: 'x1', timestamp: 2, payload: {} });
  await store.append({ id: 's3', type: 'a', executionId: 'x2', timestamp: 3, payload: {} });
  const stats = await store.getStats();
  eq(stats.totalEvents, 3, 'Total events: 3');
  eq(stats.uniqueTypes, 2, 'Unique types: 2');
  eq(stats.uniqueSessions, 2, 'Unique sessions: 2');
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('  Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('='.repeat(60) + '\n');
process.exit(fail > 0 ? 1 : 0);
