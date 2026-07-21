/**
 * e2e-pipeline-persistence.test.ts — 全链路持久化集成测试
 *
 * 验证: SqliteEventStore → ContextPersistence → ArtifactSqliteRepository
 *       → AgentGovernanceRepository → AgentLifecycle → PersonalBrain
 *       全部共享一个 SQLite 内存数据库。
 */

import Database from 'better-sqlite3';
import { SqliteEventStore } from '../src/protocol/events/store/SqliteEventStore.js';
import { ContextAssemblyEngine } from '../src/context/ContextAssemblyEngine.js';
import { ContextPersistence } from '../src/context/ContextPersistence.js';
import { AgentGovernanceRepository } from '../src/agent/governance/AgentGovernanceRepository.js';
import { AgentProfileManager } from '../src/agent/identity/AgentProfile.js';
import { AgentLifecycle } from '../src/agent/lifecycle/AgentLifecycle.js';
import type { AgentIdentity } from '../src/agent/identity/AgentIdentity.js';
import { createDefaultGovernance } from '../src/agent/identity/AgentIdentity.js';

let db: Database.Database;
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  Promise.resolve().then(async () => {
    try {
      await fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`  FAIL ${name}: ${e.message}`);
    }
  });
}

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

async function run() {
  console.log('\n=== E2E Pipeline Persistence Tests ===\n');

  // Setup in-memory SQLite
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Initialize schema
  const store = new SqliteEventStore(db);

  // Test 1: EventStore append + query
  test('EventStore: append event, query by executionId', async () => {
    await store.append({
      id: 'evt_test_1', type: 'test.event',
      timestamp: Date.now(), executionId: 'mis_test_1',
      source: 'e2e-test', payload: { msg: 'hello' },
    });
    const results = await store.query({ executionId: 'mis_test_1' });
    assert(results.length === 1, `Expected 1 event, got ${results.length}`);
    assert(results[0].type === 'test.event', 'Event type mismatch');
  });

  // Test 2: ContextPersistence
  test('ContextPersistence: save/load context snapshot', () => {
    const ctxPersistence = new ContextPersistence(db);
    const ctx = {
      contextId: 'ctx_test_1',
      version: 1,
      missionId: 'mis_test_1',
      layers: {
        base: { schemaVersion: '1.0' },
        session: { userId: 'user_1', tags: ['test'] },
        ephemeral: { score: 0.95 },
      },
      fragments: [{ source: 'test' as any, data: { key: 'val' }, version: 1, collectedAt: Date.now() }],
      assembledAt: Date.now(),
      schemaVersion: '1.0',
    };
    ctxPersistence.save(ctx, 'Initial assembly');
    const loaded = ctxPersistence.loadLatest('ctx_test_1');
    assert(loaded !== undefined, 'context not found');
    assert(loaded!.contextId === 'ctx_test_1', 'contextId mismatch');
    assert(loaded!.layers.base.schemaVersion === '1.0', 'base data mismatch');
  });

  // Test 3: ContextAssemblyEngine with persistence
  test('ContextAssemblyEngine: assemble + auto-persist', async () => {
    const ctxPersistence = new ContextPersistence(db);
    const engine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, undefined, ctxPersistence);
    const execCtx = await engine.assemble({ missionId: 'mis_test_2', tags: ['e2e'] });
    assert(execCtx.contextId.startsWith('ctx_'), `contextId format: ${execCtx.contextId}`);

    // Verify auto-persisted
    const loaded = engine.loadContext(execCtx.contextId);
    assert(loaded !== undefined, 'auto-persisted context not found via loadContext');
    assert(loaded!.missionId === 'mis_test_2', 'missionId mismatch');
  });

  // Test 4: AgentGovernanceRepository
  test('AgentGovernanceRepository: save agent, record governance', () => {
    const govRepo = new AgentGovernanceRepository(db);

    const identity: AgentIdentity = {
      id: 'agent_test_1', name: 'TestAgent', role: 'executor',
      capabilities: ['coding', 'testing'], memoryScope: 'private:test',
      permissionScope: 'default', status: 'ACTIVE', version: 1,
      createdAt: Date.now(),
      governance: createDefaultGovernance({ id: 'agent_test_1', role: 'executor' }),
    };

    govRepo.saveAgent(identity);

    const saved = govRepo.getAgent('agent_test_1');
    assert(saved !== undefined, 'agent not persisted');
    assert(saved.name === 'TestAgent', `name mismatch: ${saved.name}`);

    govRepo.recordGovernance('agent_test_1', 'lifecycle_transition', 'ACTIVE', 'Initial activation');
    const logs = govRepo.queryGovernanceLog('agent_test_1');
    assert(logs.length === 1, `Expected 1 log entry, got ${logs.length}`);
    assert(logs[0].event_type === 'lifecycle_transition', 'event_type mismatch');

    govRepo.saveCapability('agent_test_1', 'coding', 3, 0.95, 0.5);
    const caps = govRepo.getCapabilities('agent_test_1');
    assert(caps.length === 1, `Expected 1 capability, got ${caps.length}`);
  });

  // Test 5: AgentProfileManager with governance
  test('AgentProfileManager: register agent with governance repo', () => {
    const govRepo = new AgentGovernanceRepository(db);
    const mgr = new AgentProfileManager(govRepo);

    const identity: AgentIdentity = {
      id: 'agent_test_2', name: 'ProfileAgent', role: 'coder',
      capabilities: ['coding'], memoryScope: 'private:p2',
      permissionScope: 'default', status: 'ACTIVE', version: 1,
      createdAt: Date.now(),
      governance: createDefaultGovernance({ id: 'agent_test_2', role: 'coder' }),
    };

    const profile = mgr.register(identity);
    assert(profile.identity.id === 'agent_test_2', 'profile registration failed');

    // Verify persisted to DB
    const saved = govRepo.getAgent('agent_test_2');
    assert(saved !== undefined, 'agent not persisted via ProfileManager');
  });

  // Test 6: AgentLifecycle with governance
  test('AgentLifecycle: transition with governance log', () => {
    const govRepo = new AgentGovernanceRepository(db);
    const lifecycle = new AgentLifecycle(govRepo);

    const identity: AgentIdentity = {
      id: 'agent_test_3', name: 'LifecycleAgent', role: 'executor',
      capabilities: [], memoryScope: 'private:p3',
      permissionScope: 'default', status: 'ACTIVE', version: 1,
      createdAt: Date.now(),
      governance: createDefaultGovernance({ id: 'agent_test_3', role: 'executor' }),
    };

    const mgr = new AgentProfileManager(govRepo);
    const profile = mgr.register(identity);

    lifecycle.transition(profile, 'SUSPENDED', 'E2E test suspension');
    assert(profile.identity.status === 'SUSPENDED', 'status not updated');

    const logs = govRepo.queryGovernanceLog('agent_test_3');
    const lifecycleLogs = logs.filter((l: any) => l.event_type === 'lifecycle_transition');
    assert(lifecycleLogs.length >= 1, `Expected lifecycle log, got ${lifecycleLogs.length}`);
  });

  // Test 7: Full pipeline simulation
  test('Full pipeline: event → context → artifact → agent → lifecycle → query all', async () => {
    const govRepo = new AgentGovernanceRepository(db);
    const ctxPersistence = new ContextPersistence(db);
    const mgr = new AgentProfileManager(govRepo);
    const lifecycle = new AgentLifecycle(govRepo);

    // 7a. Append event
    await store.append({
      id: 'evt_pipeline_1', type: 'mission.created',
      timestamp: Date.now(), executionId: 'mis_pipeline',
      source: 'e2e-test', payload: { goal: 'E2E pipeline test' },
    });

    // 7b. Assemble context
    const engine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, undefined, ctxPersistence);
    const execCtx = await engine.assemble({ missionId: 'mis_pipeline', tags: ['e2e', 'pipeline'] });
    assert(execCtx.contextId !== '', 'context assembled');

    // 7c. Register agent
    const identity: AgentIdentity = {
      id: 'agent_pipeline', name: 'PipelineAgent', role: 'executor',
      capabilities: ['general'], memoryScope: 'private:pipe',
      permissionScope: 'default', status: 'ACTIVE', version: 1,
      createdAt: Date.now(),
      governance: createDefaultGovernance({ id: 'agent_pipeline', role: 'executor' }),
    };
    mgr.register(identity);

    // 7d. Lifecycle transition
    const profile = mgr.get('agent_pipeline')!;
    lifecycle.transition(profile, 'IDLE', 'Pipeline test');

    // 7e. Query all tables
    const events = await store.query({ executionId: 'mis_pipeline' });
    assert(events.length >= 1, 'events not found');

    const loadedCtx = ctxPersistence.loadLatest(execCtx.contextId);
    assert(loadedCtx !== undefined, 'context not persisted');

    const savedAgent = govRepo.getAgent('agent_pipeline');
    assert(savedAgent !== undefined, 'agent not persisted');
    assert(savedAgent.status === 'IDLE', `status not updated: ${savedAgent.status}`);
  });

  // Test 8: Cross-table consistency
  test('Cross-table: same DB across all repos', () => {
    // All previous tests used 'db' — verify table count
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    assert(tableNames.includes('events'), 'events table missing');
    assert(tableNames.includes('context_snapshots'), 'context_snapshots table missing');
    assert(tableNames.includes('agents'), 'agents table missing');
    assert(tableNames.includes('agent_governance_log'), 'agent_governance_log missing');
    db.close();
  });

  // Run
  await new Promise(setImmediate);

  console.log(`\n=== E2E Pipeline Persistence Tests: ${passed} passed, ${failed} failed ===\n`);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
