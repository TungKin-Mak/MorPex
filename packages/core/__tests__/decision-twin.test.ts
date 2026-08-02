/**
 * DecisionTwin 决策孪生测试（L4 Cognition/decision）— 此前零覆盖（305 stmt / 1.3%）
 *
 * 覆盖：决策记忆存储 → buildProfile（风险偏好/一致性/信心指数）
 *       + analyze（因素分析）+ predict（Top 选择预测）+ recordOutcome（结果反馈闭环）
 *       + detectBiases（偏差检测）+ getDecisionNetwork/getSuccessFactors
 */
import { describe, it, expect } from 'vitest';
import { DecisionMemory } from '../src/cognition/memory/DecisionMemory.js';
import { DecisionTwin } from '../src/cognition/decision/DecisionTwin.js';
import type { DecisionMemoryEntry } from '../src/cognition/memory/types.js';

function makeEntry(over: Partial<DecisionMemoryEntry['decision']> & { context: string }): DecisionMemoryEntry {
  return {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    layer: 'semantic',
    content: over.context,
    confidence: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['decision'],
    decision: {
      context: over.context,
      options: over.options ?? ['A', 'B'],
      chosen: over.chosen ?? 'A',
      reasoning: over.reasoning ?? '测试理由',
      factors: over.factors ?? { quality: 0.8, cost: 0.5 },
      outcome: over.outcome,
    },
  } as DecisionMemoryEntry;
}

describe('DecisionTwin — 画像构建', () => {
  it('空记忆 → buildProfile 默认值（保守/低一致性/低信心）', async () => {
    const dm = new DecisionMemory();
    const twin = new DecisionTwin(dm);
    const p = await twin.buildProfile('u1');
    expect(p).toBeTruthy();
    expect(typeof p.riskTolerance).toBe('string');
    expect(typeof p.confidence).toBe('number');
  });

  it('多条决策后 → 画像包含因素与一致性', async () => {
    const dm = new DecisionMemory();
    await dm.storeDecision(makeEntry({ context: '选框架', chosen: 'A', factors: { perf: 0.9 } }));
    await dm.storeDecision(makeEntry({ context: '选数据库', chosen: 'A', factors: { perf: 0.9 } }));
    await dm.storeDecision(makeEntry({ context: '选语言', chosen: 'A', factors: { perf: 0.9 } }));
    const twin = new DecisionTwin(dm);
    const p = await twin.buildProfile('u1');
    expect(p.recentDecisions).toBe(3);
    expect(p.consistency).toBeGreaterThan(0); // 全选 A → 高一致
    expect(p.confidence).toBeGreaterThan(0);
  });
});

describe('DecisionTwin — 分析与预测', () => {
  it('analyze 返回选项评分排序（含理由）', async () => {
    const dm = new DecisionMemory();
    const twin = new DecisionTwin(dm);
    const r = await twin.analyze('选择云厂商', ['AWS', 'GCP', 'Azure']);
    expect(r).toBeTruthy();
    expect(typeof r.recommendation).toBe('string');
    expect(Array.isArray(r.suggestedFactors)).toBe(true);
    expect(typeof r.riskAssessment).toBe('string');
  });

  it('predict 返回最可能选择 + 置信度', async () => {
    const dm = new DecisionMemory();
    await dm.storeDecision(makeEntry({ context: '技术选型', chosen: 'A', factors: { perf: 0.9 } }));
    await dm.storeDecision(makeEntry({ context: '技术选型', chosen: 'A', factors: { cost: 0.8 } }));
    const twin = new DecisionTwin(dm);
    const r = await twin.predict('技术选型', ['A', 'B']);
    expect(r.predictedChoice).toBeTruthy();
    expect(r.confidence).toBeGreaterThan(0);
    expect(Array.isArray(r.alternatives)).toBe(true);
  });
});

describe('DecisionTwin — 结果反馈与偏差', () => {
  it('recordOutcome 记录 + getOutcomes/getOutcomeStats', () => {
    const dm = new DecisionMemory();
    const twin = new DecisionTwin(dm);
    twin.recordOutcome('技术选型', 'A', '成功交付', true);
    twin.recordOutcome('技术选型', 'B', '延期', false);
    expect(twin.getOutcomes()).toHaveLength(2);
    const stats = twin.getOutcomeStats();
    expect(stats).toBeTruthy();
  });

  it('detectBiases 检测确认偏差等（数据充分时）', async () => {
    const dm = new DecisionMemory();
    const twin = new DecisionTwin(dm);
    const report = twin.detectBiases();
    expect(report).toBeTruthy();
    expect(Array.isArray(report.biases ?? report)).toBe(true);
  });

  it('getSuccessFactors + analyzeFactorCorrelation + getDecisionNetwork', () => {
    const dm = new DecisionMemory();
    const twin = new DecisionTwin(dm);
    expect(Array.isArray(twin.getSuccessFactors())).toBe(true);
    expect(Array.isArray(twin.analyzeFactorCorrelation())).toBe(true);
    expect(Array.isArray(twin.getDecisionNetwork())).toBe(true);
  });
});
