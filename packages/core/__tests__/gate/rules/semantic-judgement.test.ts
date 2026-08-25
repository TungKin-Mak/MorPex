/**
 * gate/rules 集成测试 — 通用两级模型·第二级（LLM 语义判断 + 修正重生成）
 *
 * 验证挂载到 runOntologyGroundedReasoning 的 keyword 语义复核：
 *   1. 命中关键词 + triggered=true → 语义 LLM 被调 → 带约束重试 → 合规放行
 *   2. 命中关键词 + triggered=false → 该规则不算违规，无重试放行
 *   3. 语义 JSON 解析失败 → 保守 triggered=true → 持续违规 → 降级转人工（不静默放行）
 *   4. regex 命中不触发语义 LLM（成本控制：仅 keyword 命中才调语义）
 *
 * ⚠️ 缓存注意：runOntologyGroundedReasoning 有模块级 LRU 缓存（goal<80 + tier-1/2），
 * 每个用例必须用不同 goal/scenario 组合避免命中缓存。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SystemMetadataGraph } from '../../../src/knowledge/graph/SystemMetadataGraph.js';
import { OntologyService } from '../../../src/knowledge/ontology/OntologyService.js';
import { ObjectTypeRegistry } from '../../../src/knowledge/ontology/ObjectTypeRegistry.js';
import { ForcedQueryGuard } from '../../../src/gate/ForcedQueryGuard.js';
import { runOntologyGroundedReasoning } from '../../../src/gate/runOntologyGroundedReasoning.js';
import { RuleRegistry } from '../../../src/gate/rules/RuleRegistry.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';

const SEMANTIC_SYSTEM = '你是规则合规审查员。根据规则要求判断内容是否合规。';

type Judgement = { triggered: boolean; reason: string; suggestion: string } | 'invalid-json';

/**
 * 有状态 piBridge：按 system 区分——
 *   - 语义判断（system=审查员）→ 返回 judgement（可模拟解析失败）
 *   - 其余（Phase 1 查询计划 / Phase 2 推理 / 重试）→ 按序返回 phase2Outputs
 */
