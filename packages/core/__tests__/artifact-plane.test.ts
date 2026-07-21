/**
 * Artifact Plane Integration Tests — v9.1
 *
 * 覆盖: ArtifactPlane CRUD → 两阶段提交 → 版本管理 → 血缘追踪 → 事件
 *
 * 使用自执行模式，兼容 Node.js --test 运行。
 */
import { ArtifactPlane } from '../src/planes/artifact-plane/ArtifactPlane.js';

let passed = 0; let failed = 0;
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

async function run() {
  console.log('\n=== Artifact Plane Tests ===\n');

  // ── 1. Creation ──
  try {
    const plane = new ArtifactPlane();
    const art = plane.create({
      meta: { name: 'test-report', type: 'report', description: 'A test report' },
      content: { data: 'hello' },
      createdBy: 'alice',
      source: 'test',
    });
    assert(art.id.startsWith('art_'), `id format: ${art.id}`);
    assert(art.meta.name === 'test-report', 'name');
    assert(art.meta.type === 'report', 'type');
    assert(art.status === 'draft', 'initial status draft');
    assert(art.version === 1, 'version === 1');
    assert(art.createdBy === 'alice', 'createdBy');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: create: ${e.message}`); }

  try {
    const plane = new ArtifactPlane();
    const art1 = plane.create({ meta: { name: 'base', type: 'config' }, content: 'base', createdBy: 'alice' });
    const art2 = plane.create({ meta: { name: 'derived', type: 'report' }, content: 'derived', createdBy: 'alice', dependencies: [art1.id] });
    assert(art2.dependencies.length === 1, 'has 1 dependency');
    assert(art2.dependencies[0] === art1.id, 'dependency id matches');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: create with dependencies: ${e.message}`); }

  try {
    const plane = new ArtifactPlane();
    let threw = false;
    try {
      plane.create({ meta: { name: '', type: 'report' }, content: 'x', createdBy: '' });
    } catch { threw = true; }
    assert(threw, 'throws on validation failure');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: validation: ${e.message}`); }

  // ── 2. Query ──
  try {
    const plane = new ArtifactPlane();
    plane.create({ meta: { name: 'doc1', type: 'document' }, content: 'a', createdBy: 'alice' });
    plane.create({ meta: { name: 'doc2', type: 'document' }, content: 'b', createdBy: 'bob' });
    plane.create({ meta: { name: 'cfg1', type: 'config' }, content: 'c', createdBy: 'alice' });
    const docs = plane.query({ type: 'document' });
    assert(docs.length === 2, '2 documents');
    const aliceDocs = plane.query({ createdBy: 'alice' });
    assert(aliceDocs.length === 2, '2 docs by alice');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: query: ${e.message}`); }

  // ── 3. Two-Phase Commit ──
  try {
    const plane = new ArtifactPlane();
    const art = plane.create({ meta: { name: 'updatable', type: 'config' }, content: 'v1', createdBy: 'alice' });
    const stageId = plane.stage(art.id, 'v2 content', 'alice');
    assert(stageId.startsWith('stage_'), `stageId format: ${stageId}`);
    const result = await plane.verify(stageId);
    assert(result.passed === true, 'verification passed');
    assert(result.checksumMatch === true, 'checksum match');
    const updated = plane.commit(stageId, 'Updated to v2');
    assert(updated.version === 2, 'version incremented to 2');
    assert(updated.content === 'v2 content', 'content updated');
    assert(updated.status === 'committed', 'status committed');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: stage→verify→commit: ${e.message}`); }

  try {
    const plane = new ArtifactPlane();
    const art = plane.create({ meta: { name: 'rollback-test', type: 'code' }, content: 'original', createdBy: 'alice' });
    const stageId = plane.stage(art.id, 'bad content', 'alice');
    plane.rollback(stageId);
    const original = plane.get(art.id)!;
    assert(original.content === 'original', 'content unchanged after rollback');
    assert(original.version === 1, 'version unchanged after rollback');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: rollback: ${e.message}`); }

  // ── 4. Version Management ──
  try {
    const plane = new ArtifactPlane();
    const art = plane.create({ meta: { name: 'versioned', type: 'document' }, content: 'v1', createdBy: 'alice' });
    for (let v = 2; v <= 4; v++) {
      const stageId = plane.stage(art.id, `v${v} content`, 'alice');
      await plane.verify(stageId);
      plane.commit(stageId, `Version ${v}`);
    }
    const history = plane.getHistory(art.id);
    assert(history.length === 4, '4 versions total');
    const v2 = plane.getVersion(art.id, 2);
    assert(v2 !== undefined, 'version 2 exists');
    assert(v2!.record.content === 'v2 content', 'v2 content correct');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: version history: ${e.message}`); }

  // ── 5. Lineage Tracking ──
  try {
    const plane = new ArtifactPlane();
    const a = plane.create({ meta: { name: 'source', type: 'code' }, content: 'src', createdBy: 'alice' });
    const b = plane.create({ meta: { name: 'derived1', type: 'report' }, content: 'd1', createdBy: 'alice' });
    const c = plane.create({ meta: { name: 'derived2', type: 'report' }, content: 'd2', createdBy: 'alice' });
    // b derives from a, c derives from a
    plane.addRelation(b.id, a.id, 'derives_from');
    plane.addRelation(c.id, a.id, 'derives_from');
    const lca = plane.findLCA(b.id, c.id);
    assert(lca !== undefined, 'LCA found');
    assert(lca!.id === a.id, 'LCA is source');
    const siblings = plane.areSiblings(b.id, c.id);
    assert(siblings === true, 'b and c are siblings');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: lineage: ${e.message}`); }

  // ── 6. Events ──
  try {
    const plane = new ArtifactPlane();
    const events: string[] = [];
    const unsubCreate = plane.on('artifact.created', (e) => events.push(`created:${e.artifactId}`));
    const unsubCommit = plane.on('artifact.committed', (e) => events.push(`committed:${e.artifactId}`));
    const art = plane.create({ meta: { name: 'event-test', type: 'document' }, content: 'v1', createdBy: 'alice' });
    assert(events.length >= 1, 'created event fired');
    const stageId = plane.stage(art.id, 'v2', 'alice');
    await plane.verify(stageId);
    plane.commit(stageId, 'v2');
    assert(events.length >= 2, 'commit event also fired');
    unsubCreate();
    unsubCommit();
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: events: ${e.message}`); }

  // ── 7. Archive / Deprecate ──
  try {
    const plane = new ArtifactPlane();
    const art = plane.create({ meta: { name: 'to-archive', type: 'config' }, content: 'x', createdBy: 'alice' });
    const archived = plane.archive(art.id, 'admin');
    assert(archived!.status === 'archived', 'status archived');
    const deprecated = plane.deprecate(art.id, 'admin');
    assert(deprecated!.status === 'deprecated', 'status deprecated');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ArtifactPlane: archive/deprecate: ${e.message}`); }

  // ── Report ──
  console.log(`\n=== Artifact Plane Tests: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run();
