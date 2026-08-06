/**
 * RAG-lazy 上下文装配测试（会话 16i：检索增强 + 指针 + 4 层 + 蒸馏）
 *
 * 覆盖：
 *   1. ContextDistiller：确定性提取关键行 + LLM 蒸馏 + 兜底
 *   2. ContextRetriever：语义相关打分（关键词/domain）、Top-K、经验/策略源
 *   3. ContextAssemblyEngine 4 层装配：工作层永驻、情境层检索 Top-K（指针）、每层预算截断、分节遥测
 */

import { describe, it, expect } from 'vitest';
import { ContextDistiller } from '../src/knowledge/context/retrieval/ContextDistiller.js';
import { ContextRetriever, type RecentTaskRecord } from '../src/knowledge/context/retrieval/ContextRetriever.js';
import type { LearningEvent } from '../src/evolution/LearningEventDetector.js';
import type { AppliedStrategy } from '../src/evolution/PromptStrategyRegistry.js';
import { ContextFragmentRegistry } from '../src/knowledge/context/ContextFragmentRegistry.js';
import type { FragmentProvider, ContextAssemblyInput } from '../src/knowledge/context/ContextFragmentRegistry.js';
import { ContextAssemblyEngine } from '../src/knowledge/context/ContextAssemblyEngine.js';

describe('ContextDistiller — 摘要蒸馏', () => {
  it('超长文本 → 确定性提取关键行（目标/结果/决策）', async () => {
    const d = new ContextDistiller({ maxLen: 200 });
    const text = [
      '【当前任务】为电商部门制定618价格合规方案',
      '这是一大段过程细节……'.repeat(100),
      '【关键决策】采用含税价格披露',
      '【遗留风险】库存清仓需人工复核',
      '更多细节……'.repeat(50),
    ].join('\n');
    const out = await d.distill(text);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('关键决策');
    expect(out).toContain('遗留风险');
    expect(out).not.toContain('这是一大段过程细节');
  });

  it('短文本 → 原样返回（不截断）', async () => {
    const d = new ContextDistiller();
    expect(await d.distill('简短摘要', 200)).toBe('简短摘要');
  });

  it('LLM 蒸馏可用 → 用 LLM 输出', async () => {
    let called = false;
    const d = new ContextDistiller({
      maxLen: 200,
      llm: { generateText: async () => { called = true; return { text: 'LLM 压缩摘要' }; } },
    });
    const out = await d.distill('x'.repeat(500));
    expect(called).toBe(true);
    expect(out).toBe('LLM 压缩摘要');
  });

  it('LLM 失败 → 确定性兜底', async () => {
    const d = new ContextDistiller({
      maxLen: 100,
      llm: { generateText: async () => { throw new Error('llm down'); } },
    });
    const out = await d.distill('【目标】完成检查\n' + '细节'.repeat(100));
    expect(out.length).toBeLessThanOrEqual(100);
  });
});

describe('ContextRetriever — 相关性检索', () => {
  const events: LearningEvent[] = [
    { type: 'empty-param', capability: 'ecommerce', detail: '缺失必需参数 query', timestamp: 1 },
  ];
  const strategies: AppliedStrategy[] = [
    { type: 'empty-param', hint: '调用工具前必须确认参数非空', version: 1, appliedAt: 1 },
  ];

  function makeRetriever(tasks: RecentTaskRecord[]) {
    return new ContextRetriever({
      loadRecentTasks: async () => tasks,
      getEvents: () => events,
      getStrategies: () => strategies,
    });
  }

  it('goal 语义相关 → 命中相关任务并排前', async () => {
    const tasks: RecentTaskRecord[] = [
      { taskRef: 't_price', goal: '电商价格合规检查', result: 'success', archivedAt: Date.now() - 1000 },
      { taskRef: 't_hw', goal: '开发空气检测设备', result: 'failure', archivedAt: Date.now() - 2000 },
    ];
    const r = makeRetriever(tasks);
    const res = await r.retrieveRelevant('电商价格合规检查', 'ecommerce', 5);
    expect(res[0].ref).toBe('t_price'); // 相关任务排前
    expect(res[0].type).toBe('task');
    expect(res[0].score).toBeGreaterThan(0);
  });

  it('经验事件按 capability/domain 匹配注入', async () => {
    const r = makeRetriever([]);
    const res = await r.retrieveRelevant('电商促销方案', 'ecommerce', 5);
    expect(res.some(x => x.type === 'experience' && x.ref.startsWith('exp:'))).toBe(true);
  });

  it('策略全局注入', async () => {
    const r = makeRetriever([]);
    const res = await r.retrieveRelevant('生成报告', 'software', 5);
    expect(res.some(x => x.type === 'strategy')).toBe(true);
  });

  it('Top-K 限制 + 无关不召回', async () => {
    const tasks: RecentTaskRecord[] = Array.from({ length: 10 }, (_, i) => ({
      taskRef: `t_${i}`, goal: '完全不相关的任务内容xyz', result: 'success', archivedAt: Date.now(),
    }));
    const r = makeRetriever(tasks);
    const res = await r.retrieveRelevant('电商价格合规检查', 'ecommerce', 3);
    expect(res.length).toBeLessThanOrEqual(3);
  });
});

