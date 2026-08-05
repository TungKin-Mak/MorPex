/**
 * StepAgentExecutor 超时保护测试（优化轮新增 · 会话 15 去兜底化修订）
 *
 * 验证：LLM 挂起（prompt 永不 resolve）时，executeStep 在 timeoutMs 后
 * 调用 agent.abort() 清理并返回失败（不再降级 fallback——会话 15 移除兜底，fail loud）。
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

  it('LLM 挂起超时 → 失败返回 + 调用 abort 清理（不永久卡住，不降级 fallback）', async () => {
    const executor = new StepAgentExecutor({ timeoutMs: 50 });

    const res = await executor.executeStep(
      { id: 's1', name: 's1', description: '挂起步骤', agentType: 'general' },
    );

    expect(res.success).toBe(false);
    expect(res.mode).toBe('agent');
    expect(res.error).toContain('超时');
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('timeoutMs 未设置 → 不设限（由调用方/上层预算控制）', async () => {
    // 无超时 → prompt 永不 resolve 会永久挂起；此处仅验证超时配置语义（不传 = 不限时）
    const executor = new StepAgentExecutor({});
    expect((executor as unknown as { opts: { timeoutMs?: number } }).opts.timeoutMs).toBeUndefined();
  });
});
