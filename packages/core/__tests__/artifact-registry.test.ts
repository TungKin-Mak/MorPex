/**
 * ArtifactRegistry 产物注册中心测试（L7 Knowledge/artifact）— 此前零覆盖（170 stmt / 0.6%）
 *
 * 覆盖：register/get/getAll/update 版本管理 + search 查询 + 关系图（createRelation/getGraph/resolve）
 *       + 域索引（listByDomain/getStatsByType）+ 磁盘持久化（saveToDisk/loadFromDisk）
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactRegistry } from '../src/knowledge/artifact/registry/ArtifactRegistry.js';
import type { ArtifactInstance, ArtifactVersion } from '../src/knowledge/artifact/registry/types.js';

const TMP = path.join(os.tmpdir(), `morpex-art-reg-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });

function makeArtifact(over: Partial<ArtifactInstance>): ArtifactInstance {
  return {
    id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: '未命名', type: 'document', content: '{}', version: 1,
    status: 'draft', createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  };
}

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('ArtifactRegistry — 注册与查询', () => {
  it('register/get/getAll/listByDomain', async () => {
    const r = new ArtifactRegistry({ dataDir: path.join(TMP, 'r1') });
    const a = makeArtifact({ name: '需求文档', type: 'document' });
    await r.register(a, 'product');
    expect(r.get(a.id)?.name).toBe('需求文档');
    expect(r.getAll()).toHaveLength(1);
    expect(r.listByDomain('product').some(x => x.id === a.id)).toBe(true);
    expect(r.listByDomain('engineering')).toHaveLength(0);
  });

  it('update 递增版本 + changeLog 记录 + getVersions', async () => {
    const r = new ArtifactRegistry({ dataDir: path.join(TMP, 'r2') });
    const a = makeArtifact({ name: '文档', content: 'v1' });
    await r.register(a);
    await r.update({ ...a, content: 'v2' }, '增加内容', 1);
    const versions: ArtifactVersion[] = r.getVersions(a.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.some(v => v.content === 'v1')).toBe(true);
    expect(versions.some(v => v.content === 'v2')).toBe(true);
  });

  it('search 按 type/status/name 过滤', async () => {
    const r = new ArtifactRegistry({ dataDir: path.join(TMP, 'r3') });
    await r.register(makeArtifact({ name: '代码文件', type: 'code', status: 'approved' }));
    await r.register(makeArtifact({ name: '配置', type: 'config', status: 'draft' }));
    expect(r.search({ type: 'code' })).toHaveLength(1);
    expect(r.search({ status: 'draft' })).toHaveLength(1);
    expect(r.search({ name: '代码' })).toHaveLength(1);
    expect(r.search({ type: 'image' })).toHaveLength(0);
  });

  it('getStatsByType 统计类型分布', async () => {
    const r = new ArtifactRegistry({ dataDir: path.join(TMP, 'r4') });
    await r.register(makeArtifact({ type: 'code' }));
    await r.register(makeArtifact({ type: 'code' }));
    await r.register(makeArtifact({ type: 'document' }));
    const stats = r.getStatsByType();
    expect(stats.code).toBe(2);
    expect(stats.document).toBe(1);
  });
});

describe('ArtifactRegistry — 关系图与 URI 解析', () => {
  it('createRelation/getRelations/getGraph', async () => {
    const r = new ArtifactRegistry({ dataDir: path.join(TMP, 'r5') });
    const parent = makeArtifact({ name: 'P' });
    const child = makeArtifact({ name: 'C' });
    await r.register(parent);
    await r.register(child);
    r.createRelation(parent.id, child.id, 'child');
    expect(r.getRelations(parent.id)).toHaveLength(1);
    const graph = r.getGraph(parent.id);
    expect(graph.children).toContain(child.id);
  });

  it('resolve 解析 URI → artifact（不存在返回 undefined）', async () => {
    const r = new ArtifactRegistry({ dataDir: path.join(TMP, 'r6') });
    const a = makeArtifact({ id: 'art_uri_1', name: 'URI产物' });
    await r.register(a, 'product');
    const resolved = r.resolve('artifact://product/document/art_uri_1');
    expect(resolved?.name).toBe('URI产物');
    expect(r.resolve('artifact://product/document/art_nonexistent')).toBeUndefined();
    expect(r.resolve('not-a-uri')).toBeUndefined(); // 非法 scheme
  });
});

describe('ArtifactRegistry — 磁盘持久化', () => {
  it('saveToDisk → loadFromDisk 恢复产物与关系', async () => {
    const dir = path.join(TMP, 'r7');
    const r = new ArtifactRegistry({ dataDir: dir, storage: { enableIndex: true } });
    const a = makeArtifact({ name: '持久化产物', type: 'report' });
    await r.register(a);
    await r.saveToDisk();

    const r2 = new ArtifactRegistry({ dataDir: dir });
    const loaded = await r2.loadFromDisk();
    expect(loaded.artifacts).toBeGreaterThanOrEqual(1);
    expect(r2.getAll().some(x => x.name === '持久化产物')).toBe(true);
  }, 15000);
});
