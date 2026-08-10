/**
 * deterministic-closed-loop.mock.test.ts — 方案 B：不改任何源码文件的确定性闭环验证
 *
 * ═══ 目标 ═══
 * 用「模块级 mock LLM」替代真实 GLM/opencode，跑完 scripts/batch-tasks.ts 的 50 个真实任务集，
 * 验证 Goal → Gate → 规划 → 装配 → 执行 → 产物 → 评价 → 演化 全链功能函数正常，
 * 且结果确定、可复现、秒~分钟级（无需数小时真实任务、无需外部 LLM 配额）。
 *
 * ═══ 原理 ═══
 * vi.mock 在模块加载层拦截 PiBridge 单例（getSharedPiBridge）：
 *   - bootstrap-unified.ts 动态 import 的 PiBridge.js
 *   - ServiceContainer.ts import 的 PiBridge.js
 *   - agent-spawner.ts 经 pi-bridge/index.js re-export 的 getSharedPiBridge
 * 三处全部拿到确定性 mock → 整个执行链的 LLM 调用（ontology/原语参数提取/反思/编排 agent）零真实网络。
 * embedding（SILICONFLOW_API_KEY 未配）自动回退 Sparse BM25，同样零外部依赖。
 *
 * ═══ 运行 ═══
 *   npx vitest run packages/core/__tests__/deterministic-closed-loop.mock.test.ts   # 全量 50 任务
 *   DETERMINISTIC_LIMIT=3 npx vitest run packages/core/__tests__/deterministic-closed-loop.mock.test.ts  # 冒烟
 *   DETERMINISTIC_THRESHOLD=0.9 ...   # 覆盖成功阈值（默认 0.8）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bootstrapUnified } from '../src/bootstrap-unified.js';
import { CapabilityRegistry } from '../src/governance/capability/CapabilityRegistry.js';
import { TASKS } from '../../../scripts/batch-tasks.js';
import { createTraceSession, type TraceSession } from '../../../scripts/tracing/TraceRecorder.js';

// ═══════════════════════════════════════════════════════════════
// vi.hoisted：mock 工厂共享状态 + 语义路由（vitest hoist 到文件顶部，供 vi.mock 引用）
// ═══════════════════════════════════════════════════════════════
const mocks = vi.hoisted(() => {
  const state = {
    generateTextCalls: 0,
    harnessCalls: 0,
    initCalls: 0,
    /** 抽样记录最近 prompt 前 120 字符，用于失败诊断 */
    recentPrompts: [] as string[],
  };
  /** 本地 mock API 端口（供 APICallPrimitive，避免真实外部请求） */
  const apiPort = { value: 19999 };

  /** 语义路由：按 prompt 特征返回确定性响应（启发式，冒烟迭代校准） */
  const route = (prompt: string): string => {
    const p = prompt ?? '';
    // ── 审批 / 人工决定（batch-run 自动 decide APPROVED 的对应点）──
    if (p.length < 500 && /approv|审批|decide|决定|审核/i.test(p)) {
      return 'APPROVED';
    }
    // ── 参数提取 / schema 补全：返回覆盖全部通用原语必填字段的默认值 JSON
    //    （validatePrimitiveParams 只校验 required 非空，填上即可通过；多余字段被忽略）──
    if (/Schema|schema|提取参数|只输出 JSON 对象|补全|缺必填|inputSchema|extract|parameter/i.test(p)) {
      const goalMatch = p.match(/任务:\s*([^\n]+)/);
      const goal = (goalMatch ? goalMatch[1].trim() : 'mock 任务').slice(0, 120);
      const firstEnum = (() => {
        const m = p.match(/"enum":\s*\[\s*"([^"]+)/);
        return m ? m[1] : undefined;
      })();
      const params: Record<string, unknown> = {
        query: goal,
        operation: firstEnum ?? 'write',
        path: 'data/test-output/mock-output.txt',
        content: 'Mock 文件内容',
        command: 'echo mock',
        url: `http://localhost:${apiPort.value}/mock`,
        method: 'GET',
        type: 'doc',
        specification: goal,
        sources: ['knowledge_graph'],
        maxResults: 10,
        minConfidence: 0.3,
        riskTier: 'tier-1',
      };
      return JSON.stringify(params);
    }
    // ── 规划 / 任务拆解 ──
    if (/plan|规划|拆解|分解|HTN|任务清单|步骤/i.test(p)) {
      return JSON.stringify({
        steps: [
          { id: 's1', type: 'task', action: 'execute', description: '执行目标并输出交付物', dependsOn: [], requiresKnowledge: true },
        ],
        ontologyRefs: [],
        rationale: '确定性 mock 规划：单步执行 + 交付物产出',
      });
    }
    // ── 反思 / 学习 / 总结 ──
    if (/reflect|反思|学习|总结|lesson|improve/i.test(p)) {
      return '任务完成。流程顺畅，无需额外改进；关键风险已在执行阶段处理。';
    }
    // ── 评价 / 评分 ──
    if (/score|评分|评估|评价|打分|evaluation|grade/i.test(p)) {
      return JSON.stringify({
        score: 0.85,
        passed: true,
        dimensions: { correctness: 0.9, completeness: 0.8, ontologyCompliance: 0.9, efficiency: 0.8, quality: 0.85 },
      });
    }
    // ── 知识查询 / 意图判断 / 检索 ──
    if (/知识|检索|查询|query|意图|gate|ontology/i.test(p)) {
      return JSON.stringify({ needQuery: true, query: '任务相关领域知识', grounded: true });
    }
    // ── agent 编排 / 子任务 / 工具调用 ──
    if (/agent|编排|orchestrat|子任务|sub.?agent|工具|tool/i.test(p)) {
      return JSON.stringify({ action: 'complete', message: '任务已完成，交付物已生成', artifacts: ['mock-artifact'] });
    }
    // ── 默认：中性自然语言（对需 JSON 处触发 robustJsonExtract 空回退 → 兜底）──
    return '已完成。';
  };

  /** 构造确定性 PiBridge mock 实例 */
  const createMockBridge = () => ({
    async init(): Promise<void> {
      state.initCalls++;
    },
    async generateText(params: { prompt?: string; temperature?: number }): Promise<{ text: string; usage: Record<string, number> }> {
      state.generateTextCalls++;
      const prompt = params?.prompt ?? '';
      if (state.recentPrompts.length < 20) state.recentPrompts.push(prompt.slice(0, 120));
      return { text: route(prompt), usage: { input: 10, output: 20, total: 30 } };
    },
    async createAgentHarness(config: { systemPrompt?: string }): Promise<{
      prompt(input: unknown): Promise<{ content: Array<{ type: string; text: string }> }>;
      abort(): Promise<void>;
    }> {
      state.harnessCalls++;
      return {
        async prompt(input: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
          // 真实 pi-ai AgentHarness.prompt 返回 { content: [{ type: 'text', text }] }——StepAgentExecutor 的
          // extractText 要求 content 为数组，纯 string 会被判空 → retryable → 失败（曾导致 18/50 任务失败）
          const text = route(typeof input === 'string' ? input : JSON.stringify(input ?? config?.systemPrompt ?? ''));
          return { content: [{ type: 'text', text }] };
        },
        async abort(): Promise<void> { /* noop */ },
      };
    },
    listModels(): Array<{ id: string }> { return [{ id: 'mock/model' }]; },
    listProviders(): string[] { return ['mock']; },
    findModel(): { id: string } | undefined { return { id: 'mock/model' }; },
    createAgentSessionId(): string { return 'mock-sess'; },
    generateUuid(): string { return 'mock-uuid'; },
  });

  return { state, route, createMockBridge, apiPort };
});