describe('ContextAssemblyEngine — 4 层装配（16i RAG-lazy）', () => {
  function mockProvider(source: string, data: Record<string, unknown>): FragmentProvider {
    return {
      source: source as never,
      async collect(_input: ContextAssemblyInput) {
        return { source: source as never, data, version: 1, collectedAt: Date.now() };
      },
    };
  }
  function makeEngine(config?: Partial<ConstructorParameters<typeof ContextAssemblyEngine>[5]>) {
    const registry = new ContextFragmentRegistry();
    registry.register(mockProvider('user_profile', { name: 'Alice' }));
    registry.register(mockProvider('goal_graph', { goals: [{ id: 'g1' }] }));
    registry.register(mockProvider('mission_state', { id: 'm1' }));
    registry.register(mockProvider('artifact_lineage', { recent: [] }));
    registry.register(mockProvider('custom', { hint: 'constraint' }));
    return new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, config);
  }

  it('retriever 情境层 → focusedSummary 含【相关任务摘要】指针 + 工作层永驻', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false,
      retriever: {
        retrieveRelevant: async () => [
          { ref: 't_price', summary: '618价格合规完成', score: 3 },
          { ref: 't_hw', summary: '硬件检测失败', score: 0.5 },
        ],
      },
      experienceInjector: { inject: async () => '⚠️ 工具参数必填' },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '电商价格合规检查', domain: 'ecommerce', taskRefs: ['r1'] });

    expect(ctx.focusedSummary).toContain('【当前任务】'); // 工作层
    expect(ctx.focusedSummary).toContain('【相关任务摘要】'); // 情境层
    expect(ctx.focusedSummary).toContain('- [t_price] 618价格合规完成'); // 指针 + 摘要
    expect(ctx.focusedSummary).toContain('【经验规避】'); // 程序层
    expect(ctx.focusedSummary).toContain('【goal_graph】'); // 语义层
  });

  it('预算内 item 级选择：完整项优先，超预算裁整项留指针（不切片丢失关键信息）', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false,
      layerBudgets: { working: 200, episodic: 30, semantic: 500, procedural: 100 },
      retriever: {
        // 3 个检索项（相关度递减）：预算 30 只装得下高相关完整项（~20 字符），其余被裁留指针
        retrieveRelevant: async () => [
          { ref: 't_high', summary: '高相关完整摘要', score: 3 },
          { ref: 't_mid', summary: '中相关完整摘要', score: 1 },
          { ref: 't_low', summary: '低相关完整摘要', score: 0.3 },
        ],
      },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '目标', domain: 'd', taskRefs: ['r1'] });

    // 高相关项完整保留（未被切片/丢失）
    expect(ctx.focusedSummary).toContain('- [t_high] 高相关完整摘要');
    // 装不下的低相关项 → 保留指针（【可拉取详情】），不静默丢失
    expect(ctx.focusedSummary).toContain('【可拉取详情】');
    expect(ctx.focusedSummary).toContain('t_low');
    // 工作层永驻（质量锚点不丢）
    expect(ctx.focusedSummary).toContain('【当前任务】');
  });

  it('分节遥测：assemblyTelemetry.layers 记录 4 层字符量', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false, enableTelemetry: true,
      retriever: { retrieveRelevant: async () => [{ ref: 't1', summary: 's', score: 1 }] },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '目标', domain: 'd', taskRefs: ['r1'] });
    expect(ctx.assemblyTelemetry?.layers).toBeDefined();
    const l = ctx.assemblyTelemetry!.layers!;
    expect(l.working).toBeGreaterThan(0);
    expect(l.semantic).toBeGreaterThan(0);
    expect(l.episodic).toBeGreaterThan(0);
    // 各层预算之和 ≪ 旧 50KB 上限（防膨胀）
    expect(l.working + l.semantic + l.episodic + l.procedural).toBeLessThan(50_000);
  });

  it('无 retriever → 回退 recentSummaryReader（兼容）', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false,
      recentSummaryReader: { loadRecent: async () => [{ taskRef: 't_old', summary: '旧摘要', archivedAt: 1, source: 'event-store' }] },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '目标', domain: 'd', taskRefs: ['r1'] });
    expect(ctx.focusedSummary).toContain('相关任务摘要');
    expect(ctx.focusedSummary).toContain('t_old');
  });
});
