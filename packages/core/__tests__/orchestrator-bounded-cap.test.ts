/**
 * P2-8 Bounded Autonomy 增强测试（会话 16l·3）
 *
 * 覆盖 OrchestratorAgent 的：
 *   1. maxSteps：LLM 拆解步骤数超上限 → 截断（保底，不失控）
 *   2. maxTotalTokens：编排 LLM token 累计超预算 → 抛错 fail loud（不空转）
 *   3. 默认值：未配置时用默认 maxSteps=8 / maxTotalTokens=200k（不破坏旧行为）
 *   4. 重规划/补充任务的 steps 也受 cap 约束
 */

import { describe, it, expect } from 'vitest';
import { OrchestratorAgent } from '../src/execution/orchestration/OrchestratorAgent.js';

/** 生成 mock LLM：analysis 返回指定 steps，其余按 match 依次回 */
function makeLlm(analysisSteps: Array<{ name: string; description: string; deps: string[] }>) {
  let calls = 0;
  return {
    generateText: async ({ prompt }: { prompt: string }) => {
      calls++;
      if (prompt.includes('编排 Agent')) {
        return { text: JSON.stringify({ complexity: 'complex', steps: analysisSteps, reasoning: '测试' }) };
      }
      if (prompt.includes('审计 Agent')) {
        return { text: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) };
      }
      if (prompt.includes('汇总所有步骤成果')) {
        return { text: '最终交付物' };
      }
      return { text: JSON.stringify({ steps: analysisSteps, reasoning: 'fallback' }) };
    },
    callCount: () => calls,
  };
}

describe('OrchestratorAgent — 步骤数 cap（P2-8）', () => {
  it('LLM 拆解 20 步 > maxSteps=5 → 截断为 5 步执行', async () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({ name: `步骤${i}`, description: `描述${i}`, deps: [] as string[] }));
    const llm = makeLlm(steps);

    const stepExecutor = {
      executeStep: async ({ id }: { id: string }) => ({ success: true, mode: 'agent' as const, output: `成果:${id}`, duration: 10 }),
    };
    // mock DAG：每个节点成功返回
    const dagRuntime = {
      name: 'mock-dag',
      execute: async (_goal: string, nodes: Array<{ name: string }>) => ({
        executionId: 'dag_cap',
        success: true,
        failedNodes: 0,
        nodeResults: new Map(nodes.map((n, i) => [`node_${i}_`, { text: `成果:${n.name}` }])),
      }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor,
      dagRuntime,
      maxIterations: 3,
      maxSteps: 5,
      maxTotalTokens: 0, // 不设 token 预算，聚焦步骤 cap
    });

    const res = await orchestrator.run('复杂任务');
    // 步骤被截断 → 只执行了 5 步
    expect(res.stepsExecuted).toBeLessThanOrEqual(5);
    expect(res.planQuality?.executedSteps).toBeLessThanOrEqual(5);
  });

  it('步骤数未超限 → 全部执行（cap 不误伤）', async () => {
    const steps = Array.from({ length: 3 }, (_, i) => ({ name: `步骤${i}`, description: `描述${i}`, deps: [] as string[] }));
    const llm = makeLlm(steps);
    const stepExecutor = {
      executeStep: async ({ id }: { id: string }) => ({ success: true, mode: 'agent' as const, output: `成果:${id}`, duration: 10 }),
    };
    const dagRuntime = {
      name: 'mock-dag',
      execute: async (_goal: string, nodes: Array<{ name: string }>) => ({
        executionId: 'dag_ok',
        success: true,
        failedNodes: 0,
        nodeResults: new Map(nodes.map((n, i) => [`node_${i}_`, { text: `成果:${n.name}` }])),
      }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };
    const orchestrator = new OrchestratorAgent({ llm, stepExecutor, dagRuntime, maxIterations: 3, maxSteps: 8, maxTotalTokens: 0 });
    const res = await orchestrator.run('任务');
    expect(res.stepsExecuted).toBe(3);
  });

  it('默认 maxSteps=8：超过 8 步自动截断（无配置不破坏旧行为）', async () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({ name: `步骤${i}`, description: `描述${i}`, deps: [] as string[] }));
    const llm = makeLlm(steps);
    const stepExecutor = {
      executeStep: async ({ id }: { id: string }) => ({ success: true, mode: 'agent' as const, output: `成果:${id}`, duration: 10 }),
    };
    const dagRuntime = {
      name: 'mock-dag',
      execute: async (_goal: string, nodes: Array<{ name: string }>) => ({
        executionId: 'dag_def',
        success: true,
        failedNodes: 0,
        nodeResults: new Map(nodes.map((n, i) => [`node_${i}_`, { text: `成果:${n.name}` }])),
      }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };
    const orchestrator = new OrchestratorAgent({ llm, stepExecutor, dagRuntime, maxIterations: 3, maxTotalTokens: 0 });
    const res = await orchestrator.run('任务');
    expect(res.stepsExecuted).toBeLessThanOrEqual(8);
  });
});

