/**
 * ontology-upsert-status 测试 — upsertObject 顶层 status 参与必填校验
 *
 * 回归：50 任务实测发现 OntologyService.upsertObject 245 次失败
 * （类型 "Mission"/"Artifact" 属性校验失败: Missing required property: status）。
 * 根因：调用方（MissionProjector/ArtifactProjector）把 status 放 upsertObject 顶层参数，
 * 而校验只查 input.properties（缺 status）。
 * 修复：校验时合并顶层 status 进 properties。
 */
import { describe, it, expect } from 'vitest';
import { OntologyService } from '../src/knowledge/ontology/OntologyService.js';
import { ObjectTypeRegistry } from '../src/knowledge/ontology/ObjectTypeRegistry.js';
import { SystemMetadataGraph } from '../src/knowledge/graph/SystemMetadataGraph.js';

function setup() {
  const ontology = new OntologyService(new SystemMetadataGraph(), new ObjectTypeRegistry());
  return { ontology };
}

describe('OntologyService.upsertObject 顶层 status', () => {
  it('Mission：status 在顶层参数 → 校验通过（不再 Missing status）', async () => {
    const { ontology } = setup();
    const m = await ontology.upsertObject({
      id: 'm1',
      type: 'Mission',
      status: 'ACTIVE',
      properties: { title: '测试任务', goal: 'goal-x' },
    });
    expect((m.metadata as { status?: string }).status).toBe('ACTIVE');
  });

  it('Artifact：status 在顶层参数 → 校验通过', async () => {
    const { ontology } = setup();
    const a = await ontology.upsertObject({
      id: 'a1',
      type: 'Artifact',
      status: 'draft',
      properties: { title: '产物', missionId: 'm1' },
    });
    expect((a.metadata as { status?: string }).status).toBe('draft');
  });

  it('负例：确缺必填属性仍应抛错（校验未放宽）', async () => {
    const { ontology } = setup();
    await expect(
      ontology.upsertObject({ id: 'b1', type: 'Mission', properties: { title: 'x' } } as never),
    ).rejects.toThrow(/Missing required property/);
  });
});
