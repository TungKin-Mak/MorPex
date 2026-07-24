/**
 * v13 Brain 模块测试 — ReflectionEngine + MetaLearner
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/common/EventBus.js';
import { ReflectionEngine } from '../src/brain/ReflectionEngine.js';
import { MetaLearner } from '../src/brain/MetaLearner.js';

describe('ReflectionEngine', () => {
  let eventBus: EventBus;
  let engine: ReflectionEngine;

  beforeEach(() => {
    eventBus = new EventBus();
    engine = new ReflectionEngine(eventBus);
  });

  it('空状态返回基础洞察', async () => {
    const result = await engine.reflect({ recentTasks: [] });
    expect(result.insights.length).toBeGreaterThanOrEqual(1);
    expect(result.insights[0].type).toBe('pattern');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('有失败任务返回警告', async () => {
    const result = await engine.reflect({
      recentTasks: [
        { taskId: '1', goal: '测试任务1', result: 'failure', duration: 100 },
        { taskId: '2', goal: '测试任务2', result: 'success', duration: 50 },
      ],
    });
    const warnings = result.insights.filter(i => i.type === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].message).toContain('失败');
  });

  it('LLM 模式降级正确（无 LLM caller 时使用规则模式）', async () => {
    const result = await engine.reflect({
      recentTasks: [
        { taskId: '1', goal: '成功任务', result: 'success', duration: 100 },
      ],
    });
    // 不使用 LLM caller，应返回基于规则的结果
    expect(result.confidence).toBe(0.6);
    expect(result).toHaveProperty('insights');
    expect(result).toHaveProperty('risks');
    expect(result).toHaveProperty('suggestions');
  });
});

describe('MetaLearner', () => {
  let eventBus: EventBus;
  let learner: MetaLearner;

  beforeEach(() => {
    eventBus = new EventBus();
    learner = new MetaLearner(eventBus);
  });

  it('learnFromTask 更新部门模式', async () => {
    const result = await learner.learnFromTask({
      taskId: 'task_1',
      goal: '设计登录模块',
      result: 'success',
      duration: 5000,
      departmentId: 'dept_1',
    });
    expect(result.preferencesUpdated).toBe(false);
    expect(result.patternsLearned).toBeGreaterThanOrEqual(1);
    // 部门模式应存在
    const pattern = learner.getDepartmentPattern('dept_1');
    expect(pattern).toBeDefined();
    expect(pattern!.successRate).toBe(1);
  });

  it('learnFromTask 处理用户反馈', async () => {
    const result = await learner.learnFromTask(
      {
        taskId: 'task_2',
        goal: '优化性能',
        result: 'success',
        duration: 3000,
        planUsed: 'full',
      },
      { rating: 5, comments: '非常好' },
    );
    expect(result.preferencesUpdated).toBe(true);
  });

  it('getDepartmentPattern 返回正确数据', async () => {
    await learner.learnFromTask({
      taskId: 't1', goal: '任务1', result: 'success', duration: 100,
      departmentId: 'dept_2', capabilities: ['code'],
    });
    await learner.learnFromTask({
      taskId: 't2', goal: '任务2', result: 'failure', duration: 200,
      departmentId: 'dept_2', capabilities: ['test'],
    });

    const pattern = learner.getDepartmentPattern('dept_2');
    expect(pattern).toBeDefined();
    expect(pattern!.successRate).toBe(0.5);
    expect(pattern!.commonTasks.length).toBe(2);
  });

  it('getStats 返回汇总信息', async () => {
    const stats = learner.getStats();
    expect(stats).toHaveProperty('totalDepartments');
    expect(stats).toHaveProperty('userFeedbackCount');
    expect(stats).toHaveProperty('preferredMode');
  });
});