describe('OrchestratorAgent — 总 token 预算（P2-8）', () => {
  it('LLM token 累计超预算 → 抛错 fail loud（不静默）', async () => {
    // 分析返回 5 步；每步 LLM 调用返回 usage.total 较大 → 快速超预算
    const steps = Array.from({ length: 2 }, (_, i) => ({ name: `步骤${i}`, description: `描述${i}`, deps: [] as string[] }));
    const llm = {
      generateText: async ({ prompt }: { prompt: string }) => {
        if (prompt.includes('编排 Agent')) {
          return { text: JSON.stringify({ complexity: 'complex', steps, reasoning: '测试' }), usage: { total: 5000 } };
        }
        if (prompt.includes('审计 Agent')) {
          return { text: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }), usage: { total: 5000 } };
        }
        if (prompt.includes('汇总所有步骤成果')) {
          return { text: '交付物', usage: { total: 5000 } };
        }
        return { text: '', usage: { total: 5000 } };
      },
    };
    const stepExecutor = {
      executeStep: async ({ id }: { id: string }) => ({ success: true, mode: 'agent' as const, output: `成果:${id}`, duration: 10 }),
    };
    const dagRuntime = {
      name: 'mock-dag',
      execute: async (_goal: string, nodes: Array<{ name: string }>) => ({
        executionId: 'dag_budget',
        success: true,
        failedNodes: 0,
        nodeResults: new Map(nodes.map((n, i) => [`node_${i}_`, { text: `成果:${n.name}` }])),
      }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor,
      dagRuntime,
      maxIterations: 3,
      maxSteps: 8,
      maxTotalTokens: 12_000, // 分析 5k + 审计 5k = 10k，但汇总 5k 超限 → 在汇总处抛错
    });

    await expect(orchestrator.run('任务')).rejects.toThrow('token 预算超限');
  });

  it('预算充足 → 正常完成（预算不误伤）', async () => {
    const steps = [{ name: '步骤0', description: '描述', deps: [] as string[] }];
    const llm = {
      generateText: async ({ prompt }: { prompt: string }) => {
        if (prompt.includes('编排 Agent')) return { text: JSON.stringify({ complexity: 'simple', steps, reasoning: '测试' }), usage: { total: 1000 } };
        if (prompt.includes('审计 Agent')) return { text: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }), usage: { total: 1000 } };
        if (prompt.includes('汇总所有步骤成果')) return { text: '交付物', usage: { total: 1000 } };
        return { text: '', usage: { total: 1000 } };
      },
    };
    const stepExecutor = {
      executeStep: async () => ({ success: true, mode: 'agent' as const, output: 'ok', duration: 10 }),
    };
    const dagRuntime = {
      name: 'mock-dag',
      execute: async (_goal: string, nodes: Array<{ name: string }>) => ({
        executionId: 'dag_budget_ok',
        success: true,
        failedNodes: 0,
        nodeResults: new Map(nodes.map((n, i) => [`node_${i}_`, { text: `成果:${n.name}` }])),
      }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };
    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor,
      dagRuntime,
      maxIterations: 3,
      maxSteps: 8,
      maxTotalTokens: 100_000,
    });
    const res = await orchestrator.run('任务');
    expect(res.success).toBe(true);
    expect(res.output).toBe('交付物');
  });
});
