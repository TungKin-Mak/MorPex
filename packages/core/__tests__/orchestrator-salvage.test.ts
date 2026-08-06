/**
 * OrchestratorAgent 部分成功 salvage 测试（会话 15 P1-②）
 *
 * 覆盖：
 *   - 单 step 硬失败 → success:false + failureReport（含步骤名与原因）+ 基于成功步骤的降级交付物
 *   - 混合：部分步骤成功、部分失败 → 成功步骤成果仍进 stepResults，失败进 failureReport
 *   - 全步骤成功 → 无 failureReport（正常路径）
 */

import { describe, it, expect } from 'vitest';
import { OrchestratorAgent } from '../src/execution/orchestration/OrchestratorAgent.js';

function mockLlm(script: Array<{ match: string; reply: string | (() => string) }>) {
  let idx = 0;
  return {
    generateText: async ({ prompt }: { prompt: string }) => {
      for (const s of script) {
        if (prompt.includes(s.match)) return { text: typeof s.reply === 'function' ? (s.reply as () => string)() : s.reply };
      }
      const last = script[Math.min(idx, script.length - 1)];
      idx++;
      return { text: typeof last.reply === 'function' ? (last.reply as () => string)() : last.reply };
    },
  };
}

describe('OrchestratorAgent — 部分成功 salvage（P1-②）', () => {
  it('单 step 硬失败 → success:false + failureReport + 降级交付物', async () => {
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '生成报告', description: '生成报告', deps: [] }], reasoning: '单步' }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: false, issues: ['生成失败'], supplementaryTasks: [], reasoning: '步骤失败' }) },
      { match: '汇总', reply: '部分成果：已调研未完成生成' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: {
        executeStep: async () => ({ success: false, mode: 'agent' as const, error: '[primitive:artifact_generation failed] specification 为空', duration: 100 }),
      },
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成报告');

    // 显式失败（非静默伪装成功）
    expect(res.success).toBe(false);
    expect(res.error).toContain('部分步骤失败');
    // 结构化失败报告
    expect(res.failureReport).toHaveLength(1);
    expect(res.failureReport![0].step).toBe('生成报告');
    expect(res.failureReport![0].error).toContain('specification 为空');
    // 仍产出基于成功步骤的降级交付物（显式 partial，非空）
    expect(res.output).toBe('部分成果：已调研未完成生成');
  });

  it('混合成功/失败（DAG）→ 成功节点成果保留 + 失败进报告', async () => {
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({
          complexity: 'complex',
          steps: [
            { name: '调研', description: '调研需求', deps: [] },
            { name: '实现', description: '实现功能', deps: ['调研'] },
          ],
          reasoning: '两步',
        }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: false, issues: ['实现失败'], supplementaryTasks: [], reasoning: '需重做' }) },
      { match: '汇总', reply: '基于调研成果的部分交付' },
    ]);

    // DAG 返回：1 个成功节点 + 整体 failed（含 1 失败节点）
    const orchestrator = new OrchestratorAgent({
      llm,
      dagRuntime: {
        name: 'mock-dag',
        execute: async () => ({
          executionId: 'dag_salvage',
          success: false,
          failedNodes: 1,
          errors: [{ error: '实现节点失败：specification 为空' }],
          nodeResults: new Map(Object.entries({
            'node_0_1785000000000': { text: '调研成果' },
            'node_1_1785000000000': { error: '失败' },
          })),
        }),
        getStatus: async () => ({ state: 'failed' }),
        cancel: async () => {},
      },
      stepExecutor: {
        executeStep: async () => ({ success: true, mode: 'agent' as const, output: { text: 'x' }, duration: 10 }),
      },
      maxIterations: 3,
    });

    const res = await orchestrator.run('混合任务');
    expect(res.success).toBe(false);
    expect(res.failureReport!.length).toBeGreaterThan(0);
    expect(res.failureReport![0].error).toContain('specification 为空');
    // 成功节点成果保留
    expect(res.stepResults.get('调研')).toEqual({ text: '调研成果' });
  });

  it('全步骤成功 → 无 failureReport（正常路径）', async () => {
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '查询', description: '查询知识', deps: [] }], reasoning: '单步' }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) },
      { match: '汇总', reply: '最终交付物' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: {
        executeStep: async () => ({ success: true, mode: 'agent' as const, output: { text: '查询结果' }, duration: 50 }),
      },
      maxIterations: 3,
    });

    const res = await orchestrator.run('查询知识');
    expect(res.success).toBe(true);
    expect(res.failureReport).toBeUndefined();
    expect(res.output).toBe('最终交付物');
    // P2 规划质量：正常路径有 planQuality
    expect(res.planQuality).toBeDefined();
    expect(res.planQuality!.success).toBe(true);
    expect(res.planQuality!.replanned).toBe(false);
  });

  it('P2 动态重规划：步骤失败 + 审计 fail → 触发重规划（replanned=true）并恢复', async () => {
    let replanCalled = false;
    let stepCall = 0;
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '调研', description: '调研需求', deps: [] }], reasoning: '单步' }),
      },
      {
        match: '重新规划', // REPLAN_PROMPT
        reply: () => {
          replanCalled = true;
          return JSON.stringify({ complexity: 'simple', steps: [{ name: '重调研', description: '重新调研（带失败规避）', deps: [] }], reasoning: '重规划' });
        },
      },
      {
        match: '审计 Agent',
        reply: () => {
          if (!replanCalled) return JSON.stringify({ pass: false, issues: ['调研失败'], supplementaryTasks: [], reasoning: '需重做' });
          return JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' });
        },
      },
      { match: '汇总', reply: '重规划后的交付物' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: {
        executeStep: async () => {
          stepCall++;
          // 第一轮（调研）失败 retryable；重规划后（重调研）成功
          if (stepCall === 1) {
            return { success: false, mode: 'agent' as const, error: '缺失必需参数 "query"', duration: 50 };
          }
          return { success: true, mode: 'agent' as const, output: { text: '调研成果' }, duration: 50 };
        },
      },
      maxIterations: 3,
    });

    const res = await orchestrator.run('调研并生成方案');
    expect(replanCalled).toBe(true);
    expect(res.success).toBe(true);
    expect(res.planQuality!.replanned).toBe(true);
    // 重规划恢复：当前计划失败 0（旧失败已被新计划取代）
    expect(res.planQuality!.failedSteps).toBe(0);
    expect(res.output).toBe('重规划后的交付物');
  });
});
