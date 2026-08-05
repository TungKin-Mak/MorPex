/**
 * StepAgentExecutor 空内容纠正性重试测试（会话 9 · 会话 15 去兜底化修订）
 *
 * GLM/opencode 思考模式下：工具错误后下一轮常只输出 reasoning_content、content 为空
 * （extractText 判空）。此前直接降级 fallback → 任务失败率 19/99。
 * 修复：空内容时带纠正指令重试（默认 1 次），模型补全参数重新调用或直接给交付摘要。
 *
 * 会话 15 去兜底化：重试仍空 → 失败返回（不再降级 fallback，fail loud）。
 *
 * 覆盖：
 *   - 空内容 → 纠正性重试 → 重试产出文本 → 恢复成功（mode=agent）
 *   - 空内容 → 重试仍空 → 失败返回（不无限重试，不降级）
 *   - correctiveRetries=0 → 不重试直接失败
 *   - 无上游成果时 prompt 输入不注入垃圾上下文（替代原 agentDisabled 断言）
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

  it('空内容 → 重试仍空 → 失败返回（不无限重试，会话 15 不再降级 fallback）', async () => {
    spawnMock.mockResolvedValue(makeAgent([
      { content: [] },
      { content: [] }, // 纠正重试仍空
      { content: [] },
    ]));
    const executor = new StepAgentExecutor({
      timeoutMs: 10000,
      correctiveRetries: 1, // 只重试 1 次
    });
    const res = await executor.executeStep({ id: 's2', name: 's2', description: 'x', agentType: 'general' });

    expect(res.success).toBe(false);
    expect(res.mode).toBe('agent');
    expect(res.error).toContain('空内容');
  });

  it('correctiveRetries=0 → 不重试直接失败', async () => {
    spawnMock.mockResolvedValue(makeAgent([
      { content: [] },
      { content: [{ type: 'text', text: '不应被调用' }] },
    ]));
    const executor = new StepAgentExecutor({
      timeoutMs: 10000,
      correctiveRetries: 0,
    });
    const res = await executor.executeStep({ id: 's3', name: 's3', description: 'x', agentType: 'general' });

    expect(res.success).toBe(false);
    expect(res.mode).toBe('agent');
    expect(res.error).toContain('空内容');
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

  it('无上游成果 → prompt 输入不注入垃圾上下文（保持聚焦）', async () => {
    let receivedInput = '';
    spawnMock.mockResolvedValue({
      prompt: async (input: string) => { receivedInput = input; return { content: [{ type: 'text', text: '完成' }] }; },
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000 });
    await executor.executeStep({ id: 's5', name: 's5', description: 'x', agentType: 'general' });

    expect(receivedInput).not.toContain('上游步骤成果');
    expect(receivedInput).not.toContain('【上游');
  });
});
