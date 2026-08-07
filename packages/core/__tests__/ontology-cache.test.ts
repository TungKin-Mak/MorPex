/**
 * OntologyService toOntologyObject 缓存测试（会话 16k 性能优化）
 *
 * 覆盖：
 *   1. 同实体重复读取 → 返回同一对象引用（memoization，零重建）
 *   2. upsert 后 → 新对象引用（WeakMap 自动失效，无 stale）
 *   3. 不同实体 → 独立缓存
 */

import { describe, it, expect } from 'vitest';
import { OntologyService } from '../src/knowledge/ontology/OntologyService.js';
import { SystemMetadataGraph } from '../src/knowledge/graph/SystemMetadataGraph.js';
import { ObjectTypeRegistry } from '../src/knowledge/ontology/ObjectTypeRegistry.js';

describe('OntologyService — toOntologyObject 缓存（16k）', () => {
  function makeOntology() {
    return new OntologyService(new SystemMetadataGraph(), new ObjectTypeRegistry());
  }

  it('同实体重复读取 → 同一对象引用（memoization，零重建）', async () => {
    const ontology = makeOntology();
    await ontology.upsertObject({ id: 'goal_1', type: 'Goal', properties: { title: '目标A' } });

    const a = await ontology.getObject('goal_1');
    const b = await ontology.getObject('goal_1');
    expect(a).toBe(b); // 同一引用（缓存命中）
  });

  it('upsert 后 → 新对象引用（WeakMap 自动失效，无 stale）', async () => {
    const ontology = makeOntology();
    await ontology.upsertObject({ id: 'goal_1', type: 'Goal', properties: { title: '旧标题' } });
    const before = await ontology.getObject('goal_1');
    expect(before!.properties.title).toBe('旧标题');

    await ontology.upsertObject({ id: 'goal_1', type: 'Goal', properties: { title: '新标题' } });
    const after = await ontology.getObject('goal_1');
    expect(after).not.toBe(before); // 新引用
    expect(after!.properties.title).toBe('新标题'); // 读到新值，无 stale
  });

  it('不同实体 → 独立缓存', async () => {
    const ontology = makeOntology();
    await ontology.upsertObject({ id: 'g1', type: 'Goal', properties: { title: 'A' } });
    await ontology.upsertObject({ id: 'g2', type: 'Goal', properties: { title: 'B' } });
    const o1 = await ontology.getObject('g1');
    const o2 = await ontology.getObject('g2');
    expect(o1).not.toBe(o2);
    expect(o1!.properties.title).toBe('A');
    expect(o2!.properties.title).toBe('B');
  });

  it('queryObjects 多次查询同一实体 → 复用缓存引用', async () => {
    const ontology = makeOntology();
    await ontology.upsertObject({ id: 'g1', type: 'Goal', properties: { title: 'A' } });
    const r1 = await ontology.queryObjects({ type: 'Goal', limit: 10 });
    const r2 = await ontology.queryObjects({ type: 'Goal', limit: 10 });
    expect(r1[0].object).toBe(r2[0].object);
  });
});
