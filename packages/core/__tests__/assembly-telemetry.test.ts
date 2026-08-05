/**
 * 上下文装配成本监控测试（会话 16c · 3+4）
 *
 * 覆盖：
 *   1. assemble 后 context.assemblyTelemetry（耗时/片段数/字符数/信息密度）
 *   2. 发射 context.assembly.telemetry 事件（观测聚合端点数据源）
 *   3. enableTelemetry=false → 不记录不发射
 */

import { describe, it, expect } from 'vitest';
import { ContextFragmentRegistry } from '../src/knowledge/context/ContextFragmentRegistry.js';
import type { FragmentProvider, ContextAssemblyInput } from '../src/knowledge/context/ContextFragmentRegistry.js';
import { ContextAssemblyEngine } from '../src/knowledge/context/ContextAssemblyEngine.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

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
  registry.register(mockProvider('user_profile', { name: 'Alice', prefs: 'x'.repeat(200) }));
  registry.register(mockProvider('goal_graph', { goals: [{ id: 'g1', title: '目标' }] }));
  registry.register(mockProvider('mission_state', { id: 'm1', status: 'EXECUTING' }));
  registry.register(mockProvider('artifact_lineage', { recent: [{ id: 'a1' }] }));
  registry.register(mockProvider('custom', { hint: 'custom constraint' }));
  return new ContextAssemblyEngine(registry, undefined, undefined, undefined, undefined, config);
}

describe('ContextAssemblyEngine — 装配成本监控（3+4）', () => {
  it('assemble 后携带 assemblyTelemetry（耗时/片段/字符/信息密度）', async () => {
    const engine = makeEngine({ focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false, enableTelemetry: true });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '开发空气检测设备', domain: 'hardware', taskRefs: ['r1'] });

    expect(ctx.assemblyTelemetry).toBeDefined();
    expect(ctx.assemblyTelemetry!.durationMs).toBeGreaterThanOrEqual(0);
    expect(ctx.assemblyTelemetry!.fragmentCount).toBeGreaterThan(0);
    expect(ctx.assemblyTelemetry!.totalChars).toBeGreaterThan(0);
    expect(ctx.assemblyTelemetry!.focusedSummaryChars).toBeGreaterThan(0);
    // 信息密度 = 聚焦摘要字符 / 原始片段总字符（可 >1：聚焦摘要含 goal/任务身份等非片段文本；>0 且有限即可）
    expect(ctx.assemblyTelemetry!.infoDensity).toBeGreaterThan(0);
    expect(Number.isFinite(ctx.assemblyTelemetry!.infoDensity)).toBe(true);
  });

  it('发射 context.assembly.telemetry 事件', async () => {
    const bus = new EventBus();
    const events: Array<Record<string, unknown>> = [];
    bus.on('context.assembly.telemetry', (e: unknown) => events.push(e as Record<string, unknown>));

    const engine = makeEngine({
      focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false,
      enableTelemetry: true, eventBus: bus,
    });
    await engine.assemble({ missionId: 'm1', goal: '目标', domain: 'hardware', taskRefs: ['r1'] });

    expect(events.length).toBe(1);
    const evt = events[0] as { type: string; payload: { missionId: string; durationMs: number; fragmentCount: number } };
    expect(evt.type).toBe('context.assembly.telemetry');
    expect(evt.payload.missionId).toBe('m1');
    expect(evt.payload.fragmentCount).toBeGreaterThan(0);
  });

  it('enableTelemetry=false → 不记录不发射', async () => {
    const bus = new EventBus();
    let emitted = 0;
    bus.on('context.assembly.telemetry', () => { emitted++; });

    const engine = makeEngine({
      focusMode: true, maxTokens: 8000, enableVersioning: false, enableEnrichment: false,
      enableTelemetry: false, eventBus: bus,
    });
    const ctx = await engine.assemble({ missionId: 'm1', goal: '目标', domain: 'hardware', taskRefs: ['r1'] });

    expect(ctx.assemblyTelemetry).toBeUndefined();
    expect(emitted).toBe(0);
  });
});
