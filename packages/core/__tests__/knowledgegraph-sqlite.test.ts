/**
 * KnowledgeGraph — SQLite 持久化单元测试（记忆统一：JSONL → SQLite）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { KnowledgeGraph } from '../src/metadata/knowledge/KnowledgeGraph.js';

describe('KnowledgeGraph（SQLite 持久化）', () => {
  let dir: string;
  let kg: KnowledgeGraph | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kgtest-'));
  });

  afterEach(() => {
    if (kg) { kg.close(); kg = null; }
    // Windows: 先 close 释放 WAL 锁，再删目录
    for (let i = 0; i < 3; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; }
      catch { /* retry */ }
    }
  });

  function open(): KnowledgeGraph {
    kg = new KnowledgeGraph({ dataDir: dir });
    return kg;
  }

  it('add 后重新加载：数据从 SQLite 恢复（持久化）', () => {
    const k1 = open();
    const e1 = k1.addEntity({ type: 'Module', name: 'OrderService', tags: ['订单', '核心'] });
    const e2 = k1.addEntity({ type: 'Module', name: 'InventoryService', tags: ['库存'] });
    k1.addRelation({ source: e1.id, target: e2.id, type: 'DEPENDS_ON' });
    k1.close();

    const k2 = open();
    expect(k2.get(e1.id)?.name).toBe('OrderService');
    expect(k2.get(e2.id)?.tags).toContain('库存');
    expect(k2.getStats().totalEntities).toBe(2);
    expect(k2.getStats().totalRelations).toBe(1);
  });

  it('searchEntities 按文本/类型/标签过滤', () => {
    const k = open();
    k.addEntity({ type: 'Module', name: 'OrderService', tags: ['订单'] });
    k.addEntity({ type: 'Rule', name: '报价前必须合规检查', tags: ['规则'] });
    const byText = k.searchEntities('报价');
    expect(byText.some((e) => e.name.includes('合规'))).toBe(true);
    const byType = k.searchEntities({ entityType: 'Module' });
    expect(byType).toHaveLength(1);
  });

  it('getNeighborhood / findPath 图遍历正常', () => {
    const k = open();
    const a = k.addEntity({ type: 'Module', name: 'A' });
    const b = k.addEntity({ type: 'Module', name: 'B' });
    const c = k.addEntity({ type: 'Module', name: 'C' });
    k.addRelation({ source: a.id, target: b.id, type: 'CALLS' });
    k.addRelation({ source: b.id, target: c.id, type: 'CALLS' });

    const nb = k.getNeighborhood(a.id, 2);
    expect(nb.entities.length).toBeGreaterThanOrEqual(2);

    const p = k.findPath(a.id, c.id);
    expect(p).not.toBeNull();
    expect(p!.relations.length).toBe(2);
  });

  it('removeEntity / clear 同步 SQLite', () => {
    const k = open();
    const e = k.addEntity({ type: 'Module', name: 'X' });
    k.removeEntity(e.id);
    expect(k.getStats().totalEntities).toBe(0);

    k.addEntity({ type: 'Module', name: 'Y' });
    k.clear();
    expect(k.getStats().totalEntities).toBe(0);

    const k2 = open();
    expect(k2.getStats().totalEntities).toBe(0);
  });
});
