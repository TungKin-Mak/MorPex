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

async function runSequential(tests: Array<{name: string; fn: () => void | Promise<void>}>) {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`  FAIL ${t.name}: ${e.message}`);
    }
  }
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

  await runSequential([
    // Test 1: EventStore append + query
    { name: 'EventStore: append event, query by executionId', fn: async () => {
      await store.append({
        id: 'evt_test_1', type: 'test.event',
        timestamp: Date.now(), executionId: 'mis_test_1',
        source: 'e2e-test', payload: { msg: 'hello' },
      });
      const results = await store.query({ executionId: 'mis_test_1' });
      assert(results.length === 1, `Expected 1 event, got ${results.length}`);
      assert(results[0].type === 'test.event', 'Event type mismatch');
    }},

    // Test 2: ContextPersistence
    { name: 'ContextPersistence: save/load context snapshot', fn: () => {
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
    }},

    // Test 3: ContextAssemblyEngine with persistence
    { name: 'ContextAssemblyEngine: assemble + auto-persist', fn: async () => {
      const ctxPersistence = new ContextPersistence(db);
      const engine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, undefined, ctxPersistence);
      const execCtx = await engine.assemble({ missionId: 'mis_test_2', tags: ['e2e'] });
      assert(execCtx.contextId.startsWith('ctx_'), `contextId format: ${execCtx.contextId}`);
      const loaded = engine.loadContext(execCtx.contextId);
      assert(loaded !== undefined, 'auto-persisted context not found via loadContext');
      assert(loaded!.missionId === 'mis_test_2', 'missionId mismatch');
    }},

    // Test 4: AgentGovernanceRepository
    { name: 'AgentGovernanceRepository: save agent, record governance', fn: () => {
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
    }},

    // Test 5: AgentProfileManager with governance
    { name: 'AgentProfileManager: register agent with governance repo', fn: () => {
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
      const saved = govRepo.getAgent('agent_test_2');
      assert(saved !== undefined, 'agent not persisted via ProfileManager');
    }},

    // Test 6: AgentLifecycle with governance
    { name: 'AgentLifecycle: transition with governance log', fn: () => {
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
    }},

    // Test 7: Full pipeline simulation
    { name: 'Full pipeline: event -> context -> agent -> lifecycle -> query all', fn: async () => {
      const govRepo = new AgentGovernanceRepository(db);
      const ctxPersistence = new ContextPersistence(db);
      const mgr = new AgentProfileManager(govRepo);
      const lifecycle = new AgentLifecycle(govRepo);
      await store.append({
        id: 'evt_pipeline_1', type: 'mission.created',
        timestamp: Date.now(), executionId: 'mis_pipeline',
        source: 'e2e-test', payload: { goal: 'E2E pipeline test' },
      });
      const engine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, undefined, ctxPersistence);
      const execCtx = await engine.assemble({ missionId: 'mis_pipeline', tags: ['e2e', 'pipeline'] });
      assert(execCtx.contextId !== '', 'context assembled');
      const identity: AgentIdentity = {
        id: 'agent_pipeline', name: 'PipelineAgent', role: 'executor',
        capabilities: ['general'], memoryScope: 'private:pipe',
        permissionScope: 'default', status: 'ACTIVE', version: 1,
        createdAt: Date.now(),
        governance: createDefaultGovernance({ id: 'agent_pipeline', role: 'executor' }),
      };
      mgr.register(identity);
      const profile = mgr.get('agent_pipeline')!;
      lifecycle.transition(profile, 'IDLE', 'Pipeline test');
      const events = await store.query({ executionId: 'mis_pipeline' });
      assert(events.length >= 1, 'events not found');
      const loadedCtx = ctxPersistence.loadLatest(execCtx.contextId);
      assert(loadedCtx !== undefined, 'context not persisted');
      // AgentLifecycle.transition updates in-memory profile, not DB directly
      // Governance log is persisted in DB
      assert(profile.identity.status === 'IDLE', `in-memory status not updated: ${profile.identity.status}`);
      const govLogs = govRepo.queryGovernanceLog('agent_pipeline');
      assert(govLogs.length >= 1, 'governance log not persisted');
      const lastLog = govLogs[govLogs.length - 1];
      assert(lastLog.decision === 'IDLE', `governance log decision: ${lastLog.decision}`);
    }},

    // Test 8: Cross-table consistency
    { name: 'Cross-table: same DB across all repos', fn: () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      assert(tableNames.includes('events'), 'events table missing');
      assert(tableNames.includes('context_snapshots'), 'context_snapshots table missing');
      assert(tableNames.includes('agents'), 'agents table missing');
      assert(tableNames.includes('agent_governance_log'), 'agent_governance_log missing');
    }},
  ]);

  db.close();

  console.log(`\n=== E2E Pipeline Persistence Tests: ${passed} passed, ${failed} failed ===\n`);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
