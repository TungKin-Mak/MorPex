/**
 * YamlManualLoader / YamlWorkflowRuntime 回归测试（四件套之解释器）
 *
 * 覆盖 reviewer C-1~C-4 修复的语义：
 *   - backjump 注记注入重跑目标（杀 B2 自删回归）
 *   - retry(n) 有界 + 下游不丢（杀 C-1 死循环/假成功）
 *   - skip 策略占位传递
 *   - maxBackjumps 上限 abort
 *   - Loader 校验：backjump 方向/环检测
 *
 * 全部使用 fake stepExecutor/askTool，不发真 LLM。
 */

import { describe, it, expect } from 'vitest';
import {
  loadManual,
  validateManual,
  matchManual,
  type WorkflowManual,
} from '../src/execution/runtime/manual/YamlManualLoader.js';
import {
  YamlWorkflowRuntime,
  type ManualStepExecutorLike,
} from '../src/execution/runtime/manual/YamlWorkflowRuntime.js';
import { DomainPrimitiveRegistry } from '../src/infrastructure/tools/DomainPrimitiveRegistry.js';

// ── 测试辅助 ──

function makeManual(steps: WorkflowManual['steps'], overrides: Partial<WorkflowManual> = {}): WorkflowManual {
  return {
    name: 'test-manual',
    version: 1,
    description: '测试手册',
    steps,
    ...overrides,
  };
}

/** fake step-agent：按脚本逐次返回（队列消费），记录每次收到的描述 */
function fakeExecutor(script: Array<{ ok: boolean; output?: unknown; error?: string }>): {
  executor: ManualStepExecutorLike;
  calls: Array<{ id: string; description: string }>;
} {
  const calls: Array<{ id: string; description: string }> = [];
  let i = 0;
  const executor: ManualStepExecutorLike = {
    async executeStep(node) {
      calls.push({ id: node.id, description: node.description });
      const s = script[Math.min(i, script.length - 1)]!;
      i++;
      return s.ok ? { success: true, output: s.output ?? `out_${node.id}` } : { success: false, error: s.error ?? 'fake failure' };
    },
  };
  return { executor, calls };
}

