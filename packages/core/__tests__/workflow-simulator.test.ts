/**
 * WorkflowSimulator 工作流仿真测试（L7 Evolution/workflow）— 此前零覆盖（208 stmt / 1.9%）
 *
 * 覆盖：simulate 多维度指标（successRate/riskScore/failureModes/qualityScore/confidence）
 *       + 风险/金融/敏感关键词失败模式检测 + 历史 Mission 参考 + 上下文约束 + getStats
 */
import { describe, it, expect } from 'vitest';
import { WorkflowSimulator } from '../src/evolution/workflow/WorkflowSimulator.js';
import type { WorkflowCandidate, WorkflowStepDef } from '../src/evolution/workflow/types.js';

function step(name: string, over: Partial<WorkflowStepDef> = {}): WorkflowStepDef {
  return { name, description: name, domain: 'general', agentType: 'coding', deps: [], config: {}, ...over };
}

function candidate(name: string, steps: WorkflowStepDef[]): WorkflowCandidate {
  return {
    name, description: name, steps, confidence: 0.8,
    sourceMissionIds: ['m1'], detectedAt: Date.now(),
  } as WorkflowCandidate;
}

function mission(id: string, goal: string, state = 'COMPLETED') {
  return { id, goal, state } as any;
}

describe('WorkflowSimulator — 基本仿真', () => {
  it('空历史 → 返回完整 SimulationResult（含全部指标）', async () => {
    const sim = new WorkflowSimulator();
    const r = await sim.simulate(candidate('wf_test', [step('写代码'), step('测试')]), []);
    expect(r.candidateName).toBe('wf_test');
    expect(r.workflowId).toContain('wf_sim_');
    expect(r.executions).toBe(0);
    expect(typeof r.successRate).toBe('number');
    expect(typeof r.riskScore).toBe('number');
    expect(typeof r.qualityScore).toBe('number');
    expect(r.passed).toBe(true); // 决策交给 PolicyEngine
    expect(r.metrics.stepReasonableness).toBeGreaterThan(0);
  });

  it('历史 Mission → successRate 估计 + confidence 随样本增长', async () => {
    const sim = new WorkflowSimulator();
    const missions = Array.from({ length: 8 }, (_, i) => mission(`m${i}`, '写代码任务'));
    const r = await sim.simulate(candidate('wf_a', [step('编码')]), missions);
    expect(r.executions).toBe(8);
    expect(r.confidence).toBeCloseTo(0.8, 1); // min(1, 8/10)
  });

  it('getStats 统计仿真次数', async () => {
    const sim = new WorkflowSimulator();
    await sim.simulate(candidate('w1', [step('a')]), []);
    await sim.simulate(candidate('w2', [step('b')]), []);
    expect(sim.getStats().totalSimulations).toBe(2);
  });
});

describe('WorkflowSimulator — 风险评分与失败模式', () => {
  it('步骤含风险关键词（delete/terminate）→ 风险分升高', async () => {
    const sim = new WorkflowSimulator();
    const r1 = await sim.simulate(candidate('safe', [step('读取数据'), step('生成报表')]), []);
    const r2 = await sim.simulate(candidate('risky', [step('删除数据', { name: 'delete_old' }), step('终止服务', { name: 'terminate' })]), []);
    expect(r2.riskScore).toBeGreaterThan(r1.riskScore); // delete/terminate 各 +15
  });

  it('步骤含敏感关键词（credential/token）→ 风险分升高', async () => {
    const sim = new WorkflowSimulator();
    const r1 = await sim.simulate(candidate('safe', [step('常规操作')]), []);
    const r2 = await sim.simulate(candidate('sens', [step('读取 credential')]), []);
    expect(r2.riskScore).toBeGreaterThan(r1.riskScore); // +10
  });

  it('finance 上下文（workflowType）→ 风险分 +20', async () => {
    const sim = new WorkflowSimulator();
    const rBase = await sim.simulate(candidate('wf', [step('操作')]), [], { workflowType: 'general', riskTolerance: 'medium', historicalExecutions: 5, domainConstraints: [] });
    const rFin = await sim.simulate(candidate('wf2', [step('操作')]), [], { workflowType: 'finance', riskTolerance: 'low', historicalExecutions: 5, domainConstraints: ['合规'] });
    expect(rFin.riskScore).toBeGreaterThan(rBase.riskScore); // finance +20
  });

  it('历史失败 Mission（sourceMissionIds 命中 FAILED）→ 检测 timeout 失败模式', async () => {
    const sim = new WorkflowSimulator();
    const srcId = 'm_fail_1';
    const cand: WorkflowCandidate = {
      name: 'wf_fail', description: 'x', steps: [step('任务')],
      confidence: 0.5, sourceMissionIds: [srcId], detectedAt: Date.now(),
    } as WorkflowCandidate;
    const r = await sim.simulate(cand, [
      mission(srcId, '任务'),
      { id: srcId, goal: '任务', state: 'FAILED', error: 'request timeout' } as any,
    ]);
    expect(r.failureModes.length).toBeGreaterThan(0);
    expect(r.failureModes.some(f => f.name === 'timeout')).toBe(true);
  });
});

describe('WorkflowSimulator — 上下文约束', () => {
  it('finance 上下文 → 风险分受领域约束影响', async () => {
    const sim = new WorkflowSimulator();
    const r = await sim.simulate(candidate('wf_ctx', [step('操作')]), [], {
      workflowType: 'finance', riskTolerance: 'low',
      historicalExecutions: 5, domainConstraints: ['合规'],
    });
    expect(typeof r.riskScore).toBe('number');
    expect(r.recommendations).toBeDefined();
  });

  it('自定义 config（默认质量分）', async () => {
    const sim = new WorkflowSimulator({ defaultQualityScore: 0.8, minReferenceMissions: 5 });
    const r = await sim.simulate(candidate('w', [step('x')]), []);
    expect(r.qualityScore).toBeGreaterThan(0);
    expect(sim.getStats().totalSimulations).toBe(1);
  });
});
