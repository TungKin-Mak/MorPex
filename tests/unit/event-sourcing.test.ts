/**
 * Event Sourcing — Unit Tests
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';

const { EventStore } = await import('../../packages/core/src/protocol/events/store/EventStore.js');
const { EventProjection } = await import('../../packages/core/src/protocol/events/store/EventProjection.js');
const { EventRepository } = await import('../../packages/core/src/protocol/events/store/EventRepository.js');
const { EventType } = await import('../../packages/core/src/protocol/events/EventType.js');
import type { BaseEvent } from '../../packages/core/src/protocol/events/BaseEvent.js';

function makeEvent(overrides: Partial<BaseEvent> = {}): BaseEvent {
  return {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: overrides.type || EventType.MISSION_CREATED,
    timestamp: overrides.timestamp || Date.now(),
    executionId: overrides.executionId || 'mis_test',
    source: overrides.source || 'test',
    payload: overrides.payload || {},
  };
}

describe('EventStore — Append-Only Log', () => {
  let store: EventStore;
  const testDir = './data/test-events-' + Date.now();

  before(async () => {
    store = new EventStore({ dataDir: testDir });
    await store.load();
  });

  it('should append events and maintain order', async () => {
    await store.append(makeEvent({ type: EventType.MISSION_CREATED, executionId: 'mis_001' }));
    await store.append(makeEvent({ type: EventType.MISSION_COMPLETED, executionId: 'mis_001' }));
    const stream = store.getStream();
    assert.strictEqual(stream.length, 2);
    assert.strictEqual(stream[0].type, EventType.MISSION_CREATED);
  });

  it('should index by executionId', async () => {
    await store.append(makeEvent({ executionId: 'mis_002' }));
    const events = store.getByExecutionId('mis_002');
    assert.strictEqual(events.length, 1);
  });

  it('should filter by time range', () => {
    const now = Date.now();
    const events = store.getByTimeRange(now - 60000, now + 60000);
    assert.ok(events.length > 0);
  });

  it('should persist and reload', async () => {
    await store.persist();
    const store2 = new EventStore({ dataDir: testDir });
    await store2.load();
    assert.ok(store2.getStream().length > 0);
  });

  after(async () => {
    await store.clear();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });
});

describe('EventProjection — State Derivation', () => {
  it('should project CREATED', () => {
    const proj = EventProjection.projectMission('mis_p', [makeEvent({ executionId: 'mis_p', timestamp: 1000 })]);
    assert.strictEqual(proj.currentState, 'CREATED');
  });

  it('should project COMPLETED from full chain', () => {
    const events = [
      makeEvent({ executionId: 'mis_c', type: EventType.MISSION_CREATED, timestamp: 1000 }),
      makeEvent({ executionId: 'mis_c', type: EventType.PLAN_CREATED, timestamp: 2000, payload: { steps: 3 } }),
      makeEvent({ executionId: 'mis_c', type: EventType.EXECUTION_STARTED, timestamp: 3000 }),
      makeEvent({ executionId: 'mis_c', type: EventType.NODE_COMPLETED, timestamp: 4000 }),
      makeEvent({ executionId: 'mis_c', type: EventType.NODE_COMPLETED, timestamp: 4001 }),
      makeEvent({ executionId: 'mis_c', type: EventType.NODE_COMPLETED, timestamp: 4002 }),
      makeEvent({ executionId: 'mis_c', type: EventType.MISSION_COMPLETED, timestamp: 5000 }),
    ];
    const proj = EventProjection.projectMission('mis_c', events);
    assert.strictEqual(proj.currentState, 'COMPLETED');
    assert.strictEqual(proj.completedSteps, 3);
  });

  it('should project WAIT_APPROVAL', () => {
    const events = [
      makeEvent({ executionId: 'mis_w', type: EventType.MISSION_CREATED, timestamp: 1000 }),
      makeEvent({ executionId: 'mis_w', type: EventType.APPROVAL_REQUIRED, timestamp: 2000 }),
    ];
    const proj = EventProjection.projectMission('mis_w', events);
    assert.strictEqual(proj.currentState, 'WAIT_APPROVAL');
    assert.strictEqual(proj.approvalStatus, 'pending');
  });

  it('should detect invalid transitions', () => {
    const events = [
      makeEvent({ executionId: 'mis_b', type: EventType.MISSION_CREATED, timestamp: 1000 }),
      makeEvent({ executionId: 'mis_b', type: EventType.MISSION_COMPLETED, timestamp: 2000 }),
    ];
    const result = EventProjection.validateStream(events);
    assert.strictEqual(result.valid, false);
    assert.ok(result.issues.length > 0);
  });

  it('should project system state', () => {
    const events = [
      makeEvent({ executionId: 'sys_1', type: EventType.MISSION_CREATED }),
      makeEvent({ executionId: 'sys_1', type: EventType.MISSION_COMPLETED }),
      makeEvent({ executionId: 'sys_2', type: EventType.MISSION_CREATED }),
    ];
    const sys = EventProjection.projectSystem(events);
    assert.strictEqual(sys.totalEvents, 3);
    assert.strictEqual(sys.completedMissions, 1);
  });
});

describe('EventRepository — Query', () => {
  let store: EventStore;
  let repo: EventRepository;
  const testDir = './data/test-repo-' + Date.now();

  before(async () => {
    store = new EventStore({ dataDir: testDir });
    await store.load();
    repo = new EventRepository(store);
    for (let i = 0; i < 3; i++) {
      await store.append(makeEvent({ executionId: 'mis_s' + i, type: EventType.MISSION_CREATED }));
    }
  });

  it('should query by executionId', () => {
    assert.strictEqual(repo.query({ executionId: 'mis_s0' }).length, 1);
  });

  it('should query by type', () => {
    assert.strictEqual(repo.query({ types: [EventType.MISSION_CREATED] }).length, 3);
  });

  it('should get timeline', () => {
    const tl = repo.getTimeline('mis_s0');
    assert.strictEqual(tl.length, 1);
  });

  it('should aggregate', () => {
    const agg = repo.aggregate();
    const m = agg.find(a => a.type === EventType.MISSION_CREATED);
    assert.ok(m);
    assert.strictEqual(m!.count, 3);
  });

  after(async () => {
    await store.clear();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });
});
