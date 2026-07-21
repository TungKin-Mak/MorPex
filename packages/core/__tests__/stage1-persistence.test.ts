/**
 * Stage 1 Persistence Tests — 上下文 & 产物持久化
 *
 * 覆盖:
 *   - ContextPersistence (save/load/prune/history)
 *   - ArtifactSqliteRepository (CRUD/versions/dependencies/staging)
 *   - ArtifactManager + SQLite 集成
 *   - ContextVersioner + ContextPersistence 集成
 */

// @ts-ignore - better-sqlite3 is CJS native module
import Database from 'better-sqlite3';
import { SqliteEventStore, createSqliteEventStore } from '../src/protocol/events/store/SqliteEventStore.js';
import { ContextPersistence } from '../src/context/ContextPersistence.js';
import type { ExecutionContext } from '../src/context/ContextBuilder.js';
import { ContextVersioner } from '../src/context/ContextVersioner.js';
import { ArtifactSqliteRepository } from '../src/planes/artifact-plane/ArtifactSqliteRepository.js';
import { ArtifactManager } from '../src/planes/artifact-plane/ArtifactManager.js';
import type { ArtifactRecord } from '../src/planes/artifact-plane/types.js';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  (async () => {
    try {
      await fn();
      passed++;
    } catch (e: any) {
      failed++;
      errors.push(`  FAIL ${name}: ${e.message}`);
      console.error(`  FAIL ${name}: ${e.message}`);
    }
  })();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * createTestDb — 创建测试数据库并初始化 schema
 * 使用 SqliteEventStore 初始化所有表，然后通过 getDatabase() 获取连接
 */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  // 直接运行 SqliteEventStore 的 schema SQL
  // 我们需要提取 SCHEMA_SQL 常量 — 由于它不导出，我们通过创建 SqliteEventStore 实例来触发初始化
  const store = new SqliteEventStore(db);
  return db;
}

function createMockContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    contextId: overrides?.contextId ?? 'ctx_test_1',
    version: overrides?.version ?? 1,
    missionId: overrides?.missionId ?? 'mis_test_1',
    schemaVersion: '1.0',
    layers: {
      base: { userId: 'user_1', schemaVersion: '1.0' },
      session: { missionId: 'mis_test_1', tags: ['test'] },
      ephemeral: { riskScore: 0.5, recommendations: ['test-reco'] },
    },
    fragments: [
      { source: 'user_profile' as any, data: { name: 'Test' }, version: 1, collectedAt: Date.now() },
    ],
    assembledAt: Date.now(),
    ...overrides,
  };
}

// ── 测试开始 ──
console.log('\n=== Stage 1 Persistence Tests ===\n');

// === 1. ContextPersistence: save/loadLatest/loadVersion/history ===

test('ContextPersistence: save and loadLatest', () => {
  const db = createTestDb();
  const ctxP = new ContextPersistence(db);
  const ctx = createMockContext({ contextId: 'ctx_saveload', version: 1 });

  ctxP.save(ctx);
  const loaded = ctxP.loadLatest('ctx_saveload');

  assert(loaded !== undefined, 'loadLatest should return context');
  assertEqual(loaded!.contextId, 'ctx_saveload', 'contextId');
  assertEqual(loaded!.version, 1, 'version');
  assertEqual(loaded!.missionId, 'mis_test_1', 'missionId');
  assertEqual(loaded!.layers.base.userId as string, 'user_1', 'layers.base.userId');
  assertEqual(loaded!.layers.session.missionId as string, 'mis_test_1', 'layers.session.missionId');
  assertEqual(loaded!.fragments.length, 1, 'fragments count');
  db.close();
});

test('ContextPersistence: loadVersion and history', () => {
  const db = createTestDb();
  const ctxP = new ContextPersistence(db);

  ctxP.save(createMockContext({ contextId: 'ctx_history', version: 1 }));
  ctxP.save(createMockContext({ contextId: 'ctx_history', version: 2 }));

  const v1 = ctxP.loadVersion('ctx_history', 1);
  assert(v1 !== undefined, 'loadVersion v1');
  assertEqual(v1!.version, 1, 'v1 version');

  const v2 = ctxP.loadVersion('ctx_history', 2);
  assert(v2 !== undefined, 'loadVersion v2');
  assertEqual(v2!.version, 2, 'v2 version');

  const history = ctxP.getHistory('ctx_history');
  assertEqual(history.length, 2, 'history count');
  assertEqual(history[0].version, 1, 'history[0] version');
  assertEqual(history[1].version, 2, 'history[1] version');

  db.close();
});