function createKeywordPiBridge(phase2Outputs: string[], judgement: Judgement) {
  let calls = 0;
  let phase2Idx = 0;
  let semanticCalls = 0;
  return {
    callCount: () => calls,
    semanticCallCount: () => semanticCalls,
    generateText: async ({ prompt, system }: { prompt: string; system?: string }) => {
      calls++;
      if (system === SEMANTIC_SYSTEM) {
        semanticCalls++;
        if (judgement === 'invalid-json') return { text: '这不是 JSON，无法解析' };
        return { text: JSON.stringify(judgement) };
      }
      if (calls === 1) {
        // 合法非空计划（过 sanitizeQueryPlan 白名单，避免触发空计划重试+默认查询加固分支）
        // 契约见 runOntologyGroundedReasoning.parseQueryPlanRobust/sanitizeQueryPlan
        return { text: JSON.stringify({ queries: [{ tool: 'ontology_queryObjects', args: { type: 'RuleEntity', limit: 10 } }], reasoning: '默认安全查询' }) };
      }
      const idx = Math.min(phase2Idx, phase2Outputs.length - 1);
      const out = phase2Outputs[idx];
      phase2Idx++;
      return { text: out };
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

function makeKeywordRule(id: string, keywords: string[], description: string): RuleEntity {
  return {
    id,
    tier: 'tier-1',
    domain: 'ecommerce',
    severity: 'ERROR',
    ruleType: 'keyword',
    target: 'proposal.payload',
    keywords,
    priority: 100,
    status: 'active',
    source: 'manual',
    description,
  };
}

function makeRegexRule(id: string, pattern: string): RuleEntity {
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
  piBridge: ReturnType<typeof createKeywordPiBridge>,
  store: ReturnType<typeof createMockEventStore>,
) {
  const { ontology, guard } = setup();
  return runOntologyGroundedReasoning({
    goal,
    ontology,
    guard,
    piBridge,
    eventStore: store as never,
    scenario: 'keyword-integration',
    riskTier: 'tier-2', // tier-2 空事实不强制人工 → 隔离规则路径
  });
}

describe('keyword 第二级语义判断（集成）', () => {
  beforeEach(() => {
    RuleRegistry.clear();
  });

  it('命中 + triggered=true → 语义 LLM 被调 → 带约束重试 → 合规放行', async () => {
    RuleRegistry.register('ecommerce', makeKeywordRule('price_ok', ['价格'], '价格必须含税，不得虚假紧迫'));
    const piBridge = createKeywordPiBridge(
      [
        proposalJson('本店 价格 仅剩 1 件，速抢！'), // 首次：含关键词 + 语义触发
        proposalJson('本店含税 199 元，库存充足'),   // 重试：不再含关键词 → 不触发
      ],
      { triggered: true, reason: '使用虚假紧迫感话术', suggestion: '改为真实库存说明' },
    );
    const { store } = setup();
    const res = await runGate('价格语义触发修正目标', piBridge, store);

    // 调用 = Phase1 + Phase2×2（重试 1 次）+ 语义判断 1 次（仅首轮命中时）
    expect(piBridge.semanticCallCount()).toBe(1);
    expect(piBridge.callCount()).toBe(4);
    // 最终 proposal 为修正后版本
    expect(res.proposal.payload).toEqual({ content: '本店含税 199 元，库存充足' });
    // 修正成功 → 不转人工、无违规事件
    expect(res.proposal.needs_human_review).toBeFalsy();
    expect(store.events.some((e) => e.type === 'gate.rule.violation')).toBe(false);
  });

  it('命中 + triggered=false → 该规则不算违规，无重试放行', async () => {
    RuleRegistry.register('ecommerce', makeKeywordRule('price_ok', ['价格'], '价格必须含税'));
    const piBridge = createKeywordPiBridge(
      [proposalJson('本店 价格 含税 199 元，库存充足')],
      { triggered: false, reason: '价格已含税且无虚假紧迫', suggestion: '' },
    );
    const { store } = setup();
    const res = await runGate('价格语义不触发放行目标', piBridge, store);

    // 调用 = Phase1 + Phase2 + 语义判断 1 次（无重试）
    expect(piBridge.semanticCallCount()).toBe(1);
    expect(piBridge.callCount()).toBe(3);
    // 不算违规 → 不转人工、无违规事件
    expect(res.proposal.needs_human_review).toBeFalsy();
    expect(store.events.some((e) => e.type === 'gate.rule.violation')).toBe(false);
    expect(res.ruleViolations?.some((v) => v.ruleId === 'price_ok')).toBeFalsy();
  });

  it('语义 JSON 解析失败 → 保守 triggered=true → 持续违规 → 降级转人工（不静默放行）', async () => {
    RuleRegistry.register('ecommerce', makeKeywordRule('rate_ok', ['利率'], '利率必须披露年化与实际成本'));
    const piBridge = createKeywordPiBridge(
      [
        proposalJson('年化 利率 5%'),
        proposalJson('年化 利率 5%'),
      ],
      'invalid-json', // 每次语义判断都解析失败 → 保守触发
    );
    const { store } = setup();
    const res = await runGate('利率语义解析失败保守目标', piBridge, store);

    // 保守触发 → 进入重试；连续命中 2 次 → 降级 + 转人工（不静默放行）
    // 注：降级路径只产生 downgraded 事件（violation 事件仅重试用尽时产生）
    expect(piBridge.semanticCallCount()).toBeGreaterThanOrEqual(2);
    expect(res.proposal.needs_human_review).toBe(true);
    expect(store.events.some((e) => e.type === 'gate.rule.downgraded')).toBe(true);
  });

  it('regex 命中不触发语义 LLM（成本控制：仅 keyword 命中才调语义）', async () => {
    RuleRegistry.register('ecommerce', makeRegexRule('no_airpods', 'AirPods'));
    const piBridge = createKeywordPiBridge(
      [
        proposalJson('这款耳机比 AirPods 更好'),
        proposalJson('这款耳机续航 30 小时'),
      ],
      { triggered: true, reason: '不应触发', suggestion: '' },
    );
    const { store } = setup();
    const res = await runGate('regex 成本控制目标', piBridge, store);

    // regex 违规走现有重试，不调语义判断
    expect(piBridge.semanticCallCount()).toBe(0);
    expect(piBridge.callCount()).toBe(3); // Phase1 + Phase2×2
    expect(res.proposal.payload).toEqual({ content: '这款耳机续航 30 小时' });
    expect(res.proposal.needs_human_review).toBeFalsy();
  });
});