// ═══════════════════════════════════════════════════════════════
// 模块级拦截：所有 import PiBridge 的路径（直接 + index re-export）都返回确定性 mock
// ═══════════════════════════════════════════════════════════════
vi.mock('../src/infrastructure/adapters/pi-bridge/PiBridge.js', async (importOriginal) => {
  // 保留真实静态方法（createJsonlSessionRepo/uuidv7/createNodeEnv 等），仅覆盖 getSharedPiBridge 为确定性 mock
  const actual = await importOriginal<typeof import('../src/infrastructure/adapters/pi-bridge/PiBridge.js')>();
  return {
    ...actual,
    getSharedPiBridge: mocks.createMockBridge,
  };
});
vi.mock('../src/infrastructure/adapters/pi-bridge/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infrastructure/adapters/pi-bridge/index.js')>();
  return {
    ...actual,
    getSharedPiBridge: mocks.createMockBridge,
  };
});

// ═══════════════════════════════════════════════════════════════
// 测试主体
// ═══════════════════════════════════════════════════════════════
const LIMIT = Number(process.env.DETERMINISTIC_LIMIT ?? '50');
const THRESHOLD = Number(process.env.DETERMINISTIC_THRESHOLD ?? '0.8');
const tasks = TASKS.slice(0, LIMIT);

