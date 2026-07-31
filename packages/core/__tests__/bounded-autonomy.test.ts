/**
 * Bounded Autonomy（有界自治）测试 — vNext+ 生产级约束
 *
 * 覆盖：
 *   1. SubAgentFork：任务迭代上限（maxAttempts）→ sub_agent.task.iteration_limit
 *   2. SubAgentFork：舰队成本上限（Cost Ceiling）→ sub_agent.budget.exceeded
 *   3. UnifiedExecutionEngine：maxIterations → execution.budget.exceeded
 *   4. Evaluation：scoreOntologyCompliance 的 QueryMiss 感知（参考覆盖率）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/common/EventBus.js';
import { SubAgentFork } from '../src/execution/SubAgentFork.js';
import { UnifiedExecutionEngine } from '../src/execution/UnifiedExecutionEngine.js';
import { scoreOntologyCompliance } from '../src/evaluation/ontologyCompliance.js';
import { ForcedQueryGuard } from '../src/ontology/ForcedQueryGuard.js';

function collectEvents(bus: EventBus, type: string): unknown[] {
  const events: unknown[] = [];
  bus.on(type, (e) => events.push(e));
  return events;
}

describe('SubAgentFork — 迭代上限（Bounded Autonomy）', () => {
  let bus: EventBus;
  let fork: SubAgentFork;

  beforeEach(() => {
    bus = new EventBus();
    fork = new SubAgentFork(bus, { maxConcurrency: 2 });
  });

  it('执行持续失败时达到 maxAttempts → 任务失败 + iteration_limit 事件，不再空转重试', async () => {
    const iterationEvents = collectEvents(bus, 'sub_agent.task.iteration_limit');

    // 注入一个永远失败的执行引擎
    fork.setExecutionEngine({
      execute: async () => {
        throw new Error('simulated failure');
      },
    });

    const fleet = await fork.spawnFleet('test', [
      { description: '不断失败的任务', capability: 'custom', params: {} },
    ], {
      maxAttempts: 2,
      maxRetries: 10, // 故意给高重试数，验证迭代上限优先于重试
    });

    const finished = await fork.waitForFleet(fleet.id, 10, 10_000);

    const task = finished.tasks[0];
    expect(task.status).toBe('failed');
    expect(task.error).toContain('iteration limit reached (2/2)');
    // 没有空转到 maxRetries
    expect(task.retryCount).toBeLessThan(10);
    expect(iterationEvents.length).toBe(1);
    const evt = iterationEvents[0] as { payload: { attempts: number; maxAttempts: number } };
    expect(evt.payload.attempts).toBe(2);
    expect(evt.payload.maxAttempts).toBe(2);
  });
});

describe('SubAgentFork — 舰队成本上限（Cost Ceiling）', () => {
  it('舰队成本超过 maxCostTokens → 剩余任务被终止 + budget.exceeded 事件', async () => {
    const bus = new EventBus();
    // 顺序执行（并发 1），确保任务 A 完成后成本立即累计，任务 B 尚未开始
    const fork = new SubAgentFork(bus, { maxConcurrency: 1, maxCostTokens: 1 });
    const budgetEvents = collectEvents(bus, 'sub_agent.budget.exceeded');

    // 每次任务完成记 2 token（超过上限 1）
    fork.setCostEstimator(async () => ({ tokens: 2, usd: 0.01 }));
    fork.setExecutionEngine({
      execute: async () => ({ ok: true }),
    });

    const fleet = await fork.spawnFleet('test', [
      { description: 'A', capability: 'custom', params: {} },
      { description: 'B', capability: 'custom', params: {} },
    ], { maxAttempts: 3, maxRetries: 3 });

    const finished = await fork.waitForFleet(fleet.id, 10, 10_000);
    // 任务 A 完成记 2 token > 上限 1 → 任务 B 快速失败，不再空转执行
    expect(budgetEvents.length).toBeGreaterThanOrEqual(1);
    expect(['partial_failed', 'all_failed']).toContain(finished.status);
    expect(finished.tasks[1].status).toBe('failed');
    expect(finished.tasks[1].error).toContain('budget exceeded');
    expect(fork.getFleetCost(fleet.id)?.tokens).toBeGreaterThanOrEqual(1);
  });
});

describe('UnifiedExecutionEngine — maxIterations（有界执行）', () => {
  it('mission 轮询超过 maxIterations → 失败结果 + execution.budget.exceeded 事件', async () => {
    const bus = new EventBus();
    const engine = new UnifiedExecutionEngine(bus);
    const budgetEvents = collectEvents(bus, 'execution.budget.exceeded');

    // 假 MissionRuntime：永不完成
    engine.setMissionRuntime({
      name: 'stuck-runtime',
      start: async () => ({ executionId: 'mission_stuck' }),
      getStatus: () => ({ state: 'running' }),
      cancel: async () => {},
    });

    const result = await engine.execute({
      goal: '永不完成的任务',
      mode: 'mission',
      maxIterations: 2,
      timeoutMs: 60_000,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('[Bounded Autonomy]');
    expect(result.error).toContain('Iteration cap reached');
    expect(budgetEvents.length).toBe(1);
  });
});

describe('Evaluation — Ontology 引用覆盖率 / QueryMiss 感知', () => {
  it('查询执行但未检索到事实 → queryMissDetected=true, referenceScore 降为 0.2', () => {
    const guard = new ForcedQueryGuard();
    // 执行了查询（1 次工具调用）但没有检索到任何对象
    guard.recordToolCall('exec_1', 'ontology_queryObjects', { type: 'Mission' }, []);

    const score = scoreOntologyCompliance(guard, 'exec_1', []);

    expect(score.queryMissDetected).toBe(true);
    expect(score.retrievedCount).toBe(0);
    expect(score.referenceScore).toBe(0.2);
    expect(score.coverageRatio).toBe(0);
  });

  it('有检索事实且引用全部有效 → coverageRatio=1, queryMissDetected=false', () => {
    const guard = new ForcedQueryGuard();
    guard.recordToolCall('exec_2', 'ontology_queryObjects', { type: 'Mission' }, [
      { id: 'obj_1' },
      { id: 'obj_2' },
    ]);

    const score = scoreOntologyCompliance(guard, 'exec_2', ['obj_1', 'obj_2']);

    expect(score.queryMissDetected).toBe(false);
    expect(score.retrievedCount).toBe(2);
    expect(score.referenceScore).toBe(1);
    expect(score.coverageRatio).toBe(1);
  });
});
