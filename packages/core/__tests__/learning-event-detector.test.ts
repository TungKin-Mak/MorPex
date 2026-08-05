/**
 * 经验沉淀触发条件测试（会话 16c · 3+4）
 *
 * 覆盖：
 *   1. LearningEventDetector：空参模式 / 安全拦截 / 高重试 / 部分失败识别
 *   2. ExperienceMiner：mineFromCompletedTask 识别可学习事件 → 发射 evolution.experience.mined + 内存记录
 *   3. 空参模式是重点（79.4% 成功率瓶颈主因）
 */

import { describe, it, expect } from 'vitest';
import { LearningEventDetector } from '../src/evolution/LearningEventDetector.js';
import { ExperienceMiner } from '../src/evolution/ExperienceMiner.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

describe('LearningEventDetector — 可学习事件识别', () => {
  it('空参模式：缺失必需参数 / Validation failed / 为空 → empty-param', () => {
    const events = LearningEventDetector.detect({
      failureReport: [
        { step: '查知识', error: '缺失必需参数 "query"，请【重新调用】knowledge' },
        { step: '跑命令', error: 'Validation failed for tool "shell"' },
      ],
      capabilities: ['Backend Development'],
    });
    expect(events.filter(e => e.type === 'empty-param')).toHaveLength(2);
    expect(events.every(e => e.capability === 'Backend Development')).toBe(true);
    expect(events[0].step).toBe('查知识');
  });

  it('安全拦截：GateContextRequiredError → safety-block（重试无效）', () => {
    const events = LearningEventDetector.detect({
      failureReport: [{ step: '写文件', error: 'GateContextRequiredError: 需要 Gate 凭证' }],
      capabilities: ['Firmware Development'],
    });
    expect(events[0].type).toBe('safety-block');
  });

  it('高重试：totalRetries >= 2 → high-retry', () => {
    const events = LearningEventDetector.detect({
      stepStats: { totalSteps: 1, failedSteps: 0, retryableFails: 0, nonRetryableFails: 0, totalRetries: 3 },
    });
    expect(events.some(e => e.type === 'high-retry')).toBe(true);
  });

  it('部分失败兜底：非空参/非安全拦截 → partial-failure', () => {
    const events = LearningEventDetector.detect({
      failureReport: [{ step: '实现', error: 'LLM 返回空内容' }],
      capabilities: ['Frontend Development'],
    });
    // 空内容算空参模式（未产出有效结果）
    expect(events[0].type).toBe('empty-param');
  });

  it('summarize：按类型聚合', () => {
    const summary = LearningEventDetector.summarize([
      { type: 'empty-param', capability: 'c', detail: 'x', timestamp: 1 },
      { type: 'empty-param', capability: 'c', detail: 'y', timestamp: 2 },
      { type: 'safety-block', capability: 'c', detail: 'z', timestamp: 3 },
    ]);
    expect(summary['empty-param']).toBe(2);
    expect(summary['safety-block']).toBe(1);
  });
});

describe('ExperienceMiner — 可学习事件产出 + 事件', () => {
  it('有可学习事件 → 返回事件 + 发射 evolution.experience.mined', async () => {
    const bus = new EventBus();
    let emitted: unknown;
    bus.on('evolution.experience.mined', (e: unknown) => { emitted = e; });
    const miner = new ExperienceMiner(bus);

    const events = await miner.mineFromCompletedTask({
      goal: '生成电商价格检查方案',
      taskId: 'task-1',
      result: 'failure',
      capabilities: ['Backend Development'],
      departmentId: 'ecommerce',
      failureReport: [{ step: '查知识', error: '缺失必需参数 "query"，请【重新调用】knowledge' }],
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('empty-param');
    expect(miner.getEvents().length).toBe(events.length);
    expect(emitted).toBeDefined();
    expect((emitted as { payload?: { events?: unknown[] } }).payload?.events).toHaveLength(1);
  });

  it('无失败信号 → 无事件不发射（不打扰）', async () => {
    const bus = new EventBus();
    let emittedCount = 0;
    bus.on('evolution.experience.mined', () => { emittedCount++; });
    const miner = new ExperienceMiner(bus);

    const events = await miner.mineFromCompletedTask({
      goal: '查询商品',
      taskId: 'task-2',
      result: 'success',
      capabilities: ['Amazon Listing'],
    });

    expect(events).toHaveLength(0);
    expect(emittedCount).toBe(0);
  });

  it('无 eventBus → 不发射（容错）', async () => {
    const miner = new ExperienceMiner();
    const events = await miner.mineFromCompletedTask({
      goal: '生成报告',
      taskId: 'task-3',
      result: 'failure',
      failureReport: [{ step: 's', error: '缺失必需参数 "query"' }],
    });
    expect(events).toHaveLength(1);
  });
});
