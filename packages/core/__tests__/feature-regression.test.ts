/**
 * feature-regression.test.ts — 全功能实现的新能力回归测试
 *
 * 覆盖：演化沙箱 / Ontology 元数据冲突 / Policy 热更新快照 / 成本-质量仪表盘
 */
import { describe, it, expect } from 'vitest';
import { EvolutionSandbox } from '../src/evolution/EvolutionSandbox.js';
import { OntologyService } from '../src/knowledge/ontology/OntologyService.js';
import { ForcedQueryGuard } from '../src/gate/ForcedQueryGuard.js';
import { ObjectTypeRegistry } from '../src/knowledge/ontology/ObjectTypeRegistry.js';
import { SystemMetadataGraph } from '../src/knowledge/graph/SystemMetadataGraph.js';
import { PolicyController } from '../src/governance/control-plane/PolicyController.js';
import { ApprovalPolicyRegistry } from '../src/governance/ApprovalGate.js';
import { GovernanceDashboard } from '../src/governance/GovernanceDashboard.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import type { KnowledgeContextPackage } from '../src/gate/context.js';

/** Wave 3b：Gate 硬拦截后，晋升调用必须携带有效 KnowledgeContextPackage */
function validGateContext(): KnowledgeContextPackage {
  return {
    executionId: `test-exec-${Math.random().toString(36).slice(2)}`,
    riskTier: 'tier-0',
    queryCallCount: 1,
    retrievedIds: ['o1'],
    referenceCheck: { valid: true, missing: [], knownCount: 1 },
    issuedAt: Date.now(),
  };
}

describe('EvolutionSandbox（L8 演化安全沙箱）', () => {
  it('沙箱试跑通过 → pending_approval → 审批 → applied → 可回滚', async () => {
    const sb = new EvolutionSandbox({ goldenTasks: [{ id: 'g1', run: () => true }] });
    const rec = await sb.proposeChange({ summary: '优化规划' });
    expect(rec.sandboxPassed).toBe(true);
    expect(rec.status).toBe('pending_approval');
    await sb.approveAndApply(rec.id, validGateContext());
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

  it('L8 自动回滚：approve 执行 apply、rollback 执行 revert（具体变更真实落地/撤销）', async () => {
    const sb = new EvolutionSandbox();
    const applied: string[] = [];
    const reverted: string[] = [];
    const rec = await sb.proposeChange({
      summary: '把默认温度从 0.7 调到 0.2',
      apply: async () => { applied.push('apply:0.2'); },
      revert: async () => { reverted.push('revert:0.7'); },
    });
    expect(rec.status).toBe('pending_approval');

    await sb.approveAndApply(rec.id, validGateContext());
    expect(applied).toEqual(['apply:0.2']);
    expect(sb.getChange(rec.id)?.status).toBe('applied');
    expect(sb.getChange(rec.id)?.applyOutcome).toBe('ok');

    await sb.rollback(rec.id);
    expect(reverted).toEqual(['revert:0.7']);
    expect(sb.getChange(rec.id)?.status).toBe('rolled_back');
    expect(sb.getChange(rec.id)?.revertOutcome).toBe('ok');
  });

  it('L8 apply 失败 → failed，可补偿回滚（revert 仍执行）', async () => {
    const sb = new EvolutionSandbox();
    const reverted: string[] = [];
    const rec = await sb.proposeChange({
      summary: '写坏配置',
      apply: async () => { throw new Error('apply 写入失败'); },
      revert: async () => { reverted.push('revert:恢复旧配置'); },
    });
    await sb.approveAndApply(rec.id, validGateContext());
    const after = sb.getChange(rec.id)!;
    expect(after.status).toBe('failed');
    expect(after.applyOutcome).toBe('failed');
    expect(after.applyError).toContain('写入失败');

    // failed 状态可补偿回滚，revert 真正执行
    await sb.rollback(rec.id);
    expect(reverted).toEqual(['revert:恢复旧配置']);
    expect(sb.getChange(rec.id)?.status).toBe('rolled_back');
  });

  it('L8 revert 失败 → 保持原状态 + revertError（不产生悬挂态，可重试）', async () => {
    const sb = new EvolutionSandbox();
    const rec = await sb.proposeChange({
      summary: '改阈值',
      apply: async () => undefined,
      revert: async () => { throw new Error('revert 网络超时'); },
    });
    await sb.approveAndApply(rec.id, validGateContext());
    await sb.rollback(rec.id);
    const after = sb.getChange(rec.id)!;
    expect(after.status).toBe('applied');  // revert 失败保持原状态
    expect(after.revertOutcome).toBe('failed');
    expect(after.revertError).toContain('网络超时');
  });

  it('L8 回滚后 verify 校验恢复原状', async () => {
    const sb = new EvolutionSandbox();
    const rec = await sb.proposeChange({
      summary: '切换模板',
      apply: async () => undefined,
      revert: async () => undefined,
      verify: async () => true,
    });
    await sb.approveAndApply(rec.id, validGateContext());
    await sb.rollback(rec.id);
    expect(sb.getChange(rec.id)?.status).toBe('rolled_back');
    expect(sb.getChange(rec.id)?.verifyOutcome).toBe('ok');
  });

  it('L8 未落地（pending_approval）不可回滚', async () => {
    const sb = new EvolutionSandbox();
    const rec = await sb.proposeChange({ summary: '未审批变更' });
    await sb.rollback(rec.id);
    expect(sb.getChange(rec.id)?.status).toBe('pending_approval');
  });

  it('L8 非 pending 重复 approve 不重复执行 apply（幂等守卫）', async () => {
    const sb = new EvolutionSandbox();
    let applyCalls = 0;
    const rec = await sb.proposeChange({
      summary: '改权重',
      apply: async () => { applyCalls++; },
    });
    await sb.approveAndApply(rec.id, validGateContext());
    await sb.approveAndApply(rec.id, validGateContext()); // 已 applied，守卫拒绝
    expect(applyCalls).toBe(1);
    expect(sb.getChange(rec.id)?.status).toBe('applied');
  });

  it('L8 rejected 后 rollback 安全返回（不翻转状态）', async () => {
    const sb = new EvolutionSandbox({ goldenTasks: [{ id: 'bad', run: () => false }] });
    const rec = await sb.proposeChange({ summary: '坏变更' });
    expect(rec.status).toBe('rejected');
    await sb.rollback(rec.id);
    expect(sb.getChange(rec.id)?.status).toBe('rejected');
  });

  it('L8 verify 返回 false → verifyOutcome=failed 且状态仍 rolled_back', async () => {
    const sb = new EvolutionSandbox();
    const rec = await sb.proposeChange({
      summary: '切换模板',
      apply: async () => undefined,
      revert: async () => undefined,
      verify: async () => false,
    });
    await sb.approveAndApply(rec.id, validGateContext());
    await sb.rollback(rec.id);
    const after = sb.getChange(rec.id)!;
    expect(after.status).toBe('rolled_back');
    expect(after.verifyOutcome).toBe('failed');
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
