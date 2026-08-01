/**
 * 评价层测试（L6 Evaluation）— EvaluationEngine + QualityScorer + Ontology 合规 + SafetyMonitor
 *
 * 此前 L6 整层无直接测试引用，本文件补齐：
 *   - QualityScorer.scoreSystem：系统级 5 维加权评分（Plan .25 / Agent .20 / Tool .20 / Output .25 / Memory .10）
 *   - QualityScorer.decide：≥85 continue / ≥65 retry / ≥40 replan / <40 abort
 *   - EvaluationEngine.evaluate：5 维聚合 + 缺省 0.5 + decision 推导
 *   - Ontology 合规：queryScore=0 → 硬门禁 replan + needsHumanReview；引用缺失 → decision 降级 retry
 *   - SafetyMonitor：默认阈值告警 / 自定义阈值 / EventBus 事件广播
 */
import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from '../src/evaluation/EvaluationEngine.js';
import { QualityScorer } from '../src/evaluation/QualityScorer.js';
import { scoreOntologyCompliance } from '../src/evaluation/ontologyCompliance.js';
import { ForcedQueryGuard } from '../src/gate/ForcedQueryGuard.js';
import { SafetyMonitor } from '../src/cognition/SafetyMonitor.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import type { EvaluationInput } from '../src/evaluation/EvaluationEngine.js';

/** 构造"全绿"输入：5 维全部 1.0 → overall 100 → decision continue */
function fullGreenInput(): EvaluationInput {
  return {
    plan: { steps: 10, capabilities: ['code'] },
    agents: [{ name: 'dev', successRate: 1 }],
    tools: [{ name: 'tsc', successCount: 10, failureCount: 0 }],
    artifacts: [{ type: 'code', status: 'APPROVED' }],
    memory: { recallCount: 5, avgRelevance: 1 },
    executionResult: { ok: true, duration: 100, errors: [] },
  };
}

describe('QualityScorer — 系统级 5 维加权评分', () => {
  const scorer = new QualityScorer();

  it('全部维度满分 → overall 100', () => {
    const r = scorer.scoreSystem({
      planQuality: 1, agentQuality: 1, toolQuality: 1,
      outputQuality: 1, memoryQuality: 1,
    });
    expect(r.overall).toBe(100);
    expect(r.dimensions).toHaveLength(5);
  });

  it('全部维度 0.5 → overall 50（加权取整）', () => {
    const r = scorer.scoreSystem({
      planQuality: 0.5, agentQuality: 0.5, toolQuality: 0.5,
      outputQuality: 0.5, memoryQuality: 0.5,
    });
    expect(r.overall).toBe(50);
  });

  it('权重分布：Plan .25 / Agent .20 / Tool .20 / Output .25 / Memory .10', () => {
    const r = scorer.scoreSystem({
      planQuality: 1, agentQuality: 1, toolQuality: 1,
      outputQuality: 1, memoryQuality: 1,
    });
    const w = Object.fromEntries(r.dimensions.map((d) => [d.name, d.weight]));
    expect(w['Plan Quality']).toBe(0.25);
    expect(w['Agent Quality']).toBe(0.20);
    expect(w['Tool Quality']).toBe(0.20);
    expect(w['Output Quality']).toBe(0.25);
    expect(w['Memory Quality']).toBe(0.10);
  });

  it('低于 0.7 的维度产生对应建议', () => {
    const r = scorer.scoreSystem({
      planQuality: 0.5, agentQuality: 1, toolQuality: 1,
      outputQuality: 0.4, memoryQuality: 1,
    });
    expect(r.suggestions.some((s) => s.includes('规划质量偏低'))).toBe(true);
    expect(r.suggestions.some((s) => s.includes('产物质量偏低'))).toBe(true);
  });

  it('任务级 score：5 维评分与建议', () => {
    const r = scorer.score({
      taskSuccessRate: 1, avgLatency: 1000, artifactQuality: 1,
      retryCount: 1, costEfficiency: 1,
    });
    expect(r.dimensions).toHaveLength(5);
    expect(r.suggestions).toHaveLength(0);
    // 成功率 100*0.30 + 延迟 (100-1)*0.15 + 产物 100*0.25 + 重试 (100-20)*0.15 + 成本 100*0.15
    expect(r.overall).toBe(Math.round(100 * 0.30 + 99 * 0.15 + 100 * 0.25 + 80 * 0.15 + 100 * 0.15));
  });

  it('decide 边界：85 continue / 65 retry / 40 replan / <40 abort', () => {
    expect(scorer.decide(85)).toBe('continue');
    expect(scorer.decide(84)).toBe('retry');
    expect(scorer.decide(65)).toBe('retry');
    expect(scorer.decide(64)).toBe('replan');
    expect(scorer.decide(40)).toBe('replan');
    expect(scorer.decide(39)).toBe('abort');
  });
});