test('ContextPersistence: loadByMission', () => {
  const db = createTestDb();
  const ctxP = new ContextPersistence(db);

  ctxP.save(createMockContext({ contextId: 'c1', missionId: 'mis_a', version: 1 }));
  ctxP.save(createMockContext({ contextId: 'c2', missionId: 'mis_a', version: 1 }));
  ctxP.save(createMockContext({ contextId: 'c3', missionId: 'mis_b', version: 1 }));

  const forA = ctxP.loadByMission('mis_a');
  assertEqual(forA.length, 2, 'mission A count');

  const forB = ctxP.loadByMission('mis_b');
  assertEqual(forB.length, 1, 'mission B count');

  db.close();
});

test('ContextPersistence: prune', () => {
  const db = createTestDb();
  const ctxP = new ContextPersistence(db);

  for (let v = 1; v <= 10; v++) {
    ctxP.save(createMockContext({ contextId: 'ctx_prune', version: v }));
  }

  const before = ctxP.loadByMission('mis_test_1');
  assertEqual(before.length, 10, 'before prune: 10 versions');

  const deleted = ctxP.prune(3); // keep latest 3
  assert(deleted >= 7, `prune should delete at least 7, got ${deleted}`);

  const history = ctxP.getHistory('ctx_prune');
  assert(history.length <= 3, `after prune: at most 3 versions, got ${history.length}`);

  db.close();
});

// === 2. ArtifactSqliteRepository: CRUD ===

