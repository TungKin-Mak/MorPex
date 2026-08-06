/**
 * 任务间经验主动注入测试（会话 16d · P2）
 *
 * 覆盖：
 *   1. ExperienceInjectionService：按 goal/domain 匹配可学习事件 → 规避提示
 *   2. ContextAssemblyEngine：experienceInjector 注入聚焦上下文
 */

import { describe, it, expect } from 'vitest';
import { ExperienceInjectionService } from '../src/evolution/ExperienceInjectionService.js';
import type { LearningEvent } from '../src/evolution/LearningEventDetector.js';
import { ContextFragmentRegistry } from '../src/knowledge/context/ContextFragmentRegistry.js';
import type { FragmentProvider, ContextAssemblyInput } from '../src/knowledge/context/ContextFragmentRegistry.js';
import { ContextAssemblyEngine } from '../src/knowledge/context/ContextAssemblyEngine.js';

function mkEvents(...types: LearningEvent['type'][]): LearningEvent[] {
  return types.map((type, i) => ({ type, capability: 'Backend Development', detail: 'x', step: `s${i}`, timestamp: i }));
}

describe('ExperienceInjectionService — 经验注入', () => {
  it('有空参事件 → 注入填全参数提示', () => {
    const svc = new ExperienceInjectionService({ getEvents: () => mkEvents('empty-param') });
    const hint = svc.inject('生成电商价格检查方案', 'ecommerce');
    expect(hint).toContain('工具参数为空');
    expect(hint).toContain('knowledge 需 query');
  });

  it('有安全拦截事件 → 注入 Gate 凭证提示', () => {
    const svc = new ExperienceInjectionService({ getEvents: () => mkEvents('safety-block') });
    const hint = svc.inject('生成报告', 'software');
    expect(hint).toContain('安全拦截');
  });

  it('无事件 → 返回 null（不注入垃圾）', () => {
    const svc = new ExperienceInjectionService({ getEvents: () => [] });
    expect(svc.inject('查询', 'ecommerce')).toBeNull();
  });

  it('按 domain 匹配：事件 capability 含 domain → 命中', () => {
    const evts: LearningEvent[] = [{ type: 'high-retry', capability: 'ecommerce', detail: 'x', timestamp: 1 }];
    const svc = new ExperienceInjectionService({ getEvents: () => evts });
    const hint = svc.inject('优化商品标题', 'ecommerce');
    expect(hint).toContain('反复重试');
  });
});

describe('ContextAssemblyEngine — experienceInjector 接入', () => {
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
    registry.register(mockProvider('custom', { hint: 'constraint' }));
    return new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, config);
  }

  it('注入器返回提示 → focusedSummary 含【经验规避】', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false,
      experienceInjector: { inject: async () => '⚠️ 历史任务多次因工具参数为空失败' },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '生成报告', domain: 'software', taskRefs: ['r1'] });
    expect(ctx.focusedSummary).toContain('经验规避');
    expect(ctx.focusedSummary).toContain('工具参数为空');
  });

  it('注入器返回 null → 不注入', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false,
      experienceInjector: { inject: async () => null },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '生成报告', domain: 'software', taskRefs: ['r1'] });
    expect(ctx.focusedSummary).not.toContain('经验规避');
  });

  it('注入器异常 → 不阻断装配', async () => {
    const engine = makeEngine({
      focusMode: true, enableVersioning: false, enableEnrichment: false,
      experienceInjector: { inject: async () => { throw new Error('injector down'); } },
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '生成报告', domain: 'software', taskRefs: ['r1'] });
    expect(ctx.contextId).toBeTruthy();
  });
});
