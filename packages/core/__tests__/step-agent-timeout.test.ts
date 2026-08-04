/**
 * StepAgentExecutor 超时保护测试（优化轮新增）
 *
 * 验证：LLM 挂起（prompt 永不 resolve）时，executeStep 在 timeoutMs 后
 * 走 fallback 降级 + 调用 agent.abort() 清理，不永久卡住。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock agentSpawner：spawn 返回一个 prompt 永不 resolve 的假 agent
const abortSpy = vi.fn(async () => {});
vi.mock('../src/infrastructure/adapters/agent-spawner.js', () => ({
  agentSpawner: {
    spawn: vi.fn(async () => ({
      prompt: () => new Promise(() => { /* 永不 resolve → 触发超时 */ }),
      abort: abortSpy,
    })),
  },
}));

import { StepAgentExecutor } from '../src/execution/runtime/dag/StepAgentExecutor.js';

describe('StepAgentExecutor — 超时保护', () => {
  beforeEach(() => {
    abortSpy.mockClear();
  });

  it('LLM 挂起超时 → 走 fallback 降级 + 调用 abort 清理', async () => {
    let fallbackCalled = false;
    const executor = new StepAgentExecutor({
      timeoutMs: 50,
      fallbackExecutor: async () => { fallbackCalled = true; return { fallback: true }; },
    });

    const res = await executor.executeStep(
      { id: 's1', name: 's1', description: '挂起步骤', agentType: 'general' },
    );

    expect(fallbackCalled).toBe(true);
    expect(res.success).toBe(true);
    expect(res.mode).toBe('fallback');
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('超时后无 fallback → 返回失败（不抛未捕获异常）', async () => {
    const executor = new StepAgentExecutor({ timeoutMs: 50 });
    const res = await executor.executeStep(
      { id: 's2', name: 's2', description: '挂起步骤', agentType: 'general' },
    );
    expect(res.success).toBe(false);
    expect(res.mode).toBe('fallback');
    expect(res.error).toContain('fallbackExecutor');
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });
});
