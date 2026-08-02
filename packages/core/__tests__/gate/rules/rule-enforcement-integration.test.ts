/**
 * gate/rules 集成测试 — 规则中断更正挂载到 runOntologyGroundedReasoning
 *
 * 验证：挂载点生效（Phase 2 后检查）——
 *   1. 无规则 → 完全旁路（piBridge 仅 2 次调用：Phase1+Phase2，无额外重试）
 *   2. 修正成功：违规输出 → 带约束重试 → 合规输出 → 放行（无违规事件）
 *   3. 重试用尽：多规则持续违规 → 转人工 + violation 事件（retriesExhausted）+ 降级事件
 *   4. 单规则持续违规 → 连续命中 2 次降级 → 转人工（不静默放行）
 *
 * ⚠️ 注意：runOntologyGroundedReasoning 有模块级 LRU 缓存（goal<80 字符 + tier-1/2 启用），
 * 每个用例必须用不同 goal/scenario 组合，否则命中缓存跳过 Phase 1+2。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SystemMetadataGraph } from '../../../src/knowledge/graph/SystemMetadataGraph.js';
import { OntologyService } from '../../../src/knowledge/ontology/OntologyService.js';
import { ObjectTypeRegistry } from '../../../src/knowledge/ontology/ObjectTypeRegistry.js';
import { ForcedQueryGuard } from '../../../src/gate/ForcedQueryGuard.js';
import { runOntologyGroundedReasoning } from '../../../src/gate/runOntologyGroundedReasoning.js';
import { RuleRegistry } from '../../../src/gate/rules/RuleRegistry.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';

// 有状态 piBridge：第 1 次调用（Phase 1 查询计划）返回空 queries → 默认安全查询；
// 后续按序返回 Phase 2（推理）输出序列。
function createSequencePiBridge(phase2Outputs: string[]) {
  let call = 0;
  return {
    callCount: () => call,
    generateText: async () => {
      call++;
      if (call === 1) {
        return { text: JSON.stringify({ queries: [], reasoning: '默认安全查询' }) };
      }
      const idx = Math.min(call - 2, phase2Outputs.length - 1);
      return { text: phase2Outputs[idx] };
    },
  };
}

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

function makeRule(id: string, pattern: string): RuleEntity {
  return {
    id,
    tier: 'tier-1',
    domain: 'ecommerce',
    severity: 'ERROR',
    ruleType: 'regex',
    target: 'proposal.payload',
    disallowedPattern: pattern,
    priority: 100,
    status: 'active',
    source: 'manual',
    description: `禁止 ${pattern}`,
  };
}

function proposalJson(text: string): string {
  return JSON.stringify({
    reasoning: '基于事实推理',
    referenced_object_ids: [],
    proposal: { content: text },
  });
}

async function runGate(
  goal: string,
  piBridge: ReturnType<typeof createSequencePiBridge>,
  store: ReturnType<typeof createMockEventStore>,
) {
  const { ontology, guard } = setup();
  return runOntologyGroundedReasoning({
    goal,
    ontology,
    guard,
    piBridge,
    eventStore: store as never,
    scenario: 'rule-integration',
    riskTier: 'tier-2', // tier-2 空事实不强制人工 → 隔离规则路径的 needs_human_review
  });
}

describe('gate/rules 集成（挂载 runOntologyGroundedReasoning）', () => {
  beforeEach(() => {
    RuleRegistry.clear();
  });

  it('无规则 → 完全旁路：piBridge 仅 2 次调用（Phase1+Phase2），无额外重试', async () => {
    const piBridge = createSequencePiBridge([proposalJson('正常文案')]);
    const { store } = setup();
    const res = await runGate('无规则旁路目标', piBridge, store);

    expect(piBridge.callCount()).toBe(2);
    expect(res.ruleViolations).toEqual([]);
    expect(store.events.some((e) => e.type === 'gate.rule.violation')).toBe(false);
  });

  it('修正成功：违规输出 → 带约束重试 → 合规输出 → 放行', async () => {
    RuleRegistry.register('ecommerce', makeRule('no_airpods', 'AirPods|Apple'));
    const piBridge = createSequencePiBridge([
      proposalJson('这款耳机比 AirPods 更好'), // 首次违规
      proposalJson('这款耳机续航 30 小时'),    // 重试合规
    ]);
    const { store } = setup();
    const res = await runGate('修正成功目标', piBridge, store);

    // 3 次调用 = Phase1 + Phase2×2（重试 1 次）
    expect(piBridge.callCount()).toBe(3);
    // 最终 proposal 是重试后的合规版本
    expect(res.proposal.payload).toEqual({ content: '这款耳机续航 30 小时' });
    // 修正成功 → 不转人工、无 ERROR 违规事件
    expect(res.proposal.needs_human_review).toBeFalsy();
    expect(store.events.some((e) => e.type === 'gate.rule.violation')).toBe(false);
  });

  it('重试用尽：多规则持续违规 → 转人工 + violation(retriesExhausted) + 降级事件', async () => {
    RuleRegistry.register('ecommerce', makeRule('no_airpods', 'AirPods'));
    RuleRegistry.register('ecommerce', makeRule('no_apple', 'Apple'));
    // attempt0: AirPods 命中(A=1)；attempt1: 两者命中(A=2→降级A, B=1)；
    // attempt2: Apple 命中(B=2→降级B) + attempt==MAX-1 → 重试用尽转人工
    const piBridge = createSequencePiBridge([
      proposalJson('含 AirPods'),
      proposalJson('含 AirPods 和 Apple'),
      proposalJson('含 Apple'),
    ]);
    const { store } = setup();
    const res = await runGate('重试用尽目标', piBridge, store);

    expect(piBridge.callCount()).toBe(4); // Phase1 + Phase2×3
    expect(res.proposal.needs_human_review).toBe(true);
    expect(res.proposal.missing_info?.some((m) => m.includes('规则中断更正失败'))).toBe(true);
    // ERROR 违规事件（retriesExhausted=true）
    const violations = store.events.filter((e) => e.type === 'gate.rule.violation');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].payload?.retriesExhausted).toBe(true);
    // 降级事件
    expect(store.events.filter((e) => e.type === 'gate.rule.downgraded').length).toBe(2);
  });

  it('单规则持续违规 → 连续命中 2 次降级 → 转人工（不静默放行）', async () => {
    RuleRegistry.register('ecommerce', makeRule('no_airpods', 'AirPods'));
    const piBridge = createSequencePiBridge([
      proposalJson('含 AirPods'),
      proposalJson('含 AirPods'),
      proposalJson('含 AirPods'),
    ]);
    const { store } = setup();
    const res = await runGate('单规则降级目标', piBridge, store);

    // attempt0 命中(hits=1) → attempt1 命中(hits=2→降级) → attempt2 规则已降级→无违规 break → 补丁转人工
    expect(piBridge.callCount()).toBe(4); // Phase1 + Phase2×3
    expect(res.proposal.needs_human_review).toBe(true);
    expect(res.proposal.missing_info?.some((m) => m.includes('临时降级'))).toBe(true);
    expect(store.events.filter((e) => e.type === 'gate.rule.downgraded').length).toBe(1);
  });

  it('eventStore undefined（4 调用方中 2 个不传）→ 规则路径不崩、仍转人工', async () => {
    RuleRegistry.register('ecommerce', makeRule('no_airpods', 'AirPods'));
    const piBridge = createSequencePiBridge([
      proposalJson('含 AirPods'),
      proposalJson('含 AirPods'),
      proposalJson('含 AirPods'),
    ]);
    const { ontology, guard } = setup();
    const res = await runOntologyGroundedReasoning({
      goal: '无eventStore目标',
      ontology,
      guard,
      piBridge,
      // 不传 eventStore —— 模拟 MorPexRuntime / HierarchicalPlanner 调用形态
      scenario: 'rule-integration-no-store',
      riskTier: 'tier-2',
    });

    expect(piBridge.callCount()).toBe(4);
    expect(res.proposal.needs_human_review).toBe(true);
  });
});