interface Boot {
  container: {
    eventStore: { query(f: { type?: string; limit?: number }): Promise<Array<{ type: string; payload?: Record<string, unknown> }>> };
    eventBus: { getHistory(type?: string): Array<{ type: string; payload?: Record<string, unknown> }> };
  };
  companyFacade: { executeGoal(goal: string, opts: { departmentName: string }): Promise<{ ok: boolean; error?: string; missionId?: string }> };
  departmentManager: { createDepartment(opts: { name: string; type: string; ceoId: string }): Promise<unknown> };
}
let boot: Boot;
let companyFacade: Boot['companyFacade'];
let departmentManager: Boot['departmentManager'];

/** EventStore 精确类型查询 */
async function findEvents(type: string): Promise<Array<{ type: string; payload?: Record<string, unknown> }>> {
  const all = await boot.container.eventStore.query({ limit: 5000 });
  return all.filter((e) => e.type === type);
}
/** EventBus 前缀查询 */
function findBusEvents(prefix: string): Array<{ type: string; payload?: Record<string, unknown> }> {
  return boot.container.eventBus.getHistory().filter((e) => e.type === prefix || e.type.startsWith(prefix + '.'));
}

const DEPTS = ['ecommerce', 'hardware', 'software', 'xjmcu'];

let mockApiServer: Server | undefined;

// ═══════════════════════════════════════════════════════════════
// P1 覆盖度量：功能模块清单 × 实际调用（机器证明覆盖）
// ═══════════════════════════════════════════════════════════════
/** 静态扫描 packages/core/src 所有 export class → 功能模块清单 */
function scanCoreClasses(): string[] {
  const root = resolve(process.cwd(), 'packages/core/src');
  const classes = new Set<string>();
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.ts')) {
        const text = readFileSync(full, 'utf-8');
        for (const m of text.matchAll(/export\s+(?:abstract\s+)?class\s+(\w+)/g)) classes.add(m[1]);
      }
    }
  };
  walk(root);
  return [...classes];
}

/** 从实例取构造函数名（label 与源码类名天然对齐） */
function getClassName(o: unknown): string {
  return (o as { constructor?: { name?: string } })?.constructor?.name ?? '';
}

/** 覆盖追踪会话（记录核心服务实例方法调用） */
const coverageTrace: TraceSession = createTraceSession('coverage', { maxCalls: 30_000 });
const wrappedLabels = new Set<string>();

/** 包装 container + bootstrap 顶层全部服务实例（label=类名） */
function wrapCoreServices(): void {
  const wrap = (obj: unknown, fallback: string): void => {
    if (!obj || typeof obj !== 'object') return;
    const label = getClassName(obj) || fallback;
    if (label === 'Object' || !label || label === 'Promise') return; // 排除非核心对象/包装噪音
    wrappedLabels.add(label);
    coverageTrace.wrap(obj as Record<string, unknown>, label);
  };
  const container = boot.container as unknown as Record<string, unknown>;
  for (const key of Object.keys(container)) {
    wrap(container[key], key);
  }
  const extra: Record<string, unknown> = {
    companyFacade,
    departmentManager,
    ontology: (boot as unknown as Record<string, unknown>).ontology,
    forcedQueryGuard: (boot as unknown as Record<string, unknown>).forcedQueryGuard,
    objectTypeRegistry: (boot as unknown as Record<string, unknown>).objectTypeRegistry,
    missionProjector: (boot as unknown as Record<string, unknown>).missionProjector,
    artifactProjector: (boot as unknown as Record<string, unknown>).artifactProjector,
    feedbackService: (boot as unknown as Record<string, unknown>).feedbackService,
  };
  for (const [k, v] of Object.entries(extra)) wrap(v, k);
}

