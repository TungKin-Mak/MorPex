/**
 * ontology-gate-tiering.test.ts — Graded Ontology Gate (vNext+) 行为测试
 *
 * 验证：
 *   1. tier-0 Critical：QueryMiss → 强制 needs_human_review + 禁止缓存
 *   2. tier-2 Draft：QueryMiss → ControlledExploration（不强制人工审批）
 *   3. tier-1 Standard：允许短 TTL 缓存（相同目标命中缓存 → 不重复 QueryMiss）
 *   4. QueryMiss 事件写入 EventStore（ontology.query.miss，可观测）
 *   5. 有事实时正常通过（不产生 QueryMiss）
 */

import { describe, it, expect } from 'vitest';
import { SystemMetadataGraph } from '../src/metadata/SystemMetadataGraph.js';
import { OntologyService } from '../src/ontology/OntologyService.js';
import { ObjectTypeRegistry } from '../src/ontology/ObjectTypeRegistry.js';
import { ForcedQueryGuard } from '../src/ontology/ForcedQueryGuard.js';
import { runOntologyGroundedReasoning } from '../src/ontology/runOntologyGroundedReasoning.js';
import type { GroundedReasoningResult } from '../src/ontology/runOntologyGroundedReasoning.js';
import type { RiskTier } from '../src/ontology/types.js';

// mock piBridge：
//   - Phase 1 查询计划：返回无 queries 的 JSON → 触发默认安全查询（空图谱 → 无结果 → QueryMiss）
//   - Phase 2 提案：返回合法 JSON proposal（parse 成功，needs_human_review 不因解析失败置真）
const emptyPiBridge = {
  generateText: async () => ({
    text: JSON.stringify({
      reasoning: '空图谱，无可用事实',
      referenced_object_ids: [],
      proposal: { plan: [] },
    }),
  }),
};

// mock IEventStore：捕获追加事件
function createMockEventStore() {
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  return {
    events,
    async append(e: { type: string; payload?: Record<string, unknown> }) { events.push(e); },
    async appendBatch() {},
    async appendDecision() {},
    async query() { return []; },
    async queryDecisions() { return []; },
    replay: async function* () { /* noop */ },
    async getLatestSequence() { return events.length; },
    async getStats() { return { totalEvents: events.length, totalDecisions: 0, byType: {}, latestSequence: events.length, dbSizeBytes: 0 }; },
    async clear() { events.length = 0; },
    async close() {},
  };
}

function setup() {
  const graph = new SystemMetadataGraph();
  const registry = new ObjectTypeRegistry();
  const ontology = new OntologyService(graph, registry);
  const guard = new ForcedQueryGuard();
  const store = createMockEventStore();
  return { ontology, guard, store };
}

async function runGate(
  goal: string,
  riskTier: RiskTier,
  scenario = 't',
): Promise<{ res: GroundedReasoningResult; store: ReturnType<typeof createMockEventStore> }> {
  const { ontology, guard, store } = setup();
  const res = await runOntologyGroundedReasoning({
    goal,
    ontology,
    guard,
    piBridge: emptyPiBridge,
    eventStore: store as never,
    scenario,
    riskTier,
  });
  return { res, store };
}

describe('Graded Ontology Gate (vNext+)', () => {
  it('tier-0 Critical：QueryMiss 强制 needs_human_review，且写入 QueryMiss 事件', async () => {
    const { res, store } = await runGate('critical miss goal', 'tier-0');
    expect(res.hasUsefulFacts).toBe(false);
    expect(res.riskTier).toBe('tier-0');
    expect(res.proposal.needs_human_review).toBe(true);
    expect(res.queryMiss?.tier).toBe('tier-0');
    expect(res.queryMiss?.controlledExploration).toBe(false);
    // QueryMiss 事件必须可观测（QueryMiss is Signal）
    expect(store.events.some((e) => e.type === 'ontology.query.miss')).toBe(true);
  });

  it('tier-2 Draft：QueryMiss 进入 ControlledExploration，不强制人工审批', async () => {
    const { res, store } = await runGate('draft exploration goal', 'tier-2');
    expect(res.hasUsefulFacts).toBe(false);
    expect(res.queryMiss?.controlledExploration).toBe(true);
    // tier-2 允许尽力而为，不硬性要求 human review
    expect(res.proposal.needs_human_review).toBeFalsy();
    // missing_info 带受控探索标记
    expect(res.proposal.missing_info?.some((m) => m.includes('ControlledExploration'))).toBe(true);
    expect(store.events.some((e) => e.type === 'ontology.query.miss')).toBe(true);
  });

  it('tier-1 Standard 命中缓存（1 次 QueryMiss）；tier-0 禁止缓存（2 次 QueryMiss）', async () => {
    // tier-1：两次相同调用共享 store → 第二次命中缓存，仅 1 次 QueryMiss
    const { ontology, guard, store } = setup();
    await runOntologyGroundedReasoning({
      goal: 'cached goal', ontology, guard, piBridge: emptyPiBridge, eventStore: store as never, scenario: 'cache', riskTier: 'tier-1',
    });
    await runOntologyGroundedReasoning({
      goal: 'cached goal', ontology, guard, piBridge: emptyPiBridge, eventStore: store as never, scenario: 'cache', riskTier: 'tier-1',
    });
    const missCountTier1 = store.events.filter((e) => e.type === 'ontology.query.miss').length;
    expect(missCountTier1).toBe(1);

    // tier-0：两次相同调用共享 store → 不缓存，2 次 QueryMiss（强制完整两阶段）
    const s2 = createMockEventStore();
    const { ontology: o2, guard: g2 } = setup();
    await runOntologyGroundedReasoning({
      goal: 'critical goal', ontology: o2, guard: g2, piBridge: emptyPiBridge, eventStore: s2 as never, scenario: 'cache', riskTier: 'tier-0',
    });
    await runOntologyGroundedReasoning({
      goal: 'critical goal', ontology: o2, guard: g2, piBridge: emptyPiBridge, eventStore: s2 as never, scenario: 'cache', riskTier: 'tier-0',
    });
    const missCountTier0 = s2.events.filter((e) => e.type === 'ontology.query.miss').length;
    expect(missCountTier0).toBe(2);
  });

  it('tier-2 有事实时正常通过（不产生 QueryMiss）', async () => {
    // 造一个有实体的事实图谱
    const { ontology, guard, store } = setup();
    await ontology.upsertObject({ type: 'Mission', properties: { title: 'T1', objective: '测试任务', status: 'active' } });
    const res = await runOntologyGroundedReasoning({
      goal: '有事实的目标',
      ontology,
      guard,
      piBridge: emptyPiBridge, // 触发默认查询 → 命中 Mission 实体
      eventStore: store as never,
      scenario: 't',
      riskTier: 'tier-2',
    });
    expect(res.hasUsefulFacts).toBe(true);
    expect(res.queryMiss).toBeUndefined();
    expect(store.events.some((e) => e.type === 'ontology.query.miss')).toBe(false);
  });
});
