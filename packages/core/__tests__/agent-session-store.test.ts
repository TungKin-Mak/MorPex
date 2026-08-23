/**
 * AgentSessionStore + 多 Agent Session 化测试（会话 4 · P1 跨会话讨论）
 *
 * 覆盖：
 *   1. AgentSessionStore：create/list/open/appendCustom/fork（JSONL 持久化 + 元数据 + parentSessionPath）
 *   2. StepAgentExecutor + sessionStore：step 会话创建 + step-result 条目 + 上游会话引用进 prompt
 *   3. OrchestratorAgent + sessionStore：总大脑会话（analysis/audit/synthesis）+ stepSessions 追踪 + 依赖链 parentSessionPath
 *
 * 全部使用 os.tmpdir() 临时目录（不污染仓库 data/）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionStore, type AgentSessionHandle } from '../src/execution/orchestration/AgentSessionStore.js';
import { StepAgentExecutor } from '../src/execution/runtime/dag/StepAgentExecutor.js';
import { OrchestratorAgent, type OrchestratorStep } from '../src/execution/orchestration/OrchestratorAgent.js';
// 编排测试直调 run()：必须显式跳过方案确认门（交互模式会无限等待用户确认，见 PlanGateService 17i.22）
import { setAutoExecute } from '../src/execution/PlanGateService.js';
setAutoExecute(true);

// ═══ 会话 15（去兜底化）：StepAgentExecutor 不再有 agentDisabled/fallbackExecutor。
//     测试改为 mock agentSpawner（返回成功 agent）验证真实 agent 路径 + 会话记录。
const spawnMock = vi.fn();
vi.mock('../src/infrastructure/adapters/agent-spawner.js', () => ({
  agentSpawner: {
    spawn: (params: unknown) => spawnMock(params),
  },
}));

/** 记录每次 prompt 输入（供上游会话引用断言） */
const promptInputs: string[] = [];
function installSpawnAgent(): void {
  promptInputs.length = 0;
  spawnMock.mockResolvedValue({
    prompt: async (input: string) => {
      promptInputs.push(String(input));
      return { content: [{ type: 'text', text: '## 交付摘要\n完成。' }] };
    },
    abort: async () => {},
  });
}

// ── 工具：临时目录 ──