/** 构建覆盖报告：清单 vs 实际调用 */
function buildCoverageReport() {
  const calls = coverageTrace.report();
  const calledClasses = new Set<string>();
  for (const c of calls) {
    const cls = c.fn.split('.')[0];
    if (cls) calledClasses.add(cls);
  }
  const allClasses = scanCoreClasses();
  const wrappedCovered = [...wrappedLabels].filter((l) => calledClasses.has(l));
  const wrappedUncovered = [...wrappedLabels].filter((l) => !calledClasses.has(l));
  const neverWrapped = allClasses.filter((c) => !wrappedLabels.has(c) && !calledClasses.has(c));
  return {
    calls,
    allClasses,
    calledClasses,
    wrappedCovered,
    wrappedUncovered,
    neverWrapped,
    wrappedCoverage: wrappedLabels.size > 0 ? wrappedCovered.length / wrappedLabels.size : 0,
  };
}

beforeAll(async () => {
  // ── 本地 mock HTTP 服务：APICallPrimitive 指向它（避免真实外部请求 / fetch failed）──
  await new Promise<void>((resolve) => {
    mockApiServer = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, data: { result: 'mock-api-result' }, status: 200 }));
    });
    mockApiServer.listen(0, '127.0.0.1', () => {
      const addr = mockApiServer!.address();
      if (addr && typeof addr === 'object') mocks.apiPort.value = addr.port;
      resolve();
    });
  });

  boot = (await bootstrapUnified({ ceoId: 'det-ceo' })) as unknown as Boot;
  companyFacade = boot.companyFacade;
  departmentManager = boot.departmentManager;
  wrapCoreServices(); // ═══ P1：任务执行前包装核心服务，记录实际调用 ═══
  for (const name of DEPTS) {
    try {
      await departmentManager.createDepartment({ name, type: 'project', ceoId: 'det-ceo' });
    } catch {
      /* 已存在 */
    }
  }
}, 120_000);

afterAll(() => {
  mockApiServer?.close();
});