describe('EvaluationEngine — 5 维聚合与决策', () => {
  const engine = new EvaluationEngine();

  it('全绿输入 → continue + missionQuality 100', () => {
    const r = engine.evaluate(fullGreenInput());
    expect(r.systemScore.overall).toBe(100);
    expect(r.missionQuality).toBe(100);
    expect(r.decision).toBe('continue');
  });

  it('plan.steps 影响 planQuality：steps=3 → planQuality 0.3', () => {
    const r = engine.evaluate({
      plan: { steps: 3, capabilities: [] },
      agents: [{ name: 'a', successRate: 1 }],
      tools: [{ name: 't', successCount: 10, failureCount: 0 }],
      artifacts: [{ type: 'code', status: 'APPROVED' }],
      memory: { recallCount: 1, avgRelevance: 1 },
    });
    // planQuality=0.3 → 整体下降，decision 不应为 continue
    expect(r.decision).not.toBe('continue');
  });

  it('agents 取平均 successRate', () => {
    const r = engine.evaluate({
      agents: [{ name: 'a', successRate: 0.8 }, { name: 'b', successRate: 0.6 }],
    });
    // agentQuality = 0.7；其他维缺省 0.5 → overall = 0.7*100*0.20 + 0.5*100*0.8 = 14 + 40 = 54
    expect(r.systemScore.overall).toBe(Math.round(14 + 40));
  });

  it('tools 按成功占比聚合，失败工具拉低 toolQuality', () => {
    const r = engine.evaluate({
      tools: [{ name: 'ok', successCount: 8, failureCount: 2 }, { name: 'bad', successCount: 0, failureCount: 10 }],
    });
    // toolQuality = (0.8 + 0)/2 = 0.4
    const dim = r.systemScore.dimensions.find((d) => d.name === 'Tool Quality');
    expect(dim!.score).toBe(40);
  });

  it('artifacts 仅 APPROVED/RELEASED 计入 outputQuality', () => {
    const r = engine.evaluate({
      artifacts: [
        { type: 'code', status: 'APPROVED' },
        { type: 'code', status: 'DRAFT' },
        { type: 'doc', status: 'RELEASED' },
        { type: 'doc', status: 'FAILED' },
      ],
    });
    // outputQuality = 2/4 = 0.5
    const dim = r.systemScore.dimensions.find((d) => d.name === 'Output Quality');
    expect(dim!.score).toBe(50);
  });

  it('空输入缺省各维 0.5 → overall 50 → decision replan（50 在 [40,65) 区间）', () => {
    const r = engine.evaluate({});
    expect(r.systemScore.overall).toBe(50);
    expect(r.decision).toBe('replan');
  });
});

describe('EvaluationEngine — Ontology 合规评分与硬门禁', () => {
  const engine = new EvaluationEngine();

  it('未执行查询 → queryScore=0 → 强制 replan + needsHumanReview + missionQuality 0', () => {
    const guard = new ForcedQueryGuard();
    const r = engine.evaluate({
      ...fullGreenInput(),
      ontologyCompliance: { guard, executionId: 'exe_noquery', referencedIds: [] },
    });
    expect(r.ontologyCompliance!.queryScore).toBe(0);
    expect(r.needsHumanReview).toBe(true);
    expect(r.decision).toBe('replan');
    expect(r.missionQuality).toBe(0);
  });

  it('已查询 + 引用全部有效 → queryScore 1 / referenceScore 1 / 不降级', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('exe_ok', 'ontology_query', {}, { id: 'obj_known' });
    const r = engine.evaluate({
      ...fullGreenInput(),
      ontologyCompliance: { guard, executionId: 'exe_ok', referencedIds: ['obj_known'] },
    });
    expect(r.ontologyCompliance!.queryScore).toBe(1);
    expect(r.ontologyCompliance!.referenceScore).toBe(1);
    expect(r.ontologyCompliance!.missingIds).toEqual([]);
    expect(r.needsHumanReview).toBe(false);
    expect(r.decision).toBe('continue');
  });

  it('引用含缺失 ID → needsHumanReview + decision 降级 retry', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('exe_missing', 'ontology_query', {}, { id: 'obj_known' });
    const r = engine.evaluate({
      ...fullGreenInput(),
      ontologyCompliance: { guard, executionId: 'exe_missing', referencedIds: ['obj_known', 'obj_ghost'] },
    });
    expect(r.ontologyCompliance!.referenceScore).toBe(0);
    expect(r.ontologyCompliance!.missingIds).toEqual(['obj_ghost']);
    expect(r.needsHumanReview).toBe(true);
    // 全绿本来 continue，因引用缺失降为 retry
    expect(r.decision).toBe('retry');
  });

  it('QueryMiss：查了但无检索结果 → queryMissDetected + referenceScore 0.2', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('exe_miss', 'ontology_query', {}, {}); // 无 id 可提取
    const r = engine.evaluate({
      ...fullGreenInput(),
      ontologyCompliance: { guard, executionId: 'exe_miss', referencedIds: [] },
    });
    expect(r.ontologyCompliance!.callCount).toBe(1);
    expect(r.ontologyCompliance!.retrievedCount).toBe(0);
    expect(r.ontologyCompliance!.queryMissDetected).toBe(true);
    expect(r.ontologyCompliance!.referenceScore).toBe(0.2);
  });
});

