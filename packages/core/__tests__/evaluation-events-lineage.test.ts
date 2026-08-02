/**
 * L6 事件桥 + 血缘健康测试（Wave 3a — L6 做实）
 *
 * 覆盖：
 *   - EvaluationEngine 事件发射：evaluation.scored（总是）、evaluation.low_score（低于阈值）
 *   - payload 刻度：qualityScore 归一化到 0-1（L7 ActiveEvolutionTrigger 按 0-1 消费）
 *   - 无 EventBus 注入时 evaluate() 不炸（向后兼容）
 *   - scoreLineageHealth：批准占比 / 孤立节点 / 缺失节点 / 违规清单
 */
import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from '../src/evaluation/EvaluationEngine.js';
import { scoreLineageHealth } from '../src/evaluation/lineageCompliance.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { ArtifactGraph } from '../src/knowledge/artifact/registry/ArtifactGraph.js';
import type { ArtifactNode } from '../src/knowledge/artifact/registry/types.js';
import type { EvaluationInput } from '../src/evaluation/EvaluationEngine.js';
import type { MorPexEvent } from '../src/infrastructure/common/types.js';

function fullGreenInput(): EvaluationInput {
  return {
    missionId: 'msn_green',
    departmentId: 'dept_dev',
    plan: { steps: 10, capabilities: ['code'] },
    agents: [{ name: 'dev', successRate: 1 }],
    tools: [{ name: 'tsc', successCount: 10, failureCount: 0 }],
    artifacts: [{ type: 'code', status: 'APPROVED' }],
    memory: { recallCount: 5, avgRelevance: 1 },
    executionResult: { ok: true, duration: 100, errors: [] },
  };
}

/** 全维 0.1 分 → overall ≈ 8（0-100 刻度）→ 归一化 0.08 < 0.6 */
function lowScoreInput(): EvaluationInput {
  return {
    missionId: 'msn_low',
    plan: { steps: 1, capabilities: [] },
    agents: [{ name: 'dev', successRate: 0.1 }],
    tools: [{ name: 'flaky', successCount: 1, failureCount: 9 }],
    artifacts: [{ type: 'code', status: 'draft' }],
    memory: { recallCount: 0, avgRelevance: 0.1 },
  };
}

function makeNode(id: string, status: ArtifactNode['status']): ArtifactNode {
  return {
    id,
    name: id,
    type: 'code',
    status,
    version: '1.0.0',
    creator: 'test',
    description: `node ${id}`,
    capabilities: [],
  };
}

describe('EvaluationEngine — L6→L7 事件桥', () => {
  it('全绿输入：发 evaluation.scored（qualityScore=1），不发 low_score', () => {
    const bus = new EventBus();
    const events: MorPexEvent[] = [];
    bus.on('evaluation.scored', (e) => events.push(e));
    bus.on('evaluation.low_score', (e) => events.push(e));

    const engine = new EvaluationEngine(bus);
    const report = engine.evaluate(fullGreenInput());

    expect(report.missionQuality).toBe(100);
    const scored = events.filter((e) => e.type === 'evaluation.scored');
    const low = events.filter((e) => e.type === 'evaluation.low_score');
    expect(scored).toHaveLength(1);
    expect(low).toHaveLength(0);
    expect(scored[0].payload.qualityScore).toBe(1);
    expect(scored[0].payload.departmentId).toBe('dept_dev');
    expect(scored[0].payload.missionId).toBe('msn_green');
    expect(scored[0].payload.decision).toBe('continue');
  });

  it('低分输入：同时发 scored 与 low_score（reason=below_threshold，threshold=0.6）', () => {
    const bus = new EventBus();
    const low: MorPexEvent[] = [];
    bus.on('evaluation.low_score', (e) => low.push(e));

    const engine = new EvaluationEngine(bus);
    engine.evaluate(lowScoreInput());

    expect(low).toHaveLength(1);
    expect(low[0].payload.qualityScore).toBeLessThan(0.6);
    expect(low[0].payload.reason).toBe('below_threshold');
    expect(low[0].payload.threshold).toBe(0.6);
    expect(low[0].payload.missionId).toBe('msn_low');
  });

  it('自定义阈值：threshold=0.9 时中等分也触发 low_score', () => {
    const bus = new EventBus();
    const low: MorPexEvent[] = [];
    bus.on('evaluation.low_score', (e) => low.push(e));

    const engine = new EvaluationEngine(bus, { lowScoreThreshold: 0.9 });
    // overall=100 → 1.0 ≥ 0.9 不触发
    engine.evaluate(fullGreenInput());
    expect(low).toHaveLength(0);

    engine.evaluate(lowScoreInput());
    expect(low).toHaveLength(1);
    expect(low[0].payload.threshold).toBe(0.9);
  });

  it('无 EventBus 注入：evaluate() 正常返回，不发事件不炸', () => {
    const engine = new EvaluationEngine();
    const report = engine.evaluate(fullGreenInput());
    expect(report.decision).toBe('continue');
  });
});

