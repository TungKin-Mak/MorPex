/**
 * 多 Agent 编排框架测试（会话 3 定稿实施）
 *
 * 覆盖：
 *   1. primitiveAgentTools：原语 → AgentTool 桥（execute 真正调用原语）
 *   2. StepAgentExecutor：step-agent 执行（fallback 降级 / 上游成果注入 / 输出提取）
 *   3. DAGRuntime P1：上游成果传递（下游节点 handler 收到依赖节点 output）
 *   4. OrchestratorAgent P2：总大脑（简单直跑 / 复杂 DAG / 审计迭代 / LLM 不可用降级）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomainPrimitiveRegistry } from '../src/infrastructure/tools/DomainPrimitiveRegistry.js';
import type { ActionPrimitive } from '../src/infrastructure/tools/primitives/types.js';
import { createPrimitiveAgentTools } from '../src/infrastructure/tools/primitiveAgentTools.js';
import { mapToolForAgent } from '../src/infrastructure/adapters/agent-spawner.js';
import { StepAgentExecutor, extractText } from '../src/execution/runtime/dag/StepAgentExecutor.js';
import { DAGRuntime } from '../src/execution/runtime/dag/DAGRuntime.js';
import type { ExecutionDAG } from '../src/execution/runtime/dag/types.js';
import { OrchestratorAgent, type OrchestratorStep } from '../src/execution/orchestration/OrchestratorAgent.js';

// ═══ 会话 15（去兜底化）：StepAgentExecutor 不再有 agentDisabled/fallbackExecutor。
//     测试改为 mock agentSpawner 验证真实 agent 路径（成功 / 空内容重试失败）。
const spawnMock = vi.fn();
vi.mock('../src/infrastructure/adapters/agent-spawner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infrastructure/adapters/agent-spawner.js')>();
  return {
    ...actual,
    agentSpawner: { spawn: (params: unknown) => spawnMock(params) },
  };
});

// ── 测试原语（模拟 5 个通用原语）──

function mockPrimitive(name: string, description: string, handler: (params: Record<string, unknown>) => unknown): ActionPrimitive {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    canHandle: () => 0,
    execute: async (params) => ({ success: true, data: handler(params) }),
  };
}

beforeEach(() => {
  // 清理 + 注册测试原语（覆盖真实注册名，避免污染）
  for (const name of ['knowledge_query', 'file_operation', 'shell_execution', 'api_call', 'artifact_generation']) {
    (DomainPrimitiveRegistry as unknown as { primitives: Map<string, unknown> }).primitives.delete(name);
  }
  DomainPrimitiveRegistry.register(mockPrimitive('knowledge_query', '查询知识', (p) => ({ found: true, query: p.query })));
  DomainPrimitiveRegistry.register(mockPrimitive('file_operation', '文件操作', (p) => ({ wrote: p.path })));
  DomainPrimitiveRegistry.register(mockPrimitive('shell_execution', '执行命令', (p) => ({ cmd: p.command })));
  DomainPrimitiveRegistry.register(mockPrimitive('api_call', 'HTTP 调用', (p) => ({ url: p.url })));
  DomainPrimitiveRegistry.register(mockPrimitive('artifact_generation', '产物生成', (p) => ({ spec: p.specification })));
});

describe('primitiveAgentTools — 原语 → AgentTool 桥', () => {
  it('将 5 个通用原语包装为可调用的 AgentTool', async () => {
    const tools = createPrimitiveAgentTools({ departmentId: 'software' });
    expect(tools.length).toBe(5);
    expect(tools.map(t => t.name)).toEqual(['knowledge', 'file', 'shell', 'api', 'artifact']);
    expect(tools[0].description).toContain('知识');
  });

  it('AgentTool.execute 真正调用原语并规范化结果', async () => {
    const tools = createPrimitiveAgentTools({ departmentId: 'software' });
    const knowledgeTool = tools.find(t => t.name === 'knowledge')!;
    const res = await knowledgeTool.execute('tc_1', { query: '架构文档' });
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.content[0].text as string) as { found: boolean; query: string };
    expect(parsed.found).toBe(true);
    expect(parsed.query).toBe('架构文档');
  });

  it('未注册的原语被跳过（不产生空壳工具）', () => {
    (DomainPrimitiveRegistry as unknown as { primitives: Map<string, unknown> }).primitives.delete('api_call');
    const tools = createPrimitiveAgentTools();
    expect(tools.map(t => t.name)).not.toContain('api');
  });

  it('必填参数校验（会话 9）：空参不传原语 → 精确重新调用指引（self-healing）', async () => {
    // 覆盖 knowledge_query 为带 required 的原语，跟踪 execute 是否被调用
    let primitiveCalled = false;
    const requiredPrimitive: ActionPrimitive = {
      name: 'knowledge_query',
      description: '查询知识（必填 query）',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: '自然语言查询' } }, required: ['query'] },
      canHandle: () => 0,
      execute: async (params) => { primitiveCalled = true; return { success: true, data: { called: true, params } }; },
    };
    (DomainPrimitiveRegistry as unknown as { primitives: Map<string, unknown> }).primitives.set('knowledge_query', {
      primitive: requiredPrimitive,
      registeredAt: Date.now(),
    });

    const tools = createPrimitiveAgentTools({ departmentId: 'software' });
    const knowledgeTool = tools.find(t => t.name === 'knowledge')!;

    // 空参调用 → 校验拦截，不调原语，返回可执行指引
    const empty = await knowledgeTool.execute('tc_1', {});
    expect(empty.isError).toBe(true);
    expect(primitiveCalled).toBe(false);
    expect(empty.content[0].text).toContain('缺失必需参数 "query"');
    expect(empty.content[0].text).toContain('重新调用');

    // 完整参数 → 正常执行
    const ok = await knowledgeTool.execute('tc_1', { query: '架构文档' });
    expect(ok.isError).toBe(false);
    expect(primitiveCalled).toBe(true);
  });

  it('validateRequiredParams：空字符串/undefined/空数组均判缺失；无 required 不拦截', async () => {
    const { validateRequiredParams } = await import('../src/infrastructure/tools/primitiveAgentTools.js');
    const schema = { type: 'object', required: ['query'], properties: { query: { type: 'string' } } };
    expect(validateRequiredParams({}, schema)).toHaveLength(1);
    expect(validateRequiredParams({ query: '' }, schema)).toHaveLength(1);
    expect(validateRequiredParams({ query: '  ' }, schema)).toHaveLength(1);
    expect(validateRequiredParams({ query: 'x' }, schema)).toHaveLength(0);
    expect(validateRequiredParams({}, { type: 'object', properties: {} })).toHaveLength(0); // 无 required
  });

  it('knowledge 空 query → 用 step goal 兜底（会话 13 根治：审计 12/40 失败为 query 空）', async () => {
    let receivedParams: Record<string, unknown> = {};
    const requiredPrimitive: ActionPrimitive = {
      name: 'knowledge_query',
      description: '查询知识（必填 query）',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      canHandle: () => 0,
      execute: async (params) => { receivedParams = params; return { success: true, data: { ok: true, params } }; },
    };
    (DomainPrimitiveRegistry as unknown as { primitives: Map<string, unknown> }).primitives.set('knowledge_query', {
      primitive: requiredPrimitive,
      registeredAt: Date.now(),
    });

    // 传 goal → 空参调用时用 goal 兜底，原语成功执行
    const tools = createPrimitiveAgentTools({ departmentId: 'software', goal: '为电商部门生成商品价格合规检查方案' });
    const knowledgeTool = tools.find(t => t.name === 'knowledge')!;
    const res = await knowledgeTool.execute('tc_1', {});
    expect(res.isError).toBe(false); // goal 兜底 → 成功
    expect(receivedParams.query).toBe('为电商部门生成商品价格合规检查方案');

    // 不传 goal → 空参仍报错（安全：无兜底源）
    const toolsNoGoal = createPrimitiveAgentTools({ departmentId: 'software' });
    const kt2 = toolsNoGoal.find(t => t.name === 'knowledge')!;
    const res2 = await kt2.execute('tc_1', {});
    expect(res2.isError).toBe(true);
    expect(res2.content[0].text).toContain('重新调用');
  });

  it('buildMissingParamMessage 含工具专属正确调用示例（会话 13 强化重发指引）', async () => {
    const { buildMissingParamMessage } = await import('../src/infrastructure/tools/primitiveAgentTools.js');
    const shellMsg = buildMissingParamMessage('shell', ['command']);
    expect(shellMsg).toContain('正确示例');
    expect(shellMsg).toContain('"command"');
    const apiMsg = buildMissingParamMessage('api', ['url', 'method']);
    expect(apiMsg).toContain('"url"');
  });

  it('mapToolForAgent 保留工具调用参数（会话 4 审查修复：防参数丢弃回归）', async () => {
    const tools = createPrimitiveAgentTools({ departmentId: 'software' });
    const knowledgeTool = tools.find(t => t.name === 'knowledge')!;

    // 模拟完整链：AgentTool → mapToolForAgent（agent-spawner 内部映射）→ 单参调用
    const mapped = mapToolForAgent(knowledgeTool);
    expect(mapped.name).toBe('knowledge');
    expect(mapped.execute).toBeDefined();

    // AgentToolDescriptor.execute(params) 单参调用 → 原语必须收到完整 params
    const raw = await mapped.execute!({ query: '架构文档' });
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(text) as { content: Array<{ text?: string }> };
    const inner = JSON.parse(parsed.content[0].text as string) as { found: boolean; query: string };
    expect(inner.found).toBe(true);
    expect(inner.query).toBe('架构文档');
  });
});

describe('StepAgentExecutor — step-agent 执行器', () => {
  it('agent 正常输出 → success（mode=agent）', async () => {
    spawnMock.mockResolvedValue({
      prompt: async () => ({ content: [{ type: 'text', text: '## 交付摘要\n完成。' }] }),
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000 });
    const res = await executor.executeStep(
      { id: 'step_b', name: 'step_b', description: '做 B', agentType: 'general' },
      new Map([['step_a', '上游成果 A']]),
    );
    expect(res.success).toBe(true);
    expect(res.mode).toBe('agent');
    expect((res.output as { text: string }).text).toContain('交付摘要');
  });

  it('agent 空内容重试仍空 → 失败返回（不降级 fallback）', async () => {
    spawnMock.mockResolvedValue({
      prompt: async () => ({ content: [] }), // 空内容 + 纠正重试仍空
      abort: async () => {},
    });
    const executor = new StepAgentExecutor({ timeoutMs: 10000, correctiveRetries: 1 });
    const res = await executor.executeStep(
      { id: 's', name: 's', description: 'x', agentType: 'general' },
    );
    expect(res.success).toBe(false);
    expect(res.mode).toBe('agent');
    expect(res.error).toContain('空内容');
  });

  it('extractText 从 content 提取文本', () => {
    expect(extractText([{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }])).toBe('hello\n world');
    expect(extractText(undefined)).toBe('');
  });
});

describe('DAGRuntime — P1 上游成果传递', () => {
  it('下游节点 handler 收到依赖节点的 output（Map<nodeId, output>）', async () => {
    const received: Array<{ nodeId: string; upstreamKeys: string[] }> = [];
    const runtime = new DAGRuntime({
      maxParallel: 4,
      enablePriority: true,
      continueOnFailure: true,
      nodeHandler: async (node, ctx) => {
        const ctxObj = (ctx ?? {}) as { upstreamResults?: Map<string, unknown> };
        received.push({
          nodeId: node.id,
          upstreamKeys: ctxObj.upstreamResults ? [...ctxObj.upstreamResults.keys()] : [],
        });
        return { done: node.id };
      },
    });

    const dag: ExecutionDAG = {
      id: 'dag_test_upstream',
      nodes: [
        { id: 'a', name: 'A', agentType: 'general', description: 'A', deps: [], status: 'pending', priority: 1, retryCount: 0, maxRetries: 0 },
        { id: 'b', name: 'B', agentType: 'general', description: 'B', deps: ['a'], status: 'pending', priority: 1, retryCount: 0, maxRetries: 0 },
      ],
      edges: [{ from: 'a', to: 'b', weight: 1 }],
      status: { totalNodes: 2, totalEdges: 1, mutations: 0, isCyclic: false, canRollback: false, isComplete: false },
      createdAt: Date.now(),
    };

    const result = await runtime.run(dag, { goal: 'test' });

    expect(result.success).toBe(true);
    const bEntry = received.find(r => r.nodeId === 'b');
    expect(bEntry).toBeDefined();
    expect(bEntry!.upstreamKeys).toContain('a');
    const aEntry = received.find(r => r.nodeId === 'a');
    expect(aEntry!.upstreamKeys).toEqual([]);
  });
});

describe('OrchestratorAgent — 总大脑（P2 审计循环）', () => {
  function mockLlm(script: Array<{ match: string; reply: string | (() => string) }>) {
    let idx = 0;
    return {
      generateText: async ({ prompt }: { prompt: string }) => {
        for (const s of script) {
          if (prompt.includes(s.match)) return { text: typeof s.reply === 'function' ? s.reply() : s.reply };
        }
        // 兜底：返回脚本最后一条
        const last = script[Math.min(idx, script.length - 1)];
        idx++;
        return { text: typeof last.reply === 'function' ? last.reply() : last.reply };
      },
    };
  }

  function mockStepExecutor(output: string) {
    return {
      executeStep: async () => ({ success: true, mode: 'agent' as const, output: { text: output }, duration: 1 }),
    };
  }

  function mockDagRuntime(results: Record<string, unknown>) {
    return {
      name: 'mock-dag',
      execute: async (_goal: string, _tasks: unknown[], _ctx?: Record<string, unknown>) => ({
        executionId: 'dag_mock',
        nodeResults: new Map(Object.entries(results)),
      }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };
  }

  it('复杂任务：DAG 分发 → 审计 pass → 汇总交付物', async () => {
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
      { match: '审计 Agent', reply: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) },
      { match: '汇总', reply: '最终交付物：完整实现' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      dagRuntime: mockDagRuntime({ 调研: { text: '调研成果' }, 实现: { text: '实现成果' } }),
      stepExecutor: mockStepExecutor('x'),
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成一个软件系统', { departmentId: 'software' });

    expect(res.success).toBe(true);
    expect(res.iterations).toBe(1);
    expect(res.stepsExecuted).toBe(2);
    expect(res.output).toBe('最终交付物：完整实现');
    expect(res.auditLog[0].pass).toBe(true);
    // DAG 结果合并：实现节点输出
    expect(res.stepResults.get('实现')).toEqual({ text: '实现成果' });
  });

  it('复杂任务：DAG 节点 id 为 node_{i}_{ts}（ServiceContainer wrapper 格式）时按索引正确回填', async () => {
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({
          complexity: 'complex',
          steps: [
            { name: '调研', description: '调研需求', deps: [] },
            { name: '实现', description: '实现功能', deps: ['调研'] },
            { name: '验证', description: '验证结果', deps: ['实现'] },
          ],
          reasoning: '三步',
        }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) },
      { match: '汇总', reply: '汇总' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      dagRuntime: mockDagRuntime({
        'node_0_1785000000000': { text: '调研成果' },
        'node_1_1785000000000': { text: '实现成果' },
        'node_2_1785000000000': { text: '验证成果' },
      }),
      stepExecutor: mockStepExecutor('x'),
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成系统');
    expect(res.success).toBe(true);
    expect(res.stepsExecuted).toBe(3);
    expect(res.stepResults.get('调研')).toEqual({ text: '调研成果' });
    expect(res.stepResults.get('实现')).toEqual({ text: '实现成果' });
    expect(res.stepResults.get('验证')).toEqual({ text: '验证成果' });
  });

  it('审计 fail → 补充任务再分发 → 第二轮 pass（迭代上限内）', async () => {
    let auditCount = 0;
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({
          complexity: 'simple',
          steps: [{ name: '生成', description: '生成报告', deps: [] }],
          reasoning: '单步',
        }),
      },
      {
        match: '审计 Agent',
        reply: () => {
          auditCount++;
          if (auditCount === 1) {
            return JSON.stringify({
              pass: false,
              issues: ['缺少验证'],
              supplementaryTasks: [{ name: '验证', description: '补充验证', deps: [] }],
              reasoning: '需要验证',
            });
          }
          return JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' });
        },
      },
      { match: '汇总', reply: '最终交付物' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: mockStepExecutor('成果'),
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成报告');

    expect(res.iterations).toBe(2);
    expect(res.auditLog.length).toBe(2);
    expect(res.auditLog[0].pass).toBe(false);
    expect(res.auditLog[1].pass).toBe(true);
    expect(res.output).toBe('最终交付物');
    expect(res.stepsExecuted).toBe(2); // 第一轮 1 + 补充 1
  });

  it('简单任务：单 step-agent 直跑（不走 DAG）', async () => {
    let dagCalled = false;
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '查询', description: '查询知识', deps: [] }], reasoning: '一步' }),
      },
      { match: '审计 Agent', reply: JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' }) },
      { match: '汇总', reply: '查询结果汇总' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      dagRuntime: {
        name: 'mock-dag',
        execute: async () => { dagCalled = true; return { executionId: 'x', nodeResults: new Map() }; },
        getStatus: async () => ({ state: 'completed' }),
        cancel: async () => {},
      },
      stepExecutor: mockStepExecutor('知识结果'),
      maxIterations: 3,
    });

    const res = await orchestrator.run('查询知识');
    expect(dagCalled).toBe(false);
    expect(res.success).toBe(true);
    expect(res.stepsExecuted).toBe(1);
  });

  it('LLM 拆解返回非法 JSON → 抛错失败（fail loud，不静默回退单 step）', async () => {
    const llm = mockLlm([
      { match: '总大脑（编排 Agent）', reply: '抱歉，无法解析' },
    ]);
    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: mockStepExecutor('成果'),
      maxIterations: 3,
    });
    // 非法 JSON → run 抛错（由上层转失败），不再降级单 step 直跑
    await expect(orchestrator.run('生成文档')).rejects.toThrow(/无法解析/);
  });
});