describe('scoreOntologyCompliance — 独立评分函数', () => {
  it('无引用且未查询 → queryScore 0 / referenceScore 0.5（中性）', () => {
    const guard = new ForcedQueryGuard();
    const s = scoreOntologyCompliance(guard, 'exe_a', []);
    expect(s.queryScore).toBe(0);
    expect(s.referenceScore).toBe(0.5);
    expect(s.referencedCount).toBe(0);
  });

  it('引用全部有效 → coverageRatio 1', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('exe_b', 'ontology_query', {}, { objects: [{ id: 'a1' }, { id: 'a2' }] });
    const s = scoreOntologyCompliance(guard, 'exe_b', ['a1', 'a2']);
    expect(s.queryScore).toBe(1);
    expect(s.referenceScore).toBe(1);
    expect(s.coverageRatio).toBe(1);
    expect(s.callCount).toBe(1);
  });

  it('引用部分缺失 → coverageRatio 按有效比例', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('exe_c', 'ontology_query', {}, { id: 'a1' });
    const s = scoreOntologyCompliance(guard, 'exe_c', ['a1', 'a2', 'a3']);
    expect(s.referenceScore).toBe(0);
    expect(s.coverageRatio).toBeCloseTo(1 / 3);
    expect(s.missingIds).toEqual(['a2', 'a3']);
  });
});

describe('SafetyMonitor — 安全阈值监控', () => {
  it('默认阈值：成功率低于 0.7 → WARNING metric_anomaly', () => {
    const sm = new SafetyMonitor();
    const obs = sm.observe({ taskSuccessRate: 0.5 });
    expect(obs).toHaveLength(1);
    expect(obs[0].type).toBe('metric_anomaly');
    expect(obs[0].severity).toBe('WARNING');
    expect(obs[0].metric).toBe('task_success_rate');
  });

  it('默认阈值：重试率高于 0.3 → CRITICAL failure_spike', () => {
    const sm = new SafetyMonitor();
    const obs = sm.observe({ retryRate: 0.5 });
    expect(obs[0].severity).toBe('CRITICAL');
    expect(obs[0].type).toBe('failure_spike');
  });

  it('健康指标不产生告警', () => {
    const sm = new SafetyMonitor();
    const obs = sm.observe({ taskSuccessRate: 0.9, avgLatency: 5000, retryRate: 0.1, artifactQuality: 0.9 });
    expect(obs).toHaveLength(0);
  });

  it('setThreshold 自定义阈值后触发告警', () => {
    const sm = new SafetyMonitor();
    sm.setThreshold('avg_latency_ms', 1000);
    const obs = sm.observe({ avgLatency: 2000 });
    expect(obs[0].metric).toBe('avg_latency');
    expect(obs[0].threshold).toBe(1000);
  });

  it('getRecent 倒序返回 + getCritical 过滤 CRITICAL', () => {
    const sm = new SafetyMonitor();
    sm.observe({ taskSuccessRate: 0.5 });  // WARNING
    sm.observe({ retryRate: 0.9 });        // CRITICAL
    sm.observe({ taskSuccessRate: 0.4 });  // WARNING
    const recent = sm.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].metric).toBe('task_success_rate'); // 最新在前
    expect(sm.getCritical()).toHaveLength(1);
    expect(sm.getCritical()[0].type).toBe('failure_spike');
  });

  it('注入 EventBus：告警广播为 safety.warning 事件', () => {
    const bus = new EventBus();
    const sm = new SafetyMonitor(bus);
    sm.observe({ taskSuccessRate: 0.4 });
    const history = bus.getHistory();
    expect(history.some((h) => h.type === 'safety.warning')).toBe(true);
  });

  it('setThreshold 可放宽默认阈值使不再告警', () => {
    const sm = new SafetyMonitor();
    sm.setThreshold('task_success_rate', 0.2);
    const obs = sm.observe({ taskSuccessRate: 0.5 });
    expect(obs).toHaveLength(0);
  });
});
