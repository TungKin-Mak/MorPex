/**
 * Context Assembly 聚焦模式测试（功能③ Phase 1 — 原则①聚焦 / 原则④时机）
 *
 * 覆盖 ContextAssemblyEngine 聚焦模式：
 *   - focusMode=true 只收集"当前任务"片段（goal_graph/mission_state/artifact_lineage/custom）
 *   - focusedSummary 生成（含 goal/domain/taskRefs + 片段精简摘要）
 *   - token 估算截断（超出 maxTokens 从后续片段截掉）
 *   - focusMode=false 行为不变（向后兼容）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContextFragmentRegistry } from '../src/knowledge/context/ContextFragmentRegistry.js';
import type { FragmentProvider, ContextAssemblyInput } from '../src/knowledge/context/ContextFragmentRegistry.js';
import { ContextAssemblyEngine } from '../src/knowledge/context/ContextAssemblyEngine.js';

function mockProvider(source: string, data: Record<string, unknown>): FragmentProvider {
  return {
    source: source as any,
    async collect(_input: ContextAssemblyInput) {
      return { source: source as any, data, version: 1, collectedAt: Date.now() };
    },
  };
}

function makeEngine(config?: Partial<ConstructorParameters<typeof ContextAssemblyEngine>[5]>) {
  const registry = new ContextFragmentRegistry();
  // 注册全部 8 种来源（验证聚焦模式会跳过"历史倾向"片段）
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

describe('ContextAssemblyEngine 聚焦模式（功能③）', () => {
  let engine: ContextAssemblyEngine;

  beforeEach(() => {
    engine = makeEngine({ focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false });
  });

  it('focusMode=true 只收集当前任务片段（跳过 user_profile/behavior_twin/decision_history/agent_status）', async () => {
    const ctx = await engine.assemble({
      missionId: 'm1',
      goal: '开发空气检测设备',
      domain: 'hardware',
      taskRefs: ['ref-1'],
    });
    const sources = ctx.fragments.map((f) => f.source);
    // 聚焦片段源（default 模板含且在 FOCUS_SOURCES）应被收集
    for (const s of ['goal_graph', 'mission_state', 'artifact_lineage']) {
      expect(sources).toContain(s);
    }
    // "历史倾向"片段（default 模板含但不在 FOCUS_SOURCES）不应被收集
    for (const s of ['user_profile', 'behavior_twin', 'decision_history', 'agent_status']) {
      expect(sources).not.toContain(s);
    }
  });

  it('focusedSummary 包含 goal/domain/taskRefs 与片段摘要', async () => {
    const ctx = await engine.assemble({
      missionId: 'm1',
      goal: '开发空气检测设备',
      domain: 'hardware',
      taskRefs: ['ref-1', 'ref-2'],
    });
    expect(ctx.focusedSummary).toBeTruthy();
    expect(ctx.focusedSummary).toContain('开发空气检测设备');
    expect(ctx.focusedSummary).toContain('hardware');
    expect(ctx.focusedSummary).toContain('ref-1');
    expect(ctx.focusedSummary).toContain('goal_graph');
  });

  it('token 截断：超出 maxTokens 的片段被截掉', async () => {
    const bigProvider: FragmentProvider = {
      source: 'custom' as any,
      async collect() {
        return { source: 'custom' as any, data: { big: 'x'.repeat(20000) }, version: 1, collectedAt: Date.now() };
      },
    };
    const registry = new ContextFragmentRegistry();
    registry.register(mockProvider('goal_graph', { goals: [] }));
    registry.register(bigProvider);
    const smallEngine = new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, {
      focusMode: true,
      maxTokens: 1000, // 第一个大片段就超限
      enableVersioning: false,
      enableEnrichment: false,
    });
    const ctx = await smallEngine.assemble({ missionId: 'm1', goal: 'g' });
    // 大片段（~5000 tokens）超过 1000 上限且已有片段 → 被截
    expect(ctx.fragments.every((f) => f.source !== 'custom')).toBe(true);
  });

  it('focusMode=false 保持原行为（模板全部片段 + slice 截断）', async () => {
    const legacy = makeEngine({ focusMode: false, maxFragments: 50, enableVersioning: false, enableEnrichment: false });
    const ctx = await legacy.assemble({ missionId: 'm1' });
    const sources = ctx.fragments.map((f) => f.source);
    // 原行为：default 模板定义的 7 个片段源全部收集（含 user_profile 等历史倾向片段）
    expect(sources.length).toBe(7);
    expect(sources).toContain('user_profile');
    // 不生成 focusedSummary
    expect(ctx.focusedSummary).toBeUndefined();
  });
});