test('ArtifactSqliteRepository: save, get, query, delete', () => {
  const db = createTestDb();
  const repo = new ArtifactSqliteRepository(db);

  const record: ArtifactRecord = {
    id: 'art_test_1',
    meta: { name: 'test-doc', type: 'document', description: 'A test document' },
    status: 'draft',
    version: 1,
    content: 'Hello World',
    checksum: 'abc123',
    size: 11,
    createdBy: 'user_1',
    source: 'manual',
    dependencies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  repo.save(record);
  const retrieved = repo.get('art_test_1');
  assert(retrieved !== undefined, 'get should return record');
  assertEqual(retrieved!.id, 'art_test_1', 'id');
  assertEqual(retrieved!.meta.name, 'test-doc', 'name');
  assertEqual(retrieved!.meta.type, 'document', 'type');
  assertEqual(retrieved!.status, 'draft', 'status');
  assertEqual(retrieved!.content as string, 'Hello World', 'content');

  // query by type
  const docs = repo.query({ type: 'document' });
  assertEqual(docs.length, 1, 'query by type: count');

  // query by name (LIKE)
  const named = repo.query({ name: 'test' });
  assertEqual(named.length, 1, 'query by name: count');

  // delete
  assert(repo.delete('art_test_1'), 'delete should succeed');
  assert(repo.get('art_test_1') === undefined, 'deleted record gone');

  db.close();
});

test('ArtifactSqliteRepository: versions', () => {
  const db = createTestDb();
  const repo = new ArtifactSqliteRepository(db);

  const record: ArtifactRecord = {
    id: 'art_ver_test',
    meta: { name: 'version-test', type: 'code' },
    status: 'committed',
    version: 1,
    content: 'v1 content',
    checksum: 'c1',
    size: 9,
    createdBy: 'test',
    source: 'test',
    dependencies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  repo.save(record);
  repo.saveVersion('ver1', 'art_ver_test', 1, 'v1 content', 'Initial', 'test', undefined, Date.now());

  const v1 = repo.getVersion('art_ver_test', 1);
  assert(v1 !== undefined, 'getVersion should return version');
  assertEqual(v1!.version, 1, 'version number');

  const versions = repo.getVersions('art_ver_test');
  assertEqual(versions.length, 1, 'version list count');

  db.close();
});

test('ArtifactSqliteRepository: dependencies and staging', () => {
  const db = createTestDb();
  const repo = new ArtifactSqliteRepository(db);

  // Setup artifacts
  const depA: ArtifactRecord = { id: 'art_dep_a', meta: { name: 'dep-a', type: 'document' }, status: 'draft', version: 1, content: 'a', checksum: 'a', size: 1, createdBy: 't', source: 't', dependencies: [], createdAt: Date.now(), updatedAt: Date.now() };
  const depB: ArtifactRecord = { id: 'art_dep_b', meta: { name: 'dep-b', type: 'document' }, status: 'draft', version: 1, content: 'b', checksum: 'b', size: 1, createdBy: 't', source: 't', dependencies: [], createdAt: Date.now(), updatedAt: Date.now() };
  repo.save(depA);
  repo.save(depB);

  // Add dependency
  repo.addDependency('art_dep_a', 'art_dep_b');
  const deps = repo.getDependencies('art_dep_a');
  assertEqual(deps.length, 1, 'dependency count');
  assertEqual(deps[0].toId, 'art_dep_b', 'dependency target');

  // Staging
  repo.createStage('stage_1', 'art_dep_a', 'new content v2', 'user_1');
  const stage = repo.getStage('stage_1');
  assert(stage !== undefined, 'stage should exist');
  assertEqual(stage!.status, 'staged', 'stage status');
  assertEqual(stage!.newContent as string, 'new content v2', 'stage content');

  repo.updateStageStatus('stage_1', 'verified');
  const updated = repo.getStage('stage_1');
  assertEqual(updated!.status, 'verified', 'stage status updated');

  repo.removeStage('stage_1');
  assert(repo.getStage('stage_1') === undefined, 'stage removed');

  db.close();
});

// === 3. ContextVersioner + ContextPersistence 集成 ===

test('ContextVersioner: auto-persist with ContextPersistence', () => {
  const db = createTestDb();
  const ctxP = new ContextPersistence(db);
  const versioner = new ContextVersioner(ctxP);

  const ctx = createMockContext({ contextId: 'ctx_vp_integration', version: 1 });
  versioner.snapshot(ctx, 'First version');

  // Version 2
  const ctx2 = createMockContext({ contextId: 'ctx_vp_integration', version: 2, missionId: 'mis_v2' });
  versioner.snapshot(ctx2, 'Second version');

  // Verify in-memory
  const inMemHistory = versioner.getHistory('ctx_vp_integration');
  assertEqual(inMemHistory.length, 2, 'in-memory history count');

  // Verify persisted
  const persisted = ctxP.loadLatest('ctx_vp_integration');
  assert(persisted !== undefined, 'persisted in DB');
  assertEqual(persisted!.version, 2, 'persisted version');
  assertEqual(persisted!.missionId, 'mis_v2', 'persisted missionId');

  // loadFromDb (clear memory first)
  versioner.clear();
  const loaded = versioner.loadFromDb('ctx_vp_integration');
  assert(loaded !== undefined, 'loadFromDb should return context');
  assertEqual(loaded!.version, 2, 'loadFromDb version');

  db.close();
});

// === 4. ArtifactManager + SQLite 集成 ===

test('ArtifactManager: with ArtifactSqliteRepository', () => {
  const db = createTestDb();
  const sqliteRepo = new ArtifactSqliteRepository(db);
  const manager = new ArtifactManager(undefined, undefined, undefined, undefined, undefined, undefined, undefined, sqliteRepo);

  const record = manager.create({
    meta: { name: 'sqlite-integration-test', type: 'document' },
    content: 'SQLite integration content',
    createdBy: 'test_user',
    source: 'test',
  });

  assert(record.id.startsWith('art_'), 'generated id');
  assertEqual(record.meta.name, 'sqlite-integration-test', 'name in record');

  // Verify persisted in SQLite
  const persisted = sqliteRepo.get(record.id);
  assert(persisted !== undefined, 'persisted in SQLite');
  assertEqual(persisted!.content as string, 'SQLite integration content', 'content in SQLite');
  assertEqual(persisted!.status, 'draft', 'status in SQLite');

  // Archive — should also persist
  const archived = manager.archive(record.id, 'admin');
  assert(archived !== undefined, 'archive should succeed');
  const archivedInDb = sqliteRepo.get(record.id);
  assertEqual(archivedInDb!.status, 'archived', 'archived in SQLite');

  db.close();
});

// === 5. Integration: Full flow ===

test('Integration: Context + Artifact in same DB', () => {
  const db = createTestDb();
  const ctxP = new ContextPersistence(db);
  const repo = new ArtifactSqliteRepository(db);

  // Save context
  ctxP.save(createMockContext({ contextId: 'int_ctx', version: 1 }));
  const loadedCtx = ctxP.loadLatest('int_ctx');
  assert(loadedCtx !== undefined, 'context saved');

  // Save artifact
  const art: ArtifactRecord = {
    id: 'int_art',
    meta: { name: 'integration-artifact', type: 'report' },
    status: 'committed',
    version: 1,
    content: { report: 'integration report data' },
    checksum: 'int_check',
    size: 100,
    createdBy: 'system',
    source: 'test',
    dependencies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  repo.save(art);
  const loadedArt = repo.get('int_art');
  assert(loadedArt !== undefined, 'artifact saved');
  assertEqual(loadedArt!.meta.name, 'integration-artifact', 'artifact name');

  // Cross-query
  console.log('  [Integration] Context:', loadedCtx.contextId, 'v' + loadedCtx.version);
  console.log('  [Integration] Artifact:', loadedArt.meta.name, loadedArt.status);

  // Stats
  const dbStats = db.prepare("SELECT type, COUNT(*) as cnt FROM artifacts_v2 GROUP BY type").all() as any[];
  assertEqual(dbStats.length, 1, 'one artifact type in DB');
  assertEqual(dbStats[0].type, 'report', 'artifact type');

  db.close();
});

// ── 测试结束 ──
(async () => {
  // Wait for all async tests to complete
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log(`\n=== Stage 1 Persistence Tests: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
})();
