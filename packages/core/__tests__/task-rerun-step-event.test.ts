/**
 * 任务级自动重跑 + 步骤结果事件测试（会话 16c · 3+4）
 *
 * 覆盖：
 *   1. 引擎任务级自动重跑：retryable 失败 → 带失败上下文重跑一次 → 成功（metrics.reran=true）
 *   2. 安全拦截失败 → 不重跑（重跑无效，不浪费成本）
 *   3. maxTaskRerun=0 → 禁用重跑
 *   4. StepAgentExecutor 发射 execution.step.result 事件（观测/学习数据源）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

// ═══ StepAgentExecutor 测试用：mock agentSpawner ═══
vi.mock('../src/infrastructure/adapters/agent-spawner.js', () => ({
  agentSpawner: { spawn: (params: unknown) => spawnMock(params) },
}));
const spawnMock = vi.fn();

describe('UnifiedExecutionEngine — 任务级自动重跑（3+4）', () => {
  it('retryable 失败 → 带失败上下文重跑一次 → 成功（reran=true）', async () => {
    const bus = new EventBus();
    const { UnifiedExecutionEngine } = await import('../src/execution/UnifiedExecutionEngine.js');
    const engine = new UnifiedExecutionEngine(bus);

    let runCount = 0;
    let lastHint: string | undefined;
    engine.setOrchestratorAgent({
      name: 'mock-orch',
      run: async (_goal: string, opts?: { contextHint?: string }) => {
        runCount++;
        lastHint = opts?.contextHint;
        if (runCount === 1) {
          // 首次失败：空参 retryable
          return {
            success: false,
            iterations: 1,
            stepsExecuted: 1,
            auditLog: [{ iteration: 1, pass: false, issues: [], reasoning: 'x' }],
            stepResults: new Map(),
            failureReport: [{ step: '查知识', error: '缺失必需参数 "query"' }],
            duration: 10,
          };
        }
        return { success: true, iterations: 1, stepsExecuted: 1, auditLog: [], stepResults: new Map(), output: { text: '成功' }, duration: 10 };
      },
    });

    const result = await engine.execute({ goal: '生成报告' });
    expect(runCount).toBe(2);
    expect(result.ok).toBe(true);
    expect((result.metrics as { reran?: boolean }).reran).toBe(true);
    expect(lastHint).toContain('缺失必需参数');
  });

  it('安全拦截失败 → 不重跑（重跑无效）', async () => {
    const bus = new EventBus();
    const { UnifiedExecutionEngine } = await import('../src/execution/UnifiedExecutionEngine.js');
    const engine = new UnifiedExecutionEngine(bus);

    let runCount = 0;
    engine.setOrchestratorAgent({
      name: 'mock-orch',
      run: async () => {
        runCount++;
        return {
          success: false,
          iterations: 1,
          stepsExecuted: 1,
          auditLog: [],
          stepResults: new Map(),
          failureReport: [{ step: '写文件', error: 'GateContextRequiredError: 需要 Gate 凭证' }],
          duration: 10,
        };
      },
    });

    const result = await engine.execute({ goal: '写文件' });
    expect(runCount).toBe(1); // 不重跑
    expect(result.ok).toBe(false);
  });

  it('maxTaskRerun=0 → 禁用重跑', async () => {
    const bus = new EventBus();
    const { UnifiedExecutionEngine } = await import('../src/execution/UnifiedExecutionEngine.js');
    const engine = new UnifiedExecutionEngine(bus);

    let runCount = 0;
    engine.setOrchestratorAgent({
      name: 'mock-orch',
      run: async () => {
        runCount++;
        return {
          success: false,
          iterations: 1,
          stepsExecuted: 1,
          auditLog: [],
          stepResults: new Map(),
          failureReport: [{ step: 'x', error: '缺失必需参数 "query"' }],
          duration: 10,
        };
      },
    });

    const result = await engine.execute({ goal: 'x', maxTaskRerun: 0 });
    expect(runCount).toBe(1);
    expect(result.ok).toBe(false);
  });
});

describe('StepAgentExecutor — execution.step.result 事件', () => {
  beforeEach(() => { spawnMock.mockReset(); });

  it('成功/失败均发射步骤结果事件（含质量信号）', async () => {
    const { StepAgentExecutor } = await import('../src/execution/runtime/dag/StepAgentExecutor.js');
    const bus = new EventBus();
    const events: Array<Record<string, unknown>> = [];
    bus.on('execution.step.result', (e: unknown) => events.push(e as Record<string, unknown>));

    // 失败场景
    spawnMock.mockResolvedValue({
      prompt: async () => ({ content: [{ type: 'text', text: '[primitive:shell_execution failed] command 为空' }] }),
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 1, eventBus: bus });
    await executor.executeStep({ id: 's1', name: 's1', description: '跑命令', agentType: 'general' });

    expect(events.length).toBeGreaterThan(0);
    const failEvt = events[0] as { type: string; payload: { success: boolean; errorClass: string; retries: number; nodeName: string } };
    expect(failEvt.type).toBe('execution.step.result');
    expect(failEvt.payload.success).toBe(false);
    expect(failEvt.payload.errorClass).toBe('retryable');
    expect(failEvt.payload.nodeName).toBe('s1');
  });
});
