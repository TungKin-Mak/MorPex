/**
 * 执行肢 Gate 凭证解锁测试（会话 4 · ②）
 *
 * 覆盖链路：
 *   OrchestratorAgent.gateRunner（Gate 两阶段签发）
 *     → executeStep stepOpts.gateContext
 *     → createPrimitiveAgentTools({ gateContext })
 *     → 原语 execute context.gateContext（破坏性原语凭有效凭证通过 gateDestructive）
 *
 * 链路两端用真实对象验证：primitiveAgentTools 透传 + orchestrator 签发传递；
 * StepAgentExecutor 的接线为薄直传（gateContext 有则注入工具 options）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomainPrimitiveRegistry } from '../src/infrastructure/tools/DomainPrimitiveRegistry.js';
import type { ActionPrimitive } from '../src/infrastructure/tools/primitives/types.js';
import { createPrimitiveAgentTools } from '../src/infrastructure/tools/primitiveAgentTools.js';
import { OrchestratorAgent } from '../src/execution/orchestration/OrchestratorAgent.js';
import type { KnowledgeContextPackage } from '../src/gate/context.js';
// 编排测试直调 run()：必须显式跳过方案确认门（交互模式会无限等待用户确认，见 PlanGateService 17i.22）
import { setAutoExecute } from '../src/execution/PlanGateService.js';
setAutoExecute(true);

/** 有效 Gate 凭证（模拟 Gate 两阶段签发结果） */
function validGatePackage(): KnowledgeContextPackage {
  return {
    executionId: 'exec_gate_test',
    riskTier: 'tier-1',
    queryCallCount: 2,
    retrievedIds: ['obj_1', 'obj_2'],
    referenceCheck: { valid: true, missing: [], knownCount: 2 },
    issuedAt: Date.now(),
  };
}

// 捕获原语收到的 context.gateContext
let receivedGateContext: unknown = 'NOT_CALLED';
let receivedDept: unknown;

beforeEach(() => {
  receivedGateContext = 'NOT_CALLED';
  receivedDept = undefined;
  const mockPrimitive: ActionPrimitive = {
    name: 'file_operation',
    description: '文件操作（测试 mock）',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    canHandle: () => 0,
    execute: async (_params, context) => {
      receivedGateContext = context?.gateContext;
      receivedDept = context?.departmentId;
      return { success: true, data: { ok: true } };
    },
  };
  // 覆盖真实注册（先删后注，幂等）
  DomainPrimitiveRegistry.unregister('file_operation');
  DomainPrimitiveRegistry.register(mockPrimitive);
});

describe('primitiveAgentTools — Gate 凭证透传', () => {
  it('options.gateContext → 原语 execute context.gateContext（破坏性操作解锁基础）', async () => {
    const pkg = validGatePackage();
    const tools = createPrimitiveAgentTools({ departmentId: 'software', gateContext: pkg });
    const fileTool = tools.find(t => t.name === 'file')!;
    expect(fileTool).toBeDefined();

    const res = await fileTool.execute('tc_1', { path: '/tmp/a.txt' });
    expect(res.isError).toBe(false);
    expect(receivedGateContext).toBe(pkg);
    expect(receivedDept).toBe('software');
  });

  it('未传 gateContext → 原语收到 undefined（破坏性保持硬拦截）', async () => {
    const tools = createPrimitiveAgentTools({ departmentId: 'software' });
    const fileTool = tools.find(t => t.name === 'file')!;
    await fileTool.execute('tc_1', { path: '/tmp/a.txt' });
    expect(receivedGateContext).toBeUndefined();
  });
});

describe('OrchestratorAgent — gateRunner 签发与传递', () => {
  function mockLlm(script: Array<{ match: string; reply: string }>) {
    let idx = 0;
    return {
      generateText: async ({ prompt }: { prompt: string }) => {
        for (const s of script) {
          if (prompt.includes(s.match)) return { text: s.reply };
        }
        const last = script[Math.min(idx, script.length - 1)];
        idx++;
        return { text: last.reply };
      },
    };
  }

  it('gateRunner 调用一次 → step 执行器收到 gateContext（凭证覆盖整个编排）', async () => {
    let gateRunnerCalls = 0;
    let receivedStepOpts: Array<{ gateContext?: unknown }> = [];
    const pkg = validGatePackage();

    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '生成', description: '生成报告', deps: [] }], reasoning: '单步' }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) },
      { match: '汇总', reply: '交付物' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: {
        executeStep: async (_node, _upstream, stepOpts) => {
          receivedStepOpts.push({ gateContext: stepOpts?.gateContext });
          return { success: true, mode: 'agent' as const, output: { text: '成果' }, duration: 1 };
        },
      } as never,
      gateRunner: async (goal, departmentId) => {
        gateRunnerCalls++;
        expect(goal).toContain('生成');
        expect(departmentId).toBe('software');
        return pkg;
      },
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成报告', { departmentId: 'software' });
    expect(res.success).toBe(true);
    expect(gateRunnerCalls).toBe(1);
    expect(receivedStepOpts.length).toBe(1);
    expect(receivedStepOpts[0].gateContext).toBe(pkg);
  });

  it('gateRunner 失败返回 null → 不阻断执行（破坏性操作保持硬拦截，安全降级）', async () => {
    let receivedGate: unknown = 'NOT_CALLED';
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '生成', description: '生成', deps: [] }], reasoning: '单步' }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) },
      { match: '汇总', reply: '交付物' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: {
        executeStep: async (_node, _upstream, stepOpts) => {
          receivedGate = stepOpts?.gateContext;
          return { success: true, mode: 'agent' as const, output: { text: '成果' }, duration: 1 };
        },
      } as never,
      gateRunner: async () => {
        throw new Error('Gate 服务不可用');
      },
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成文档');
    expect(res.success).toBe(true); // 不阻断
    expect(receivedGate).toBeUndefined(); // 凭证缺省 → 破坏性操作维持硬拦截
  });
});
