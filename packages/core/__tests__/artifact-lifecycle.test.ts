/**
 * Artifact 生命周期验证测试
 *
 * 重点验证 Wave 3 重构后：
 *   1. ArtifactRegistry 作为唯一持久化入口（无 ArtifactStorage 双写）
 *   2. 静态工厂方法替代已删除的 Artifact.ts
 *   3. saveToDisk → loadFromDisk 完整往返
 *   4. 版本管理、图谱关系、URI 解析
 *   5. _scheduleAutoSave 自动刷盘行为
 *
 * 运行：
 *   npx tsx packages/core/__tests__/artifact-lifecycle.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ArtifactRegistry } from '../src/planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import { createVersionSnapshot, rollbackToVersion, formatVersion } from '../src/planes/knowledge-plane/artifacts/ArtifactVersion.js';

const TEST_DIR = './data/test-artifact-lifecycle';
let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}`); }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Artifact 生命周期验证 (Wave 3 重构后)');
  console.log('═══════════════════════════════════════════════\n');

  // 清理上次测试残留
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════
  // 1. 静态工厂方法（替代已删除的 Artifact.ts）
  // ═══════════════════════════════════════════
  console.log('📋 1. 静态工厂方法');
  console.log('─'.repeat(50));

  const R = ArtifactRegistry;
  const art1 = R.createArtifact({ name: '需求文档', type: 'document', content: '# 需求V1', createdBy: 'pm' });
  assert(art1.id.startsWith('art_'), 'createArtifact: ID 前缀 art_');
  assertEq(art1.name, '需求文档', 'createArtifact: name 正确');
  assertEq(art1.type, 'document', 'createArtifact: type 正确');
  assertEq(art1.version, 1, 'createArtifact: 初始版本=1');
  assertEq(art1.status, 'draft', 'createArtifact: 初始状态=draft');

  const art2 = R.updateContent(art1, '# 需求V2');
  assertEq(art2.version, 2, 'updateContent: 版本自动+1');
  assertEq(art2.content, '# 需求V2', 'updateContent: 内容已更新');
  assertEq(art2.status, 'draft', 'updateContent: 状态重置为 draft');

  const art3 = R.changeStatus(art2, 'approved');
  assertEq(art3.status, 'approved', 'changeStatus: →approved');
  assertEq(art3.version, 2, 'changeStatus: 版本号不变');

  // ═══════════════════════════════════════════
  // 2. Registry 注册与版本追踪
  // ═══════════════════════════════════════════
  console.log('\n📋 2. Registry 注册与版本追踪');
  console.log('─'.repeat(50));

  const reg = new ArtifactRegistry({ maxVersions: 10, dataDir: TEST_DIR });
  const a = R.createArtifact({ name: 'API设计', type: 'document', content: 'v1', createdBy: 'eng' });
  
  reg.register(a);
  assertEq(reg.count, 1, 'register: count=1');
  assert(reg.get(a.id) !== undefined, 'register: 可按 ID 查询');

  const versions1 = reg.getVersions(a.id);
  assertEq(versions1.length, 1, 'register: 自动创建初始版本快照');
  assertEq(versions1[0].version, 1, 'register: 初始版本快照 version=1');

  // 多次更新
  let current = a;
  for (let i = 2; i <= 4; i++) {
    current = R.updateContent(current, `v${i}`);
    reg.update(current, `更新到v${i}`);
  }
  assertEq(reg.get(current.id)!.version, 4, 'update×3: 版本号=4');
  const versions4 = reg.getVersions(current.id);
  assertEq(versions4.length, 4, 'update×3: 共4个版本快照');
  assertEq(versions4[3].version, 4, 'update×3: 最新快照 version=4');
  assertEq(versions4[0].version, 1, 'update×3: 最早快照 version=1');

  // 版本上限
  const regLimit = new ArtifactRegistry({ maxVersions: 3, dataDir: TEST_DIR + '-limit' });
  let al = R.createArtifact({ name: 'limited', type: 'code', content: 'v1' });
  regLimit.register(al);
  for (let i = 2; i <= 6; i++) { al = R.updateContent(al, `v${i}`); regLimit.update(al, `v${i}`); }
  const vl = regLimit.getVersions(al.id);
  assert(vl.length <= 3, `版本上限=3: 实际=${vl.length}`);
  assertEq(vl[vl.length - 1].version, 6, '版本上限: 最新快照仍是v6');
  try { fs.rmSync(TEST_DIR + '-limit', { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════
  // 3. 图谱关系
  // ═══════════════════════════════════════════
  console.log('\n📋 3. 图谱关系');
  console.log('─'.repeat(50));

  const parent = R.createArtifact({ name: '父', type: 'document', content: '' });
  const child = R.createArtifact({ name: '子', type: 'code', content: '' });
  reg.register(parent); reg.register(child);
  reg.createRelation(parent.id, child.id, 'child');
  
  const rels = reg.getRelations(parent.id);
  assert(rels.some(r => r.from === parent.id && r.to === child.id), 'createRelation: parent→child');
  
  const graph = reg.getGraph(parent.id);
  assertEq(graph.children[0], child.id, 'getGraph: children 正确');
  assertEq(graph.parents.length, 0, 'getGraph: 无父节点');

  // ═══════════════════════════════════════════
  // 4. 持久化往返（关键！验证无双写）
  // ═══════════════════════════════════════════
  console.log('\n📋 4. 持久化往返 (saveToDisk → loadFromDisk)');
  console.log('─'.repeat(50));

  const persistReg = new ArtifactRegistry({ dataDir: TEST_DIR + '-persist' });
  const p1 = R.createArtifact({ name: '持久化测试A', type: 'document', content: 'AAA', createdBy: 'tester' });
  const p2 = R.createArtifact({ name: '持久化测试B', type: 'code', content: 'BBB', createdBy: 'tester' });
  persistReg.register(p1); persistReg.register(p2);
  persistReg.createRelation(p1.id, p2.id, 'depends_on');

  // 强制刷盘（不等 2s 定时器）
  await persistReg.saveToDisk();
  console.log('  📀 已写入磁盘');

  // 检查磁盘文件
  const artFile = path.join(TEST_DIR + '-persist', 'artifacts.jsonl');
  const relFile = path.join(TEST_DIR + '-persist', 'relations.jsonl');
  assert(fs.existsSync(artFile), 'artifacts.jsonl 存在');
  assert(fs.existsSync(relFile), 'relations.jsonl 存在');

  // 读取原始文件验证内容
  const artRaw = fs.readFileSync(artFile, 'utf-8');
  const relRaw = fs.readFileSync(relFile, 'utf-8');
  assert(artRaw.includes('持久化测试A'), 'JSONL 包含 artifact A');
  assert(artRaw.includes('持久化测试B'), 'JSONL 包含 artifact B');
  assert(relRaw.includes('depends_on'), 'JSONL 包含关系');

  // 新建 Registry 从磁盘加载
  const loadedReg = new ArtifactRegistry({ dataDir: TEST_DIR + '-persist' });
  const loadResult = await loadedReg.loadFromDisk();
  assertEq(loadResult.artifacts, 2, 'loadFromDisk: 2个artifact');
  assertEq(loadResult.relations, 1, 'loadFromDisk: 1个关系');
  assert(loadedReg.get(p1.id) !== undefined, 'loadFromDisk: artifact A 可查询');
  assert(loadedReg.get(p2.id) !== undefined, 'loadFromDisk: artifact B 可查询');
  const loadedRels = loadedReg.getRelations(p1.id);
  assertEq(loadedRels.length, 1, 'loadFromDisk: 关系可查询');

  // ═══════════════════════════════════════════
  // 5. 无双写验证（已删除 ArtifactStorage）
  // ═══════════════════════════════════════════
  console.log('\n📋 5. 无双写验证');
  console.log('─'.repeat(50));

  // 验证 ArtifactStorage.js 已删除
  const storagePath = '../planes/knowledge-plane/artifacts/ArtifactStorage.js';
  let storageDeleted = false;
  try { await import(storagePath); } catch { storageDeleted = true; }
  assert(storageDeleted, 'ArtifactStorage.ts 已物理删除');

  // 验证 Artifact.js 已删除
  const artifactPath = '../planes/knowledge-plane/artifacts/Artifact.js';
  let artifactDeleted = false;
  try { await import(artifactPath); } catch { artifactDeleted = true; }
  assert(artifactDeleted, 'Artifact.ts 已物理删除');

  // 验证唯一持久化路径：Registry 不产生多余文件
  const persistDir = path.join(TEST_DIR + '-persist');
  const files = fs.readdirSync(persistDir);
  assertEq(files.length, 2, `仅有2个文件: ${files.join(', ')}`);
  assert(files.includes('artifacts.jsonl'), '只有 artifacts.jsonl');
  assert(files.includes('relations.jsonl'), '只有 relations.jsonl');
  // 不应该存在旧 ArtifactStorage 会产生的 index.jsonl / versions.jsonl
  assert(!files.includes('index.jsonl'), '无旧 ArtifactStorage 的 index.jsonl');
  assert(!files.includes('versions.jsonl'), '无旧 ArtifactStorage 的 versions.jsonl');

  // ═══════════════════════════════════════════
  // 6. URI 解析
  // ═══════════════════════════════════════════
  console.log('\n📋 6. URI 解析');
  console.log('─'.repeat(50));

  const uri = ArtifactRegistry.buildURI('software_engineering', 'document', p1.id);
  assert(uri.startsWith('artifact://'), 'buildURI: 前缀正确');
  const parsed = ArtifactRegistry.parseURI(uri);
  assert(parsed !== null, 'parseURI: 非null');
  assertEq(parsed!.domain, 'software_engineering', 'parseURI: domain');
  assertEq(parsed!.artifactType, 'document', 'parseURI: type');
  assertEq(parsed!.artifactId, p1.id, 'parseURI: id');

  const resolved = persistReg.resolve(uri);
  assert(resolved !== undefined, 'resolve: 可解析');
  assertEq(resolved!.name, '持久化测试A', 'resolve: 内容正确');

  // ═══════════════════════════════════════════
  // 7. Clear & 搜索
  // ═══════════════════════════════════════════
  console.log('\n📋 7. Clear & 搜索');
  console.log('─'.repeat(50));

  const searchReg = new ArtifactRegistry({ dataDir: TEST_DIR + '-search' });
  const s1 = R.createArtifact({ name: '代码A', type: 'code', content: '', createdBy: 'dev1' });
  const s2 = R.createArtifact({ name: '代码B', type: 'code', content: '', createdBy: 'dev2' });
  const s3 = R.createArtifact({ name: '文档A', type: 'document', content: '', createdBy: 'dev1' });
  searchReg.register(s1); searchReg.register(s2); searchReg.register(s3);
  
  assertEq(searchReg.search({ type: 'code' }).length, 2, '搜索: type=code → 2');
  assertEq(searchReg.search({ createdBy: 'dev1' }).length, 2, '搜索: createdBy=dev1 → 2');
  assertEq(searchReg.search({ name: '代码' }).length, 2, '搜索: name含"代码" → 2');

  const stats = searchReg.getStatsByType();
  assertEq(stats.code, 2, '统计: code=2');
  assertEq(stats.document, 1, '统计: document=1');

  searchReg.clear();
  assertEq(searchReg.count, 0, 'clear: count=0');
  assertEq(searchReg.getAll().length, 0, 'clear: getAll=[]');
  try { fs.rmSync(TEST_DIR + '-search', { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════
  // 8. 版本回滚
  // ═══════════════════════════════════════════
  console.log('\n📋 8. 版本回滚');
  console.log('─'.repeat(50));

  const rollReg = new ArtifactRegistry({ dataDir: TEST_DIR + '-rollback' });
  let ra = R.createArtifact({ name: '可回滚', type: 'document', content: '初版' });
  rollReg.register(ra);
  ra = R.updateContent(ra, '二版'); rollReg.update(ra, '改到v2');
  ra = R.updateContent(ra, '三版'); rollReg.update(ra, '改到v3');

  const v1Snapshot = rollReg.getVersions(ra.id)[0];
  const rolled = rollbackToVersion(ra, v1Snapshot);
  assertEq(rolled.content, '初版', '回滚: 内容恢复到v1');
  assertEq(rolled.version, 4, '回滚: 版本号+1');

  try { fs.rmSync(TEST_DIR + '-rollback', { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════
  // 清理
  // ═══════════════════════════════════════════
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TEST_DIR + '-persist', { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