const tempDirs: string[] = [];
function makeTempRoot(): string {
  const dir = path.join(os.tmpdir(), `morpex-sess-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
  }
});

async function readCustom(session: unknown, type: string): Promise<Array<Record<string, unknown>>> {
  const s = session as { getEntries(): Promise<Array<{ type: string; customType?: string; data?: unknown }>> };
  const all = await s.getEntries();
  return all
    .filter(e => e.type === 'custom' && e.customType === type)
    .map(e => (e.data ?? {}) as Record<string, unknown>);
}

// ── 1. AgentSessionStore 单测 ──

describe('AgentSessionStore — JSONL 持久化会话', () => {
  it('createSession → list 可见 + 元数据携带 component/goal + 文件落盘', async () => {
    const store = new AgentSessionStore(makeTempRoot());
    const handle = await store.createSession({ component: 'step-agent', id: 'step_a', goal: '写报告', departmentId: 'software' });

    expect(handle.sessionId).toBe('step_a');
    expect(handle.path).toContain('--step-agent--');
    expect(handle.path.endsWith('.jsonl')).toBe(true);
    expect(fs.existsSync(handle.path)).toBe(true);

    const listed = await store.list('step-agent');
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe('step_a');
    expect(listed[0].metadata?.component).toBe('step-agent');
    expect(listed[0].metadata?.goal).toBe('写报告');
    expect(listed[0].metadata?.departmentId).toBe('software');
  });

  it('appendCustom → open 后 getEntries 可读回 custom 条目（跨会话讨论基础）', async () => {
    const store = new AgentSessionStore(makeTempRoot());
    const handle = await store.createSession({ component: 'orchestrator', id: 'orch_1', goal: 'g' });
    await store.appendCustom(handle.session, 'orchestration.analysis', { complexity: 'simple', steps: [{ name: 's' }] });
    await store.appendSessionName(handle.session, '我的目标');

    // open 重新加载（模拟新进程/跨会话读取）
    const reopened = await store.open({ path: handle.path });
    const entries = await readCustom(reopened, 'orchestration.analysis');
    expect(entries.length).toBe(1);
    expect(entries[0].complexity).toBe('simple');

    const meta = await (reopened as { getMetadata(): Promise<{ path: string }> }).getMetadata();
    expect(meta.path).toBe(handle.path);
  });

  it('fork → parentSessionPath 指向源会话（会话树/派生）', async () => {
    const store = new AgentSessionStore(makeTempRoot());
    const source = await store.createSession({ component: 'step-agent', id: 'step_upstream', goal: 'g' });
    const fork = await store.fork({ path: source.path }, { component: 'executor', id: 'exec_derived' });

    expect(fork.sessionId).toBe('exec_derived');
    expect(fork.path).toContain('--executor--');
    // 派生会话元数据 parentSessionPath 指向源（经 repo 内部 metadata 校验）
    const forkMeta = await (fork.session as { getMetadata(): Promise<{ parentSessionPath?: string }> }).getMetadata();
    expect(forkMeta.parentSessionPath).toBe(source.path);
  });

  it('readEntries → 归一化纯对象（custom + message + custom_message）', async () => {
    const store = new AgentSessionStore(makeTempRoot());
    const handle = await store.createSession({ component: 'step-agent', id: 'step_read', goal: 'g' });
    await store.appendCustom(handle.session, 'step-result', { nodeId: 'n1', success: true });
    await (handle.session as { appendMessage(m: unknown): Promise<string> }).appendMessage({ role: 'user', content: '你好' });
    await (handle.session as { appendMessage(m: unknown): Promise<string> }).appendMessage({ role: 'assistant', content: [{ type: 'text', text: '回复一' }] });

    const entries = await store.readEntries(handle.path);
    const types = entries.map(e => e.type);
    expect(types).toContain('custom');
    expect(types).toContain('message');

    // 基础字段齐全 + JSON 可序列化
    for (const e of entries) {
      expect(typeof e.id).toBe('string');
      expect(typeof e.timestamp).toBe('string');
      JSON.stringify(e); // 不应抛（无循环引用/非序列化值）
    }

    // custom 归一化：customType + data
    const custom = entries.find(e => e.type === 'custom') as { customType?: string; data?: { nodeId?: string } };
    expect(custom?.customType).toBe('step-result');
    expect(custom?.data?.nodeId).toBe('n1');

    // message 归一化：role + content 文本（文本与内容块数组都变纯文本）
    const msgs = entries.filter(e => e.type === 'message') as Array<{ role?: string; content?: string }>;
    expect(msgs.find(m => m.role === 'user')?.content).toBe('你好');
    expect(msgs.find(m => m.role === 'assistant')?.content).toBe('回复一');
  });

  it('readEntries → 不存在的 path 返回 []（不抛）', async () => {
    const store = new AgentSessionStore(makeTempRoot());
    const entries = await store.readEntries('/nonexistent/nope.jsonl');
    expect(entries).toEqual([]);
  });
});

// ── 2. StepAgentExecutor + sessionStore ──

describe('StepAgentExecutor — 会话化（sessionStore）', () => {
  it('step 会话创建 + step-result 条目 + result 携带 sessionId/path', async () => {
    installSpawnAgent();
    const store = new AgentSessionStore(makeTempRoot());
    const executor = new StepAgentExecutor({ sessionStore: store, timeoutMs: 10000 });

    const res = await executor.executeStep(
      { id: 'node_1', name: '生成文档', description: '生成文档', agentType: 'general' },
      new Map(),
    );

    expect(res.success).toBe(true);
    expect(res.mode).toBe('agent');
    expect(res.sessionId).toBeTruthy();
    expect(res.sessionPath).toContain('--step-agent--');

    // 会话内应有 step-result 条目
    const reopened = await store.open({ path: res.sessionPath! });
    const results = await readCustom(reopened, 'step-result');
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].mode).toBe('agent');
    expect(results[0].nodeName).toBe('生成文档');
  });

  it('传入 upstreamSessions → prompt 注入上游会话引用文本（跨会话讨论锚点）', async () => {
    installSpawnAgent();
    const store = new AgentSessionStore(makeTempRoot());
    const executor = new StepAgentExecutor({ sessionStore: store, timeoutMs: 10000 });

    const upstream = new Map([['上游步骤', '上游成果 A']]);
    const upstreamSessions = new Map([['上游步骤', 'C:/sessions/--step-agent--/xxx_upstream.jsonl']]);
    await executor.executeStep(
      { id: 'step_b', name: 'step_b', description: '做 B', agentType: 'general' },
      upstream,
      { upstreamSessions },
    );

    expect(promptInputs.length).toBeGreaterThan(0);
    expect(promptInputs[0]).toContain('上游成果 A');
    expect(promptInputs[0]).toContain('上游步骤会话引用');
    expect(promptInputs[0]).toContain('xxx_upstream.jsonl');
  });
});

// ── 3. OrchestratorAgent + sessionStore ──

describe('OrchestratorAgent — 总大脑会话化', () => {
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

  function realStepExecutor(store: AgentSessionStore) {
    return new StepAgentExecutor({ sessionStore: store, timeoutMs: 10000 });
  }

  function mockDagRuntime(results: Record<string, unknown>) {
    return {
      name: 'mock-dag',
      execute: async () => ({ executionId: 'dag_sess', success: true, failedNodes: 0, nodeResults: new Map(Object.entries(results)) }),
      getStatus: async () => ({ state: 'completed' }),
      cancel: async () => {},
    };
  }

  it('复杂任务：总大脑会话（analysis/audit/synthesis）+ stepSessions + 依赖链 parentSessionPath', async () => {
    installSpawnAgent();
    const store = new AgentSessionStore(makeTempRoot());
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
      { match: '汇总', reply: '最终交付物' },
    ]);

    // dagRuntime 注入（复杂任务走 DAG 分发，会话由总大脑预创建）
    const orchestrator = new OrchestratorAgent({
      llm,
      dagRuntime: mockDagRuntime({
        'node_0_1785000000000': { text: '调研成果' },
        'node_1_1785000000000': { text: '实现成果' },
      }),
      stepExecutor: realStepExecutor(store),
      sessionStore: store,
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成软件系统', { departmentId: 'software' });

    expect(res.success).toBe(true);
    expect(res.sessionId).toBeTruthy();
    expect(res.sessionPath).toContain('--orchestrator--');
    // stepSessions：两个步骤各一个会话
    expect(res.stepSessions.size).toBe(2);
    expect(res.stepSessions.get('调研')).toContain('--step-agent--');
    expect(res.stepSessions.get('实现')).toContain('--step-agent--');
    expect(res.stepSessions.get('调研')).not.toBe(res.stepSessions.get('实现'));

    // 总大脑会话：三类 custom 条目齐备
    const orch = await store.open({ path: res.sessionPath! });
    const analysis = await readCustom(orch, 'orchestration.analysis');
    const audit = await readCustom(orch, 'orchestration.audit');
    const synthesis = await readCustom(orch, 'orchestration.synthesis');
    expect(analysis.length).toBe(1);
    expect(analysis[0].complexity).toBe('complex');
    expect(audit.length).toBe(1);
    expect(audit[0].pass).toBe(true);
    expect(synthesis.length).toBe(1);
    expect(synthesis[0].outputPreview).toContain('最终交付物');

    // 依赖链：实现步骤的 parentSessionPath 指向调研步骤会话
    const steps = await store.list('step-agent');
    expect(steps.length).toBe(2);
    const impl = steps.find(s => s.metadata?.stepName === '实现');
    expect(impl).toBeDefined();
    expect(impl!.parentSessionPath).toBe(res.stepSessions.get('调研'));
  });

  it('审计 fail → 补充任务也创建会话（迭代轮次会话追踪）', async () => {
    installSpawnAgent();
    const store = new AgentSessionStore(makeTempRoot());
    let auditCount = 0;
    const llm = mockLlm([
      {
        match: '总大脑（编排 Agent）',
        reply: JSON.stringify({ complexity: 'simple', steps: [{ name: '生成', description: '生成报告', deps: [] }], reasoning: '单步' }),
      },
      {
        match: '审计 Agent',
        reply: () => {
          auditCount++;
          if (auditCount === 1) {
            return JSON.stringify({ pass: false, issues: ['缺验证'], supplementaryTasks: [{ name: '验证', description: '补充验证', deps: [] }], reasoning: '需补' });
          }
          return JSON.stringify({ pass: true, issues: [], supplementaryTasks: [], reasoning: 'ok' });
        },
      },
      { match: '汇总', reply: '交付物' },
    ]);

    const orchestrator = new OrchestratorAgent({
      llm,
      stepExecutor: realStepExecutor(store),
      sessionStore: store,
      maxIterations: 3,
    });

    const res = await orchestrator.run('生成报告');
    expect(res.success).toBe(true);
    expect(res.iterations).toBe(2);
    expect(res.stepSessions.size).toBe(2); // 第一轮 生成 + 补充 验证

    const orch = await store.open({ path: res.sessionPath! });
    const audits = await readCustom(orch, 'orchestration.audit');
    expect(audits.length).toBe(2);
    expect(audits[0].pass).toBe(false);
    expect(audits[1].pass).toBe(true);
  });
});
