/**
 * ArtifactFacade 测试（L7 Knowledge / Artifact 状态机 + Blueprint）— 此前零直接测试
 *
 * 覆盖：
 *   - Artifact 生命周期状态机（VALID_TRANSITIONS）：合法/非法转换、lineage 追踪、FAILED 恢复
 *   - 查询：get / getAll / getByTask / getLineage / addLineage / createFromTask
 *   - Blueprint：setBlueprints / getPendingBlueprints / getNextReadyBlueprint（dependsOn 就绪判定）/ markBlueprintCompleted
 *   - EventBus 事件：ARTIFACT_CREATED / ARTIFACT_UPDATED 广播
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { ArtifactFacade } from '../src/knowledge/artifact/ArtifactFacade.js';
import { EventType } from '../src/infrastructure/protocol/events/EventType.js';
import type { ArtifactStatus } from '../src/infrastructure/protocol/contracts/artifact-lifecycle.js';

function makeFacade(): { facade: ArtifactFacade; bus: EventBus } {
  const bus = new EventBus();
  return { facade: new ArtifactFacade(bus), bus };
}

describe('ArtifactFacade — 生命周期状态机', () => {
  it('create → status CREATED / version 1 / lineage 空 / 元数据保留', () => {
    const { facade } = makeFacade();
    const art = facade.create('readme', 'document', 'task_1', { author: 'ceo' });
    expect(art.status).toBe('CREATED');
    expect(art.version).toBe(1);
    expect(art.lineage).toHaveLength(0);
    expect(art.sourceTask).toBe('task_1');
    expect(art.metadata.author).toBe('ceo');
    expect(art.id).toMatch(/^art_/);
  });

  it('完整生命周期 CREATED→VALIDATING→REVIEWING→APPROVED→RELEASED→DEPLOYED→RETIRED', () => {
    const { facade } = makeFacade();
    const art = facade.create('doc', 'document', 't1');
    const chain: ArtifactStatus[] = ['VALIDATING', 'REVIEWING', 'APPROVED', 'RELEASED', 'DEPLOYED', 'RETIRED'];
    let cur = art;
    for (const to of chain) {
      expect(facade.transition(cur.id, to)).toBe(true);
      cur = facade.get(cur.id)!;
      expect(cur.status).toBe(to);
    }
    // RETIRED 是终态：不能再转换
    expect(facade.transition(cur.id, 'DEPLOYED')).toBe(false);
  });

  it('非法转换被拒绝：CREATED 不能直接跳 APPROVED', () => {
    const { facade } = makeFacade();
    const art = facade.create('doc', 'document', 't1');
    expect(facade.transition(art.id, 'APPROVED')).toBe(false);
    expect(facade.get(art.id)!.status).toBe('CREATED');
  });

  it('每层状态可 FAILED，FAILED 可恢复为 CREATED', () => {
    const { facade } = makeFacade();
    const art = facade.create('doc', 'document', 't1');
    expect(facade.transition(art.id, 'FAILED')).toBe(true);
    expect(facade.get(art.id)!.status).toBe('FAILED');
    expect(facade.transition(art.id, 'CREATED')).toBe(true);
    expect(facade.get(art.id)!.status).toBe('CREATED');
  });

  it('transition 记录 lineage 条目（from_to）', () => {
    const { facade } = makeFacade();
    const art = facade.create('doc', 'document', 't1');
    facade.transition(art.id, 'VALIDATING');
    const lineage = facade.getLineage(art.id);
    expect(lineage).toHaveLength(1);
    expect(lineage[0].relation).toContain('created_to_validating');
  });

  it('transition 不存在的 id → false', () => {
    const { facade } = makeFacade();
    expect(facade.transition('art_missing', 'VALIDATING')).toBe(false);
  });
});

describe('ArtifactFacade — 查询与任务关联', () => {
  it('get / getAll / getByTask', () => {
    const { facade } = makeFacade();
    const a = facade.create('a', 'document', 'task_x');
    const b = facade.create('b', 'code', 'task_x');
    const c = facade.create('c', 'report', 'task_y');
    expect(facade.get(a.id)!.name).toBe('a');
    expect(facade.getAll()).toHaveLength(3);
    expect(facade.getByTask('task_x').map(x => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(facade.getByTask('task_y')).toHaveLength(1);
    expect(facade.getByTask('task_zzz')).toHaveLength(0);
  });

  it('addLineage 追加自定义谱系', () => {
    const { facade } = makeFacade();
    const art = facade.create('a', 'document', 't1');
    facade.addLineage(art.id, {
      from: art.id,
      relation: 'referenced_by',
      timestamp: Date.now(),
    });
    expect(facade.getLineage(art.id)).toHaveLength(1);
  });

  it('createFromTask 委托 create 并携带 content', async () => {
    const { facade } = makeFacade();
    const art = await facade.createFromTask('task_z', { name: 'spec', content: 'x' }, 'doc');
    expect(art.sourceTask).toBe('task_z');
    expect(art.name).toBe('spec');
    expect(art.metadata.content).toEqual({ name: 'spec', content: 'x' });
  });
});

describe('ArtifactFacade — Blueprint 依赖编排', () => {
  function bp(id: string, deps: string[] = [], status: 'PENDING' | 'COMPLETED' = 'PENDING') {
    return { id, status, dependsOn: deps, name: id } as any;
  }

  it('setBlueprints + getPendingBlueprints 过滤已完成的', () => {
    const { facade } = makeFacade();
    facade.setBlueprints([bp('bp1'), bp('bp2', [], 'COMPLETED')]);
    const pending = facade.getPendingBlueprints();
    expect(pending.map(p => p.id)).toEqual(['bp1']);
  });

  it('getNextReadyBlueprint：无依赖的 PENDING 优先，依赖未完成则阻塞', () => {
    const { facade } = makeFacade();
    facade.setBlueprints([bp('root'), bp('child', ['root'])]);
    const next = facade.getNextReadyBlueprint();
    expect(next?.id).toBe('root'); // root 无依赖先就绪
    expect(facade.getAllBlueprints()).toHaveLength(2);
  });

  it('markBlueprintCompleted 后子蓝图转为就绪', () => {
    const { facade } = makeFacade();
    facade.setBlueprints([bp('root'), bp('child', ['root'])]);
    facade.markBlueprintCompleted('root');
    const next = facade.getNextReadyBlueprint();
    expect(next?.id).toBe('child');
  });

  it('无 PENDING 蓝图 → getNextReadyBlueprint undefined', () => {
    const { facade } = makeFacade();
    facade.setBlueprints([bp('done', [], 'COMPLETED')]);
    expect(facade.getNextReadyBlueprint()).toBeUndefined();
  });
});

describe('ArtifactFacade — EventBus 事件广播', () => {
  it('create 发射 artifact.created（projected）', () => {
    const { facade, bus } = makeFacade();
    const seen: string[] = [];
    bus.onProjected((e) => seen.push(e.type));
    facade.create('doc', 'document', 't1');
    expect(seen).toContain(EventType.ARTIFACT_CREATED);
  });

  it('transition 发射 artifact.updated', () => {
    const { facade, bus } = makeFacade();
    const seen: string[] = [];
    bus.onProjected((e) => seen.push(e.type));
    const art = facade.create('doc', 'document', 't1');
    facade.transition(art.id, 'VALIDATING');
    expect(seen).toContain(EventType.ARTIFACT_UPDATED);
  });
});