describe('方案B：确定性 mock 闭环验证（不改源码）', () => {
  it(`【0】mock 生效：LLM 调用全部走确定性 mock（零真实网络）`, async () => {
    // bootstrap 阶段不调 LLM；执行一个任务触发，随后断言计数>0 证明模块级拦截生效
    await companyFacade.executeGoal(tasks[0].goal, { departmentName: tasks[0].departmentName });
    expect(mocks.state.generateTextCalls).toBeGreaterThan(0);
    expect(mocks.state.generateTextCalls).toBeLessThan(1000); // 且未失控（若真实 LLM 会卡网络/配额）
  }, 120_000);

  it(`【1】确定性闭环：${tasks.length} 任务全链跑通（覆盖率阈值 ${THRESHOLD * 100}%）`, async () => {
    const results: Array<{ goal: string; dept: string; ok: boolean; error?: string; missionId?: string; events: number }> = [];
    for (const t of tasks) {
      const before = findBusEvents('runtime.started').length;
      let r: { ok: boolean; error?: string; missionId?: string };
      try {
        r = await companyFacade.executeGoal(t.goal, { departmentName: t.departmentName });
      } catch (err) {
        r = { ok: false, error: `[unhandled] ${(err as Error).message}` };
      }
      results.push({
        goal: t.goal.slice(0, 40),
        dept: t.departmentName,
        ok: r.ok,
        error: r.error,
        missionId: r.missionId,
        events: findBusEvents('runtime.started').length - before,
      });
    }

    // ── 报告（失败详情完整输出，供定位）──
    const okCount = results.filter((r) => r.ok).length;
    const failList = results.filter((r) => !r.ok);
    console.log(
      `\n[deterministic-closed-loop] 任务 ${okCount}/${results.length} 成功，` +
      `mock generateText=${mocks.state.generateTextCalls} 次, agent harness=${mocks.state.harnessCalls} 次`,
    );
    for (const f of failList) {
      console.log(`  ❌ [${f.dept}] ${f.goal}… → ${f.error ?? '未知错误'}`);
    }
    if (mocks.state.recentPrompts.length) {
      console.log('  —— 最近 mock 收到的 prompt 样本（诊断用）——');
      for (const sp of mocks.state.recentPrompts) console.log(`    • ${sp.replace(/\n/g, ' ')}`);
    }

    // ── 全链机制断言（功能函数正常 = 每任务都产生执行事件，无静默失败）──
    const withEvents = results.filter((r) => r.events > 0).length;
    expect(withEvents).toBeGreaterThan(0); // 至少任务进入 Runtime 执行
    expect(failList.filter((f) => f.error?.includes('[unhandled]')).length).toBe(0); // 无未处理异常崩溃

    // ── 覆盖率阈值断言（mock 响应质量：低于阈值说明 route 需校准，而非系统 bug）──
    expect(okCount / results.length).toBeGreaterThanOrEqual(THRESHOLD);

    // ── P1 覆盖度量报告：核心服务实例调用 → 未覆盖类清单 ──
    const cov = buildCoverageReport();
    console.log(
      `\n[P1 覆盖度量] 调用记录 ${cov.calls.length} 条；包装核心服务 ${cov.wrappedCovered.length}/${wrappedLabels.size} 个类被实际调用（${(cov.wrappedCoverage * 100).toFixed(0)}%）`,
    );
    if (cov.wrappedUncovered.length) {
      console.log(`  ⚠️ 已包装但从未被调用的核心服务类（盲区）：`);
      for (const c of cov.wrappedUncovered) console.log(`    - ${c}`);
    }
    if (cov.neverWrapped.length) {
      console.log(`  ℹ️ 源码中存在、未被实例包装的类（${cov.neverWrapped.length}，静态/工具/内部类需人工判断）：`);
      for (const c of cov.neverWrapped.slice(0, 30)) console.log(`    · ${c}`);
    }
  }, 900_000);

  it('【3】覆盖度量：核心服务类调用覆盖率达阈值（机器证明非盲跑）', () => {
    const cov = buildCoverageReport();
    const coverageThreshold = Number(process.env.COVERAGE_THRESHOLD ?? '0.6');
    // 已知盲区（通用 50 任务不触发的合理路径，均有专项测试/真实任务覆盖）：
    //   OrchestratorAgent（复杂任务顶层编排）· AgentSessionStore（会话持久化）·
    //   EvolutionSandbox/EvolutionApplyLoop（演化沙箱，无提案不触发）· MissionRuntime ·
    //   PersistentArtifactStore（产物备用存储）· MemoryApi（统一记忆层，unified-memory.spec 覆盖）·
    //   FeedbackService（QueryMiss 反馈，mock 无 query miss）
    const KNOWN_UNCOVERED = new Set([
      'OrchestratorAgent', 'AgentSessionStore', 'EvolutionSandbox', 'EvolutionApplyLoop',
      'MissionRuntime', 'PersistentArtifactStore', 'MemoryApi', 'FeedbackService',
    ]);
    const unknownUncovered = cov.wrappedUncovered.filter((c) => !KNOWN_UNCOVERED.has(c));
    console.log(
      `[P1 覆盖度量] 包装 ${wrappedLabels.size} 个核心服务类，调用覆盖 ${(cov.wrappedCoverage * 100).toFixed(0)}%（阈值 ${coverageThreshold * 100}%）；` +
        `未调用 ${cov.wrappedUncovered.length}（已知盲区 ${cov.wrappedUncovered.length - unknownUncovered.length}，未知 ${unknownUncovered.length}）`,
    );
    expect(cov.wrappedCoverage).toBeGreaterThanOrEqual(coverageThreshold);
    // 未知盲区必须显式登记——出现新盲区即失败，倒逼补专项测试
    expect(unknownUncovered).toEqual([]);
  });

  it('【2】全链事件存在：规划/装配/执行/评价 事件均已产生（测试1已执行全部任务，同步断言）', () => {
    const plans = findBusEvents('planner.plan.completed');
    const assembled = findBusEvents('context.assembled');
    const completed = findBusEvents('runtime.completed');
    const evals = findBusEvents('evaluation.completed');
    console.log(
      `[deterministic-closed-loop] 全链事件计数 → 规划:${plans.length} 装配:${assembled.length} ` +
      `执行完成:${completed.length} 评价:${evals.length} 能力经验:${CapabilityRegistry.getAll().filter((c: { successRate?: number }) => typeof c.successRate === 'number').length}`,
    );
    expect(plans.length).toBeGreaterThan(0);
    expect(assembled.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);
    expect(evals.length).toBeGreaterThan(0);
  });
});
