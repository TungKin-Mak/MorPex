/**
 * 步骤级重试精细化测试（会话 15 P1-① · ③）
 *
 * 覆盖：
 *   1. classifyStepOutput / classifyStepError 输出分类
 *      - 'retryable'：空内容 / 工具调用失败标记（缺失参数、[primitive:... failed]、Validation failed）
 *      - 'non-retryable'：安全/权限拦截（GateContextRequiredError、需要 Gate 凭证、安全拦截）
 *      - 'none'：正常输出
 *   2. StepAgentExecutor 重试行为：
 *      - 工具失败标记输出 → 纠正性重试（强制重新调用工具）→ 恢复成功 + retries=1
 *      - 安全拦截输出 → 立即失败（不重试，errorClass=non-retryable）
 *      - 空内容 → 重试 → 成功 + retries
 *   3. 步骤级质量信号：retries / errorClass 写入 StepAgentResult
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock agentSpawner：脚本化 prompt 返回
const spawnMock = vi.fn();
vi.mock('../src/infrastructure/adapters/agent-spawner.js', () => ({
  agentSpawner: { spawn: (params: unknown) => spawnMock(params) },
}));

import {
  StepAgentExecutor,
  classifyStepOutput,
  classifyStepError,
} from '../src/execution/runtime/dag/StepAgentExecutor.js';

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

describe('classifyStepOutput / classifyStepError — 输出分类', () => {
  it('空内容 → retryable', () => {
    expect(classifyStepOutput('')).toBe('retryable');
    expect(classifyStepOutput('   ')).toBe('retryable');
  });

  it('工具失败标记 → retryable（可恢复）', () => {
    expect(classifyStepOutput('[primitive:knowledge_query failed] 查询出错')).toBe('retryable');
    expect(classifyStepOutput('缺失必需参数 "query"，请【重新调用】knowledge')).toBe('retryable');
    expect(classifyStepOutput('Validation failed for tool "shell": ...')).toBe('retryable');
  });

  it('安全拦截 → non-retryable（重试无效）', () => {
    expect(classifyStepOutput('GateContextRequiredError: 破坏性操作需要 Gate 凭证')).toBe('non-retryable');
    expect(classifyStepOutput('安全拦截：shell 命令不在白名单')).toBe('non-retryable');
    expect(classifyStepOutput('权限不足，无法执行')).toBe('non-retryable');
  });

  it('正常输出 → none', () => {
    expect(classifyStepOutput('## 交付摘要\n完成。')).toBe('none');
    expect(classifyStepOutput('这是一段正常的结果文本')).toBe('none');
  });

  it('classifyStepError：Gate 错误 → non-retryable，其余 → retryable', () => {
    expect(classifyStepError('GateContextRequiredError: 需要凭证')).toBe('non-retryable');
    expect(classifyStepError('step-agent 执行超时（50ms）')).toBe('retryable');
    expect(classifyStepError('Agent 未产出有效结果')).toBe('retryable');
  });
});

describe('StepAgentExecutor — 分类化重试行为', () => {
  it('工具失败标记输出 → 纠正重试（强制重发）→ 恢复成功，retries=1', async () => {
    let retryInput = '';
    spawnMock.mockResolvedValue({
      prompt: async (input: string) => {
        if (typeof input === 'string' && input.includes('必须【重新调用】')) {
          retryInput = input;
          return { content: [{ type: 'text', text: '## 交付摘要\n完成。' }] };
        }
        return { content: [{ type: 'text', text: '[primitive:knowledge_query failed] query 为空' }] };
      },
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 2 });
    const res = await executor.executeStep({ id: 's1', name: 's1', description: '查知识', agentType: 'general' });

    expect(res.success).toBe(true);
    expect(res.retries).toBe(1);
    expect(res.errorClass).toBe('none');
    // 纠正指令是"强制重新调用工具"（非"直接输出摘要"逃生口）
    expect(retryInput).toContain('必须【重新调用】');
    expect(retryInput).toContain('填全所有必需参数');
  });

  it('安全拦截输出 → 立即失败（不重试），errorClass=non-retryable', async () => {
    let promptCount = 0;
    spawnMock.mockResolvedValue({
      prompt: async () => {
        promptCount++;
        return { content: [{ type: 'text', text: 'GateContextRequiredError: 需要 Gate 凭证' }] };
      },
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 3 });
    const res = await executor.executeStep({ id: 's2', name: 's2', description: '写文件', agentType: 'general' });

    expect(res.success).toBe(false);
    expect(res.errorClass).toBe('non-retryable');
    expect(promptCount).toBe(1); // 未进入重试循环
    expect(res.error).toContain('不可重试');
  });

  it('空内容 → 纠正重试 → 恢复成功，retries=1', async () => {
    spawnMock.mockResolvedValue(makeAgent([
      { content: [] },
      { content: [{ type: 'text', text: '## 交付摘要\n完成。' }] },
    ]));
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 2 });
    const res = await executor.executeStep({ id: 's3', name: 's3', description: 'x', agentType: 'general' });

    expect(res.success).toBe(true);
    expect(res.retries).toBe(1);
  });

  it('重试耗尽仍为工具失败标记 → 失败返回，errorClass=retryable', async () => {
    spawnMock.mockResolvedValue({
      prompt: async () => ({ content: [{ type: 'text', text: '[primitive:shell_execution failed] command 为空' }] }),
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 1 });
    const res = await executor.executeStep({ id: 's4', name: 's4', description: '跑命令', agentType: 'general' });

    expect(res.success).toBe(false);
    expect(res.retries).toBe(1);
    expect(res.errorClass).toBe('retryable');
    expect(res.error).toContain('未产出有效结果');
  });
});
