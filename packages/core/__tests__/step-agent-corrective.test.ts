/**
 * StepAgentExecutor 空内容纠正性重试测试（会话 9：不能关思考模式 → 重试兜底）
 *
 * GLM 思考模式下：工具错误后下一轮常只输出 reasoning_content、content 为空
 * （extractText 判空）。此前直接降级 fallback → 任务失败率 19/99。
 * 修复：空内容时带纠正指令重试（默认 1 次），模型补全参数重新调用或直接给交付摘要。
 *
 * 覆盖：
 *   - 空内容 → 纠正性重试 → 重试产出文本 → 恢复成功（mode=agent）
 *   - 空内容 → 重试仍空 → 降级 fallback
 *   - correctiveRetries=0 → 不重试直接降级
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock agentSpawner：可脚本化每次 prompt 的返回内容
const spawnMock = vi.fn();
vi.mock('../src/infrastructure/adapters/agent-spawner.js', () => ({
  agentSpawner: {
    spawn: (params: unknown) => spawnMock(params),
  },
}));

import { StepAgentExecutor } from '../src/execution/runtime/dag/StepAgentExecutor.js';

function makeAgent(responses: Array<{ content: Array<{ type: string; text?: string }> }>) {
  let i = 0;
  return {
    prompt: async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
    abort: async () => {},
  };
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe('StepAgentExecutor — 空内容纠正性重试（会话 9）', () => {
  it('空内容 → 纠正性重试 → 重试产出文本 → 恢复成功（mode=agent）', async () => {
    spawnMock.mockResolvedValue(makeAgent([
      { content: [] },                                   // 首次：思考模式空 content
      { content: [{ type: 'text', text: '## 交付摘要\n完成。' }] }, // 纠正重试：产出文本
    ]));
    const executor = new StepAgentExecutor({ timeoutMs: 10000 });
    const res = await executor.executeStep({ id: 's1', name: 's1', description: '做某事', agentType: 'general' });

    expect(res.success).toBe(true);
    expect(res.mode).toBe('agent');
    expect((res.output as { text: string }).text).toContain('交付摘要');
    expect(spawnMock).toHaveBeenCalledTimes(1); // 同一个 agent，prompt 调 2 次（首次+纠正）
  });

  it('空内容 → 重试仍空 → 降级 fallback（不无限重试）', async () => {
    spawnMock.mockResolvedValue(makeAgent([
      { content: [] },
      { content: [] }, // 纠正重试仍空
      { content: [] },
    ]));
    let fallbackCalled = false;
    const executor = new StepAgentExecutor({
      timeoutMs: 10000,
      correctiveRetries: 1, // 只重试 1 次
      fallbackExecutor: async () => { fallbackCalled = true; return { fallback: true }; },
    });
    const res = await executor.executeStep({ id: 's2', name: 's2', description: 'x', agentType: 'general' });

    expect(res.success).toBe(true);
    expect(res.mode).toBe('fallback');
    expect(fallbackCalled).toBe(true);
  });

  it('correctiveRetries=0 → 不重试直接降级', async () => {
    spawnMock.mockResolvedValue(makeAgent([
      { content: [] },
      { content: [{ type: 'text', text: '不应被调用' }] },
    ]));
    let fallbackCalled = false;
    const executor = new StepAgentExecutor({
      timeoutMs: 10000,
      correctiveRetries: 0,
      fallbackExecutor: async () => { fallbackCalled = true; return { fallback: 'fb' }; },
    });
    const res = await executor.executeStep({ id: 's3', name: 's3', description: 'x', agentType: 'general' });

    expect(res.success).toBe(true);
    expect(res.mode).toBe('fallback');
    expect(fallbackCalled).toBe(true);
  });

  it('首次即有文本 → 不触发纠正重试（正常路径）', async () => {
    let promptCount = 0;
    spawnMock.mockResolvedValue({
      prompt: async () => { promptCount++; return { content: [{ type: 'text', text: '正常输出' }] }; },
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 2 });
    const res = await executor.executeStep({ id: 's4', name: 's4', description: 'x', agentType: 'general' });

    expect(res.success).toBe(true);
    expect(promptCount).toBe(1); // 无纠正重试
    expect(res.mode).toBe('agent');
  });
});