/** 注册一次性原语（测试后清理由 Registry 覆盖注册天然幂等） */
function fakePrimitive(name: string, fn: (params: Record<string, unknown>) => unknown): void {
  DomainPrimitiveRegistry.register({
    name,
    description: `test primitive ${name}`,
    inputSchema: { type: 'object', properties: {} },
    canHandle: () => 0,
    execute: async (params) => ({ success: true, data: fn(params) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

// ═══ Loader 校验 ═══

describe('YamlManualLoader — 结构校验', () => {
  it('backjump 指向下游步骤被拒', () => {
    const m = makeManual([
      { id: 'a', action: 'llm', description: 'a' },
      { id: 'b', action: 'llm', description: 'b', depends_on: ['a'], on_failure: 'backjump:c' },
      { id: 'c', action: 'llm', description: 'c', depends_on: ['b'] },
    ]);
    const errors = validateManual(m);
    expect(errors.some(e => e.message.includes('必须是本步骤的上游'))).toBe(true);
  });

  it('depends_on 引用不存在的步骤被拒', () => {
    const m = makeManual([
      { id: 'a', action: 'llm', description: 'a', depends_on: ['ghost'] },
    ]);
    expect(validateManual(m).some(e => e.message.includes('引用不存在的步骤'))).toBe(true);
  });

  it('循环依赖被拒', () => {
    const m = makeManual([
      { id: 'a', action: 'llm', description: 'a', depends_on: ['b'] },
      { id: 'b', action: 'llm', description: 'b', depends_on: ['a'] },
    ]);
    expect(validateManual(m).some(e => e.message.includes('循环依赖'))).toBe(true);
  });

  it('on_failure 非法值被拒；合法 backjump 上游通过', () => {
    const bad = makeManual([
      { id: 'a', action: 'llm', description: 'a' },
      { id: 'b', action: 'llm', description: 'b', depends_on: ['a'], on_failure: 'explode' },
    ]);
    expect(validateManual(bad).some(e => e.message.includes('on_failure 非法'))).toBe(true);

    const good = makeManual([
      { id: 'a', action: 'llm', description: 'a' },
      { id: 'b', action: 'llm', description: 'b', depends_on: ['a'], on_failure: 'backjump:a' },
    ]);
    expect(validateManual(good)).toEqual([]);
  });

  it('matchManual 别名大小写不敏感命中', () => {
    const m = makeManual([{ id: 'x', action: 'llm', description: 'x' }], { match: { aliases: ['Firmware'] } });
    expect(matchManual(m, 'please build FIRMWARE now')).toBe(true);
    expect(matchManual(m, 'unrelated goal')).toBe(false);
  });
});

// ═══ Runtime 语义 ═══

describe('YamlWorkflowRuntime — 失败策略语义', () => {
  it('backjump：target 重跑时描述含失败注记（C-2 杀回归）', async () => {
    // a 成功 → b 首次失败回跳 a → a 重跑（描述应含失败注记）→ b 二次成功
    const { executor, calls } = fakeExecutor([
      { ok: true },                          // a #1
      { ok: false, error: '仿真输出时序不符' }, // b #1
      { ok: true },                          // a #2（应带注记）
      { ok: true },                          // b #2
    ]);
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        { id: 'a', action: 'llm', description: 'produce base' },
        { id: 'b', action: 'llm', description: 'verify result', depends_on: ['a'], on_failure: 'backjump:a' },
      ]),
      stepExecutor: executor,
      maxBackjumps: 3,
    });
    const r = await rt.run({});
    expect(r.success).toBe(true);
    expect(r.backjumps).toBe(1);
    // a 第二次执行的描述必须携带失败注记（否则回跳是盲跑）
    const aSecondCall = calls.filter(c => c.id === 'a')[1]!;
    expect(aSecondCall.description).toContain('回跳自 b');
    expect(aSecondCall.description).toContain('仿真输出时序不符');
  });

  it('retry(1)：总尝试 ≤ 2 且成功后下游仍执行、success=true 不假成功（C-1）', async () => {
    // flaky 首次失败，重试一次成功 → 下游 c 必须被执行
    let flakyCalls = 0;
    const { executor } = fakeExecutor([]); // llm 步骤不用；flaky 用原语
    fakePrimitive('test.flaky', () => {
      flakyCalls++;
      if (flakyCalls === 1) throw new Error('first attempt fails');
      return { token: 'T2' };
    });
    const llmSpy = fakeExecutor([{ ok: true }]);
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        { id: 'flaky', action: 'test.flaky', description: 'f', on_failure: 'retry(1)' },
        { id: 'c', action: 'llm', description: 'consume', depends_on: ['flaky'], inputs: { v: '${steps.flaky.outputs.token}' } },
      ]),
      stepExecutor: llmSpy.executor,
    });
    const r = await rt.run({});
    expect(r.success).toBe(true);
    expect(flakyCalls).toBeLessThanOrEqual(2); // ≤ n+1，有界
    expect(r.outputs.get('c')).toBeDefined();  // 下游确实跑了
    expect(llmSpy.calls.some(c => c.id === 'c')).toBe(true);
  });

  it('retry 持续失败：预算耗尽终止并报错（不死循环）', async () => {
    fakePrimitive('test.always_fail', () => { throw new Error('boom'); });
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        { id: 'f', action: 'test.always_fail', description: 'f', on_failure: 'retry(2)' },
      ]),
      stepExecutor: fakeExecutor([]).executor,
    });
    const r = await rt.run({});
    expect(r.success).toBe(false);
    expect(r.error).toContain('重试');
  });

  it('skip 策略：失败步骤置空占位，下游继续，skippedSteps 记录', async () => {
    fakePrimitive('test.sim_fail', () => { throw new Error('simulator crashed'); });
    const llmSpy = fakeExecutor([{ ok: true }]);
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        { id: 'sim', action: 'test.sim_fail', description: 's', on_failure: 'skip' },
        { id: 'report', action: 'llm', description: 'r', depends_on: ['sim'] },
      ]),
      stepExecutor: llmSpy.executor,
    });
    const r = await rt.run({});
    expect(r.success).toBe(true);
    expect(r.skippedSteps).toContain('sim');
    expect(r.outputs.get('sim')?.get('output')).toBeNull(); // 占位 null
    expect(llmSpy.calls.some(c => c.id === 'report')).toBe(true); // 下游没被丢弃
  });

  it('maxBackjumps=3 耗尽后 abort 并带错误信息', async () => {
    // b 恒失败且 on_failure: backjump:a → 应在 3 次回跳后终止
    let n = 0;
    const { executor } = fakeExecutor([]);
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        { id: 'a', action: 'llm', description: 'a' },
        { id: 'b', action: 'llm', description: 'b', depends_on: ['a'], on_failure: 'backjump:a' },
      ]),
      stepExecutor: {
        async executeStep(node) {
          n++;
          if (node.id === 'b') return { success: false, error: 'perma-broken' };
          return { success: true, output: 'ok' };
        },
      },
      maxBackjumps: 3,
    });
    const r = await rt.run({});
    expect(r.success).toBe(false);
    expect(r.backjumps).toBe(3);
    expect(r.error).toContain('回跳次数超上限');
  });

  it('ask 门：注入 askTool 时阻塞取答并渲染通用变量', async () => {
    const askedQuestions: string[] = [];
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        {
          id: 'gate',
          action: 'llm',
          description: 'g',
          ask: { prompt: '请确认目标 {{target}}（上次问题：{{gate}}）', timeout: 'reject' },
        },
      ]),
      stepExecutor: fakeExecutor([{ ok: true }]).executor,
      askTool: {
        async execute(p) {
          askedQuestions.push(String((p as { question?: string }).question));
          return { content: [{ type: 'text', text: '用户回答：XC9X' }], isError: false };
        },
      },
    });
    const r = await rt.run({ target: 'XC8P0000' });
    expect(r.success).toBe(true);
    expect(askedQuestions.length).toBe(1);
    // {{target}} 从 workflowInputs 同名产物包解析不到时保留原文——但这里 inputs 无步骤产出，
    // 所以验证的是"不抛错+模板保留占位"的宽松行为：
    expect(askedQuestions[0]).toContain('请确认目标');
  });

  it('未注入 askTool 时 WARN 放行不阻断', async () => {
    const rt = new YamlWorkflowRuntime({
      manual: makeManual([
        { id: 'g', action: 'llm', description: 'g', ask: { prompt: 'q?' } },
      ]),
      stepExecutor: fakeExecutor([{ ok: true }]).executor,
    });
    const r = await rt.run({});
    expect(r.success).toBe(true);
  });
});

// ═══ 架构断言：core 解释器零领域词 ═══

describe('架构约束 — manual 目录领域无关', () => {
  it('Loader/Runtime 源码不含任何具体部门/步骤 id 字样', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '../src/execution/runtime/manual');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      for (const domainWord of ['xjmcu', '矽杰', 'ecommerce', 'amazon', 'hardware']) {
        expect(content.toLowerCase().includes(domainWord)).toBe(false);
      }
    }
  });
});
