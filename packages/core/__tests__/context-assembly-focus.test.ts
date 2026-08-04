/**
 * Context Assembly 聚焦模式测试（功能③ Phase 1 修正——身份 ID 驱动 + 三分法）
 *
 * 覆盖 ContextAssemblyEngine 聚焦模式：
 *   - 三分法：系统级（user_profile/custom）永不省略；任务级收集；历史级跳过
 *   - 身份 ID 聚焦：同会话多任务，片段按 taskRef 归属匹配 currentTask，A/C 不装
 *   - 聚焦不主动截断（选对材料优先）；仅异常超限（>maxTokens×10）才兜底截断
 *   - focusedSummary 生成（含任务身份/系统材料 + 片段摘要）
 *   - focusMode=false 行为不变（向后兼容）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContextFragmentRegistry } from '../src/knowledge/context/ContextFragmentRegistry.js';
import type { FragmentProvider, ContextAssemblyInput } from '../src/knowledge/context/ContextFragmentRegistry.js';
import { ContextAssemblyEngine, defaultRiskGrader } from '../src/knowledge/context/ContextAssemblyEngine.js';
import type { RecentSummaryReader } from '../src/knowledge/context/ContextBuilder.js';

function mockProvider(source: string, data: Record<string, unknown>, taskRef?: string): FragmentProvider {
  return {
    source: source as any,
    async collect(_input: ContextAssemblyInput) {
      return { source: source as any, data, version: 1, collectedAt: Date.now(), ...(taskRef ? { taskRef } : {}) };
    },
  };
}

function makeEngine(config?: Partial<ConstructorParameters<typeof ContextAssemblyEngine>[5]>) {
  const registry = new ContextFragmentRegistry();
  // 注册全部 8 种来源（验证三分法：系统级必装 / 任务级收集 / 历史级跳过）
  registry.register(mockProvider('user_profile', { name: 'Alice', prefs: 'long history...' }));
  registry.register(mockProvider('behavior_twin', { profile: 'risk-averse' }));
  registry.register(mockProvider('goal_graph', { goals: [{ id: 'g1', title: '当前目标' }] }));
  registry.register(mockProvider('mission_state', { id: 'm1', status: 'EXECUTING' }));
  registry.register(mockProvider('decision_history', { recent: ['d1', 'd2'] }));
  registry.register(mockProvider('artifact_lineage', { recent: [{ id: 'a1' }] }));
  registry.register(mockProvider('agent_status', { agents: [] }));
  registry.register(mockProvider('custom', { hint: 'custom constraint' }));
  return new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, config);
}

describe('ContextAssemblyEngine 聚焦模式（功能③ 身份 ID + 三分法）', () => {
  let engine: ContextAssemblyEngine;

  beforeEach(() => {
    engine = makeEngine({ focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false });
  });

  it('三分法：系统级（user_profile/custom）永不省略 + 任务级收集 + 历史级跳过', async () => {
    const ctx = await engine.assemble({
      missionId: 'm1',
      goal: '开发空气检测设备',
      domain: 'hardware',
      taskRefs: ['ref-1'],
    });
    const sources = ctx.fragments.map((f) => f.source);
    // 任务级片段收集
    for (const s of ['goal_graph', 'mission_state', 'artifact_lineage']) {
      expect(sources).toContain(s);
    }
    // 系统级永不省略：user_profile 在 default 模板 required 中，聚焦时必须保留（用户画像必须）
    expect(sources).toContain('user_profile');
    // 历史级跳过（需则主动召回）
    for (const s of ['behavior_twin', 'decision_history', 'agent_status']) {
      expect(sources).not.toContain(s);
    }
  });

  it('身份 ID 聚焦：taskRef 不匹配当前任务的片段被过滤，匹配的保留，系统级必装', async () => {
    const registry = new ContextFragmentRegistry();
    // 任务 A 的 goal（归属 taskA）——当前任务是 B，应被过滤
    registry.register(mockProvider('goal_graph', { goals: [{ id: 'gA', title: '任务A的目标' }] }, 'taskA'));
    // 任务 B 的 mission（归属 taskB）——应保留
    registry.register(mockProvider('mission_state', { id: 'mB', status: 'EXECUTING' }, 'taskB'));
    // 系统级（无归属）——必装
    registry.register(mockProvider('user_profile', { name: 'Alice' }));
    const eng = new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, {
      focusMode: true,
      enableVersioning: false,
      enableEnrichment: false,
    });
    const ctx = await eng.assemble({ missionId: 'm1', goal: '推进任务B', currentTask: { taskId: 'taskB' } });
    const sources = ctx.fragments.map((f) => f.source);
    expect(sources).toContain('mission_state');   // B 匹配 → 装
    expect(sources).not.toContain('goal_graph');  // A 不匹配 → 过滤（同会话多任务可分）
    expect(sources).toContain('user_profile');    // 系统级 → 必装
  });

  it('focusedSummary 包含 goal/domain/taskRefs/任务身份 与片段摘要', async () => {
    const ctx = await engine.assemble({
      missionId: 'm1',
      goal: '开发空气检测设备',
      domain: 'hardware',
      taskRefs: ['ref-1', 'ref-2'],
      currentTask: { goalId: 'g1', taskId: 't1' },
    });
    expect(ctx.focusedSummary).toBeTruthy();
    expect(ctx.focusedSummary).toContain('开发空气检测设备');
    expect(ctx.focusedSummary).toContain('hardware');
    expect(ctx.focusedSummary).toContain('ref-1');
    expect(ctx.focusedSummary).toContain('goal_graph');
    expect(ctx.focusedSummary).toContain('任务身份');
    expect(ctx.focusedSummary).toContain('goal=g1');
  });

  it('聚焦不主动截断（选对材料优先）；仅异常超限（>maxTokens×10）才兜底截断', async () => {
    // 正常情况：大片段也不截（硬截断降级为兜底）——用 default 模板含的 goal_graph 做大片段源
    const bigProvider: FragmentProvider = {
      source: 'goal_graph' as any,
      async collect() {
        return { source: 'goal_graph' as any, data: { big: 'x'.repeat(20000) }, version: 1, collectedAt: Date.now() };
      },
    };
    const registry = new ContextFragmentRegistry();
    registry.register(mockProvider('user_profile', { name: 'Alice' }));
    registry.register(mockProvider('mission_state', { id: 'm1' }));
    registry.register(bigProvider);
    const eng = new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, {
      focusMode: true,
      maxTokens: 1000, // 正常不应触发兜底（total ≈ 5000 tokens < 1000×10）
      enableVersioning: false,
      enableEnrichment: false,
    });
    const ctx = await eng.assemble({ missionId: 'm1', goal: 'g' });
    expect(ctx.fragments.some((f) => f.source === 'goal_graph')).toBe(true); // 不主动截

    // 异常超限：total > maxTokens×10 → 兜底截断
    const hugeProvider: FragmentProvider = {
      source: 'goal_graph' as any,
      async collect() {
        return { source: 'goal_graph' as any, data: { big: 'x'.repeat(200000) }, version: 1, collectedAt: Date.now() };
      },
    };
    const registry2 = new ContextFragmentRegistry();
    registry2.register(mockProvider('user_profile', { name: 'Alice' }));
    registry2.register(mockProvider('mission_state', { id: 'm1' }));
    registry2.register(hugeProvider);
    const eng2 = new ContextAssemblyEngine(registry2, undefined, undefined, undefined, undefined, {
      focusMode: true,
      maxTokens: 1000, // total ≈ 50000 tokens > 10000 → 兜底截
      enableVersioning: false,
      enableEnrichment: false,
    });
    const ctx2 = await eng2.assemble({ missionId: 'm1', goal: 'g' });
    expect(ctx2.fragments.every((f) => f.source !== 'goal_graph')).toBe(true); // 被兜底截掉
  });

  it('focusMode=false 保持原行为（模板全部片段 + slice 截断）', async () => {
    const legacy = makeEngine({ focusMode: false, maxFragments: 50, enableVersioning: false, enableEnrichment: false });
    const ctx = await legacy.assemble({ missionId: 'm1' });
    const sources = ctx.fragments.map((f) => f.source);
    // 原行为：default 模板定义的 7 个片段源全部收集（含 user_profile 等）
    expect(sources.length).toBe(7);
    expect(sources).toContain('user_profile');
    // 不生成 focusedSummary
    expect(ctx.focusedSummary).toBeUndefined();
  });
});

describe('Provider 归属标记（任务 ④）', () => {
  it('真实 Provider 片段 attribution=registered + providerAttribution 汇总', async () => {
    const engine = makeEngine({ focusMode: false, maxFragments: 50, enableVersioning: false, enableEnrichment: false });
    const ctx = await engine.assemble({ missionId: 'm1', goal: 'g' });

    // 每个片段都有归属标记（registered——所有来源都已注册 mock Provider）
    for (const f of ctx.fragments) {
      expect(f.attribution?.providerType).toBe('registered');
    }
    // 装配层汇总：source → providerType + collectedAt
    expect(ctx.providerAttribution).toBeDefined();
    expect(ctx.providerAttribution!.length).toBe(ctx.fragments.length);
    const profile = ctx.providerAttribution!.find((p) => p.source === 'user_profile');
    expect(profile?.providerType).toBe('registered');
    expect(typeof profile?.collectedAt).toBe('number');
  });

  it('缺失来源 → 兜底片段 attribution=fallback（区别于真实数据）', async () => {
    // 只注册 user_profile；mission_state 属 default 模板 required → 走 generateFallbackFragment
    const registry = new ContextFragmentRegistry();
    registry.register(mockProvider('user_profile', { name: 'Alice' }));
    const eng = new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, {
      focusMode: false,
      maxFragments: 50,
      enableVersioning: false,
      enableEnrichment: false,
    });
    const ctx = await eng.assemble({ missionId: 'm1', goal: 'g' });

    const profile = ctx.fragments.find((f) => f.source === 'user_profile');
    const mission = ctx.fragments.find((f) => f.source === 'mission_state');
    expect(profile?.attribution?.providerType).toBe('registered');
    expect(mission?.attribution?.providerType).toBe('fallback');

    const attr = ctx.providerAttribution!.find((p) => p.source === 'mission_state');
    expect(attr?.providerType).toBe('fallback');
  });
});

describe('近期摘要消费端拼接 + 风险分级（功能③ 遗留项）', () => {
  function mockReader(summaries: Array<{ taskRef: string; summary: string; archivedAt: number }>, throwError = false): RecentSummaryReader {
    return {
      loadRecent: async () => {
        if (throwError) throw new Error('reader 故障');
        return summaries.map((s) => ({ ...s, source: 'event-store' as const }));
      },
    };
  }

  it('focusMode + reader → recentSummaries 注入 + focusedSummary 含【近期任务摘要】节', async () => {
    const engine = makeEngine({
      focusMode: true,
      maxTokens: 8000,
      enableVersioning: false,
      enableEnrichment: false,
      recentSummaryReader: mockReader([
        { taskRef: 't1', summary: '完成空气检测设备设计', archivedAt: 100 },
        { taskRef: 't2', summary: '完成固件烧录验证', archivedAt: 200 },
      ]),
      recentSummaryLimit: 5,
    });

    const ctx = await engine.assemble({ missionId: 'm1', goal: '开发硬件', domain: 'hardware' });

    expect(ctx.recentSummaries).toBeDefined();
    expect(ctx.recentSummaries!.length).toBe(2);
    expect(ctx.recentSummaries![0].taskRef).toBe('t1');
    expect(ctx.recentSummaries![0].source).toBe('event-store');
    expect(ctx.focusedSummary).toContain('【近期任务摘要（≤2 条）】');
    expect(ctx.focusedSummary).toContain('- [t1] 完成空气检测设备设计');
  });

  it('reader 抛错 → 不阻断装配（recentSummaries 缺省，focusedSummary 无摘要节）', async () => {
    const engine = makeEngine({
      focusMode: true,
      maxTokens: 8000,
      enableVersioning: false,
      enableEnrichment: false,
      recentSummaryReader: mockReader([], true),
    });

    const ctx = await engine.assemble({ missionId: 'm1', goal: '开发硬件' });
    expect(ctx.contextId).toBeTruthy(); // 装配成功
    expect(ctx.recentSummaries).toBeUndefined();
    expect(ctx.focusedSummary).not.toContain('近期任务摘要');
  });

  it('无 reader → 不注入（向后兼容）', async () => {
    const engine = makeEngine({ focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '查询文档' });
    expect(ctx.recentSummaries).toBeUndefined();
  });

  it('默认风险分级：destroy→high / write→medium / query→low', () => {
    expect(defaultRiskGrader('delete the database and purge all records')).toBe('high');
    expect(defaultRiskGrader('create a new module and deploy it')).toBe('medium');
    expect(defaultRiskGrader('查询知识库文档')).toBe('low'); // 无英文关键词 → low
    expect(defaultRiskGrader('')).toBe('low');
  });

  it('assemble 写入 riskLevel（默认分级器按 goal）', async () => {
    const engine = makeEngine({ focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false });
    const ctx = await engine.assemble({ missionId: 'm1', goal: 'delete old version and purge cache' });
    expect(ctx.riskLevel).toBe('high');
  });

  it('自定义 riskGrader 覆写默认（setRiskGrader 生效）', async () => {
    const engine = makeEngine({ focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false });
    engine.setRiskGrader((_goal) => 'high'); // 一律 high
    const ctx = await engine.assemble({ missionId: 'm1', goal: '查询文档' });
    expect(ctx.riskLevel).toBe('high');
  });

  it('focusMode=false → 不注入近期摘要/风险（向后兼容）', async () => {
    const engine = makeEngine({
      focusMode: false,
      maxFragments: 50,
      enableVersioning: false,
      enableEnrichment: false,
      recentSummaryReader: mockReader([{ taskRef: 't1', summary: 'x', archivedAt: 1 }]),
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '查询' });
    expect(ctx.recentSummaries).toBeUndefined();
    expect(ctx.riskLevel).toBeUndefined();
  });
});
