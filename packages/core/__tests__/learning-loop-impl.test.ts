/**
 * learning-loop-impl.test.ts — S22 补全：真实 LearningLoop 实现验证
 *
 * 覆盖：LearningLoop 聚合三件套（extractExperience / evaluatePlan / optimize），
 * 满足 BrainFacade.LearningLoopLike；并验证装配到 BrainFacade 后字段非 null。
 */
import { describe, it, expect } from 'vitest';
import { LearningLoop } from '../src/cognition/learning/LearningLoop.js';
import { BrainFacade } from '../src/cognition/BrainFacade.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

const record = {
  executionId: 'exec_1',
  goal: '构建 REST API',
  planId: 'plan_1',
  success: true,
  duration: 1200,
  errors: [],
  nodes: [
    { id: 'n1', name: '设计', status: 'success', duration: 300 },
    { id: 'n2', name: '实现', status: 'success', duration: 900 },
  ],
};

describe('LearningLoop（S22 补全）', () => {
  it('extractExperience 提取经验（含模式/成功率）', async () => {
    const loop = new LearningLoop();
    const exp = await loop.extractExperience(record);
    expect(exp).not.toBeNull();
    expect(exp?.goal).toBe('构建 REST API');
    expect(exp?.successRate).toBe(1);
    expect(Array.isArray(exp?.patterns)).toBe(true);
  });

  it('evaluatePlan 产出六维评分 + 建议', async () => {
    const loop = new LearningLoop();
    const evalResult = await loop.evaluatePlan({ ...record, planId: 'plan_2' });
    expect(evalResult).not.toBeNull();
    expect(typeof evalResult?.score).toBe('number');
    expect(evalResult?.score).toBeGreaterThanOrEqual(0);
    expect(evalResult?.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(evalResult?.suggestions)).toBe(true);
  });

  it('optimize 基于历史产出优化建议', async () => {
    const loop = new LearningLoop();
    await loop.evaluatePlan({ ...record, planId: 'p1' });
    await loop.evaluatePlan({ ...record, planId: 'p2', success: false, errors: ['timeout'] });
    const suggestions = await loop.optimize([]);
    expect(Array.isArray(suggestions)).toBe(true);
    expect(loop.getStats().evaluations).toBe(2);
  });

  it('装配到 BrainFacade 后 learningLoop 字段非 null', () => {
    const brain = new BrainFacade(new EventBus());
    const loop = new LearningLoop();
    brain.setLearningLoop(loop);
    expect((brain as any).learningLoop).toBe(loop);
    // isReady 应因 learningLoop 变为 true
    expect(brain.isReady()).toBe(true);
  });
});