describe('scoreLineageHealth — 血缘健康评分', () => {
  it('已批准节点占比高 → score 高，违规仅含未批准节点', () => {
    const g = new ArtifactGraph();
    g.addNode(makeNode('a', 'approved'));
    g.addNode(makeNode('b', 'approved'));
    g.addNode(makeNode('c', 'draft'));
    g.addEdge('a', 'b', 'dependency');
    g.addEdge('b', 'c', 'derivation');

    const r = scoreLineageHealth(g, ['a', 'b', 'c']);

    expect(r.totalNodes).toBe(3);
    expect(r.committedRatio).toBeCloseTo(2 / 3);
    expect(r.orphanCount).toBe(0);
    expect(r.score).toBeGreaterThan(0.7);
    expect(r.violations.some((v) => v.includes('c') && v.includes('未批准'))).toBe(true);
  });

  it('孤立节点 → orphanCount=1，score 受孤立比例惩罚', () => {
    const g = new ArtifactGraph();
    g.addNode(makeNode('lonely', 'approved'));

    const r = scoreLineageHealth(g, ['lonely']);

    expect(r.orphanCount).toBe(1);
    expect(r.violations.some((v) => v.includes('孤立'))).toBe(true);
    expect(r.score).toBeLessThanOrEqual(0.7);
  });

  it('血缘图中不存在的 ID → 违规清单标记', () => {
    const g = new ArtifactGraph();
    g.addNode(makeNode('a', 'approved'));

    const r = scoreLineageHealth(g, ['a', 'ghost']);

    expect(r.violations.some((v) => v.includes('ghost') && v.includes('不在血缘图'))).toBe(true);
  });
});

describe('EvaluationEngine — lineage 折入（Wave 6b L6 单一权威）', () => {
  /** base = 62：plan 0.5*25 + agent 0.8*20 + tool 0.8*20 + output 0.5*25 + memory 0.5*10 */
  function midInput(): EvaluationInput {
    return {
      missionId: 'msn_mid',
      departmentId: 'dept_dev',
      plan: { steps: 5, capabilities: [] },
      agents: [{ name: 'dev', successRate: 0.8 }],
      tools: [{ name: 't', successCount: 8, failureCount: 2 }],
      artifacts: [
        { type: 'code', status: 'APPROVED' },
        { type: 'code', status: 'draft' },
      ],
      memory: { recallCount: 1, avgRelevance: 0.5 },
    };
  }

  it('提供血缘子图 → lineageHealth 折入 missionQuality（20%），report 携带 lineageHealth', () => {
    const g = new ArtifactGraph();
    g.addNode(makeNode('a', 'approved'));
    g.addNode(makeNode('b', 'approved'));
    g.addEdge('a', 'b', 'dependency');

    const engine = new EvaluationEngine();
    const report = engine.evaluate({ ...midInput(), lineage: { graph: g, artifactIds: ['a', 'b'] } });

    expect(report.lineageHealth).toBeDefined();
    expect(report.lineageHealth!.score).toBe(1);
    // base=62 → 62*0.8 + 100*0.2 = 69.6 → 70
    expect(report.missionQuality).toBe(70);
    expect(
      report.systemScore.dimensions.some((d) => d.name === 'Lineage Health'),
    ).toBe(true);
  });

  it('无 lineage → missionQuality 保持原分（中性，不惩罚，不触发 low_score）', () => {
    const bus = new EventBus();
    const lows: MorPexEvent[] = [];
    bus.on('evaluation.low_score', (e) => lows.push(e));

    const engine = new EvaluationEngine(bus);
    const report = engine.evaluate(midInput());

    expect(report.lineageHealth).toBeUndefined();
    expect(report.missionQuality).toBe(62);
    expect(lows).toHaveLength(0);
  });

  it('低血缘（全部 draft 孤立）→ 总分被拉低 + low_score 携带 lineageScore=0', () => {
    const g = new ArtifactGraph();
    g.addNode(makeNode('x', 'draft'));
    g.addNode(makeNode('y', 'draft')); // 无边 → 双双孤立

    const bus = new EventBus();
    const lows: MorPexEvent[] = [];
    const scoreds: MorPexEvent[] = [];
    bus.on('evaluation.low_score', (e) => lows.push(e));
    bus.on('evaluation.scored', (e) => scoreds.push(e));

    const engine = new EvaluationEngine(bus);
    const report = engine.evaluate({ ...midInput(), lineage: { graph: g, artifactIds: ['x', 'y'] } });

    // lineage.score = 0（committedRatio=0, orphanRatio=1）→ 62*0.8 + 0 = 49.6 → 50 → 0.50 < 0.6
    expect(report.lineageHealth!.score).toBe(0);
    expect(report.missionQuality).toBe(50);
    expect(lows).toHaveLength(1);
    expect(lows[0].payload.lineageScore).toBe(0);
    expect(scoreds[0].payload.lineageScore).toBe(0);
  });
});
