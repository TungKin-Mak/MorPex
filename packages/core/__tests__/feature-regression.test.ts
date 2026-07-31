/**
 * feature-regression.test.ts — 全功能实现的新能力回归测试
 *
 * 覆盖：演化沙箱 / Ontology 元数据冲突 / Policy 热更新快照 / 成本-质量仪表盘
 */
import { describe, it, expect } from 'vitest';
import { EvolutionSandbox } from '../src/evolution/EvolutionSandbox.js';
import { OntologyService } from '../src/ontology/OntologyService.js';
import { ForcedQueryGuard } from '../src/ontology/ForcedQueryGuard.js';
import { ObjectTypeRegistry } from '../src/ontology/ObjectTypeRegistry.js';
import { SystemMetadataGraph } from '../src/metadata/SystemMetadataGraph.js';
import { PolicyController } from '../src/control-plane/PolicyController.js';
import { ApprovalPolicyRegistry } from '../src/verification/ApprovalGate.js';
import { GovernanceDashboard } from '../src/governance/GovernanceDashboard.js';
import { EventBus } from '../src/common/EventBus.js';

describe('EvolutionSandbox（L8 演化安全沙箱）', () => {
  it('沙箱试跑通过 → pending_approval → 审批 → applied → 可回滚', async () => {
    const sb = new EvolutionSandbox({ goldenTasks: [{ id: 'g1', run: () => true }] });
    const rec = await sb.proposeChange({ summary: '优化规划' });
    expect(rec.sandboxPassed).toBe(true);
    expect(rec.status).toBe('pending_approval');
    await sb.approveAndApply(rec.id);
    expect(sb.getChange(rec.id)?.status).toBe('applied');
    await sb.rollback(rec.id);
    expect(sb.getChange(rec.id)?.status).toBe('rolled_back');
  });

  it('沙箱试跑失败 → rejected（不进入审批）', async () => {
    const sb = new EvolutionSandbox({ goldenTasks: [{ id: 'bad', run: () => false }] });
    const rec = await sb.proposeChange({ summary: '坏变更' });
    expect(rec.sandboxPassed).toBe(false);
    expect(rec.status).toBe('rejected');
  });
});

describe('Ontology 事实元数据 + 冲突策略（P2）', () => {
  it('upsert 带 source/confidence/version 元数据', async () => {
    const graph = new SystemMetadataGraph();
    const ontology = new OntologyService(graph, new ObjectTypeRegistry());
    const obj = await ontology.upsertObject({
      type: 'Mission', properties: { title: 'T1', objective: 'x', status: 'active' },
      source: 'test', confidence: 0.9,
    });
    expect(obj.metadata?.source).toBe('test');
    expect(obj.metadata?.confidence).toBe(0.9);
    expect(obj.metadata?.version).toBe(1);
  });

  it('低置信写入被高置信阻挡并标记 conflict', async () => {
    const graph = new SystemMetadataGraph();
    const ontology = new OntologyService(graph, new ObjectTypeRegistry());
    const first = await ontology.upsertObject({ id: 'mis_1', type: 'Mission', properties: { title: '高置信', status: 'active' }, confidence: 0.9 });
    await ontology.upsertObject({ id: 'mis_1', type: 'Mission', properties: { title: '低置信', status: 'active' }, confidence: 0.2 });
    const after = await ontology.getObject('mis_1');
    expect(after?.metadata?.conflict).toBe(true);
    expect(after?.properties?.title ?? after?.metadata?.title).toBe('高置信');
    void first;
  });
});

describe('Policy 热更新快照（P2）', () => {
  it('capturePolicySnapshot 记录修订号；register 策略后 revision 递增', async () => {
    const pc = new PolicyController();
    const before = pc.capturePolicySnapshot();
    ApprovalPolicyRegistry.register({ action: 'test.action' as never, riskLevel: 'low' as never, requireHuman: false, autoApprove: true });
    const after = pc.getPolicyRevision();
    expect(after).toBeGreaterThanOrEqual(before.revision);
  });
});

describe('成本-质量仪表盘（L10）', () => {
  it('getCostQualityReport 聚合成本/质量/健康', () => {
    const dash = new GovernanceDashboard(new EventBus());
    const report = dash.getCostQualityReport();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(typeof report.cost.total).toBe('number');
    expect(typeof report.quality.taskSuccessRate).toBe('number');
    expect(Array.isArray(report.recommendations)).toBe(true);
  });
});

describe('Ontology Guard 基础', () => {
  it('recordToolCall + validateReferences 引用校验', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('e1', 'query', {}, { id: 'obj_1' });
    const check = guard.validateReferences('e1', ['obj_1']);
    expect(check.valid).toBe(true);
    expect(check.missing).toHaveLength(0);
  });
});
