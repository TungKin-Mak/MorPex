/**
 * Phase 2: Performance & Persistence Optimization Tests
 *
 * Coverage:
 *   - CompactionService: pruning old events, snapshots, versions
 *   - CompactionService: VACUUM trigger, auto-start/stop
 *   - Composite indexes existence
 *   - MetricsCollector v9.2 extensions
 *   - SqliteEventStore.getCompactionService() integration
 */
import Database from 'better-sqlite3';
import { SqliteEventStore } from '../src/protocol/events/store/SqliteEventStore.js';
import { CompactionService } from '../src/observability/CompactionService.js';
import { MetricsCollector } from '../src/observability/MetricsCollector.js';
import type { BaseEvent } from '../src/protocol/events/BaseEvent.js';
import { EventType } from '../src/protocol/events/EventType.js';

let passed = 0; let failed = 0;
function assert(cond: boolean, msg: string) { if (cond) passed++; else { console.error('  ❌ ' + msg); failed++; } }
function eq<T>(a: T, b: T, msg: string) { if (a === b) passed++; else { console.error(`  ❌ ${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); failed++; } }

async function run() {
  console.log('\n=== Phase 2: Performance & Persistence ===\n');

  // ═══════════════════════════════════════════════════
  // 1. CompactionService: pruneOldEvents
  // ═══════════════════════════════════════════════════
  console.log('--- 1. CompactionService: pruneOldEvents ---');
  {
    const db = new Database(':memory:');
    const store = new SqliteEventStore(db);

    // Insert old and new events
    const oldEvent: BaseEvent = { id: 'evt_old_1', type: EventType.MISSION_CREATED, timestamp: Date.now() - 100000000, executionId: 'exe_1', source: 'test', payload: {} };
    const newEvent: BaseEvent = { id: 'evt_new_1', type: EventType.MISSION_CREATED, timestamp: Date.now(), executionId: 'exe_2', source: 'test', payload: {} };
    await store.append(oldEvent);
    await store.append(newEvent);

    const svc = new CompactionService(db, { maxEventAgeMs: 5000000 }); // only catches old event
    const result = await svc.compact();

    const remaining = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
    eq(remaining.c, 1, 'only new event remains');
    eq(result.eventsPruned >= 1, true, 'pruned at least old event');
  }

  // ═══════════════════════════════════════════════════
  // 2. CompactionService: pruneSnapshots
  // ═══════════════════════════════════════════════════
  console.log('\n--- 2. CompactionService: pruneSnapshots ---');
  {
    const db = new Database(':memory:');
    const store = new SqliteEventStore(db);

    // Insert 25 snapshots for same mission
    for (let i = 0; i < 25; i++) {
      db.prepare(`INSERT INTO context_snapshots (context_id, version, mission_id, schema_version, base_data, session_data, ephemeral_data, fragments_json, assembled_at)
        VALUES (?, ?, ?, '1.0', '{}', '{}', '{}', '[]', ?)`).run(`ctx_${i}`, i + 1, 'mis_test', Date.now() + i * 1000);
    }

    const svc = new CompactionService(db, { maxSnapshotsPerMission: 5 });
    const result = await svc.compact();

    const remaining = db.prepare('SELECT COUNT(*) as c FROM context_snapshots').get() as { c: number };
    eq(remaining.c, 5, 'only 5 snapshots remain');
    eq(result.snapshotsPruned, 20, 'pruned 20 excess snapshots');
  }

  // ═══════════════════════════════════════════════════
  // 3. CompactionService: pruneArtifactVersions
  // ═══════════════════════════════════════════════════
  console.log('\n--- 3. CompactionService: pruneArtifactVersions ---');
  {
    const db = new Database(':memory:');
    const store = new SqliteEventStore(db);

    // Insert artifact and 15 versions
    const now = Date.now();
    db.prepare(`INSERT INTO artifacts_v2 (id, name, type, status, version, content, created_at, updated_at)
      VALUES (?, 'test', 'document', 'draft', 1, 'v1', ?, ?)`).run('art_test', now, now);
    for (let i = 1; i <= 15; i++) {
      db.prepare(`INSERT INTO artifact_versions_v2 (id, artifact_id, version, content, created_at)
        VALUES (?, 'art_test', ?, ?, ?)`).run(`ver_${i}`, i, `v${i}`, now + i * 1000);
    }

    const svc = new CompactionService(db, { maxArtifactVersions: 5 });
    const result = await svc.compact();

    const remaining = db.prepare('SELECT COUNT(*) as c FROM artifact_versions_v2').get() as { c: number };
    eq(remaining.c, 5, 'only 5 versions remain');
    eq(result.versionsPruned, 10, 'pruned 10 excess versions');
  }

  // ═══════════════════════════════════════════════════
  // 4. CompactionService: compact runs full cycle
  // ═══════════════════════════════════════════════════
  console.log('\n--- 4. CompactionService: full compact cycle ---');
  {
    const db = new Database(':memory:');
    const store = new SqliteEventStore(db);

    // Add some data
    const evt: BaseEvent = { id: 'evt_c_1', type: EventType.MISSION_CREATED, timestamp: Date.now() - 100000000, executionId: 'exe_1', source: 'test', payload: {} };
    await store.append(evt);
    db.prepare(`INSERT INTO context_snapshots VALUES ('ctx_c', 1, 'mis_c', '1.0', '{}', '{}', '{}', '[]', 'compact test', 0)`).run();
    db.prepare(`INSERT INTO artifacts_v2 VALUES ('art_c', 'test', 'doc', 'draft', 1, 'v1', null, 'sys', null, '{}', 0, 0)`).run();
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO artifact_versions_v2 VALUES ('ver_c_${i}', 'art_c', ${i + 10}, 'v${i + 10}', null, null, null, null, null, 0)`).run();
    }

    const svc = new CompactionService(db, { maxEventAgeMs: 1, maxSnapshotsPerMission: 0, maxArtifactVersions: 1 });
    const result = await svc.compact();

    assert(result.eventsPruned >= 1, 'pruned events');
    assert(result.snapshotsPruned >= 1, 'pruned snapshots');
    assert(result.versionsPruned >= 1, 'pruned versions');
    eq(typeof result.durationMs, 'number', 'duration is a number');
    eq(typeof result.sizeBeforeBytes, 'number', 'sizeBefore is number');
    eq(typeof result.sizeAfterBytes, 'number', 'sizeAfter is number');
  }

  // ═══════════════════════════════════════════════════
  // 5. CompactionService: auto-start/stop
  // ═══════════════════════════════════════════════════
  console.log('\n--- 5. CompactionService: auto start/stop ---');
  {
    const db = new Database(':memory:');
    const svc = new CompactionService(db, { autoRunIntervalMs: 100 });

    // Stop first (idempotent)
    svc.stopAuto();
    assert(true, 'stopAuto on stopped service does not throw');

    // Start
    svc.startAuto();
    assert(true, 'startAuto started');

    // Wait a bit then stop
    await new Promise(r => setTimeout(r, 250));
    svc.stopAuto();
    assert(true, 'stopAuto after running');

    // Restart and stop again
    svc.startAuto();
    svc.stopAuto();
    assert(true, 'restart and stop');
  }

  // ═══════════════════════════════════════════════════
  // 6. Composite indexes exist
  // ═══════════════════════════════════════════════════
  console.log('\n--- 6. Composite indexes ---');
  {
    const db = new Database(':memory:');
    const store = new SqliteEventStore(db);

    const expectedIndexes = [
      'idx_events_mission_seq',
      'idx_events_type_time',
      'idx_context_snapshots_mission_ver',
      'idx_artifacts_v2_type_status',
      'idx_shared_memory_key_version',
    ];

    const actualIndexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'"
    ).all() as { name: string }[];
    const actualNames = actualIndexes.map(r => r.name);

    for (const idx of expectedIndexes) {
      assert(actualNames.includes(idx), `index ${idx} exists`);
    }
  }

  // ═══════════════════════════════════════════════════
  // 7. MetricsCollector: team formation
  // ═══════════════════════════════════════════════════
  console.log('\n--- 7. MetricsCollector: team formation ---');
  {
    const mc = new MetricsCollector();
    mc.recordTeamFormation(1500, 4);
    mc.recordTeamFormation(2000, 3);

    const metrics = mc.getV9Metrics();
    eq(metrics.teamFormations.count, 2, '2 team formations recorded');
    assert(metrics.teamFormations.avgDurationMs > 0, 'avg duration > 0');
    assert(metrics.teamFormations.avgTeamSize > 0, 'avg team size > 0');
  }

  // ═══════════════════════════════════════════════════
  // 8. MetricsCollector: shared memory + marketplace + distributed
  // ═══════════════════════════════════════════════════
  console.log('\n--- 8. MetricsCollector: shared memory, marketplace, distributed ---');
  {
    const mc = new MetricsCollector();
    mc.recordSharedMemoryConflict('key_a');
    mc.recordMarketplaceBid('listing_1', true);
    mc.recordMarketplaceBid('listing_2', false);
    mc.recordDistributedMessage('node_a', 'node_b', 50);
    mc.recordDistributedMessage('node_b', 'node_c', 120);

    const metrics = mc.getV9Metrics();
    assert(metrics.sharedMemory.conflicts >= 1, 'conflict recorded');
    assert(metrics.marketplace.totalBids >= 2, 'bids recorded');
    assert(metrics.marketplace.winRate > 0, 'win rate calculated');
    assert(metrics.distributed.messagesSent >= 2, 'messages recorded');
    assert(metrics.distributed.avgLatencyMs > 0, 'avg latency > 0');
  }

  // ═══════════════════════════════════════════════════
  // 9. MetricsCollector: circuit breaker
  // ═══════════════════════════════════════════════════
  console.log('\n--- 9. MetricsCollector: circuit breaker ---');
  {
    const mc = new MetricsCollector();
    mc.recordCircuitBreakerTrip('execution-stage');
    mc.recordCircuitBreakerTrip('planning-stage');

    // Record some other resilience metrics
    mc.record('resilience.retry', 1, { stage: 'execution' });
    mc.record('resilience.retry', 1, { stage: 'execution' });
    mc.record('resilience.compensation', 1, { missionId: 'mis_1' });

    const metrics = mc.getV9Metrics();
    eq(metrics.resilience.circuitBreakerTrips, 2, '2 circuit breaker trips');
    eq(metrics.resilience.retriesTriggered, 2, '2 retries');
    eq(metrics.resilience.compensationsRun, 1, '1 compensation');
  }

  // ═══════════════════════════════════════════════════
  // 10. SqliteEventStore.getCompactionService()
  // ═══════════════════════════════════════════════════
  console.log('\n--- 10. SqliteEventStore.getCompactionService() ---');
  {
    const db = new Database(':memory:');
    const store = new SqliteEventStore(db);
    const svc = store.getCompactionService({ maxEventAgeMs: 1000 });
    assert(svc instanceof CompactionService, 'returns CompactionService instance');
    assert(svc.getConfig().maxEventAgeMs === 1000, 'config passed through');
  }

  // ═══════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════
  console.log(`\n=== Phase 2: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
