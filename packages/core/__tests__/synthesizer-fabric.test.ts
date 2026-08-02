/**
 * CrossDepartmentKnowledgeSynthesizer + ExecutionFabric 测试
 * （L4 Cognition 跨部门融合 / L5 Execution Fabric）— 此前均无直接行为测试
 *
 * Synthesizer：
 *   - 依赖注入（memoryWiki/metaLearner/behaviorTwin）+ isReady
 *   - synthesizeAcrossDepartments：无源部门空结果 / 有源部门融合出知识 / highValueMigration 判定
 *   - migratePattern：低相似度失败 / 中相似度 adapted / 低中 partial / 成功发 brain.pattern.migrated 事件
 *   - getStats 统计递增
 *
 * ExecutionFabric：
 *   - Agent 能力注册/注销 + 能力解析执行
 *   - 无能力 Agent → 失败 / findCoverage / resolveMultipleCapabilities
 *   - 重试机制（失败后按 maxRetries 重试） / agentId 直连
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { CrossDepartmentKnowledgeSynthesizer } from '../src/cognition/CrossDepartmentKnowledgeSynthesizer.js';
import type { MemoryWikiQueryLike, BehaviorTwinCompareLike } from '../src/cognition/CrossDepartmentKnowledgeSynthesizer.js';
import { ExecutionFabric } from '../src/execution/fabric/ExecutionFabric.js';
import type { ConnectorRegistry } from '../packages/connectors/src/ConnectorRegistry.js';

// ── Synthesizer stubs ──

function wikiStub(results: Array<{ content: string; relevance: number; source: string }>): MemoryWikiQueryLike {
  return { query: async () => results };
}

function twinStub(similarity: number): BehaviorTwinCompareLike {
  return {
    compareDepartments: async () => ({ similarity, dimensionScores: {}, commonTraits: [] }),
  };
}

describe('CrossDepartmentKnowledgeSynthesizer — 依赖注入与就绪', () => {
  it('constructor 无 EventBus → 抛错', () => {
    expect(() => new CrossDepartmentKnowledgeSynthesizer(null as any)).toThrow(/EventBus 是必填参数/);
  });

  it('isReady：无 memoryWiki → false；注入后 → true', () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    expect(s.isReady()).toBe(false);
    s.setMemoryWiki(wikiStub([]));
    expect(s.isReady()).toBe(true);
  });
});

describe('CrossDepartmentKnowledgeSynthesizer — 跨部门融合', () => {
  it('无可用源部门 → 空融合结果（confidence 0）', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    const r = await s.synthesizeAcrossDepartments([], 'marketing', '产品定价策略');
    expect(r.fusedKnowledge).toBe('');
    expect(r.confidence).toBe(0);
    expect(r.sourceDepts).toHaveLength(0);
    expect(r.highValueMigration).toBe(false);
  });

  it('有源部门 + memoryWiki/behaviorTwin 注入 → 融合出知识 + confidence', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    s.setMemoryWiki(wikiStub([{ content: '工程团队缓存优化经验', relevance: 0.9, source: 'wiki' }]));
    s.setBehaviorTwin(twinStub(0.8));
    const r = await s.synthesizeAcrossDepartments(['engineering'], 'marketing', '缓存优化');
    expect(r.fusedKnowledge.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.sourceDepts).toContain('engineering');
    expect(r.highValueMigration).toBe(true); // confidence>0.7 && similarity>0.6
    expect(r.targetDept).toBe('marketing');
  });

  it('融合后发射 brain.knowledge.fused 事件', async () => {
    const bus = new EventBus();
    const s = new CrossDepartmentKnowledgeSynthesizer(bus);
    s.setMemoryWiki(wikiStub([{ content: '知识', relevance: 0.8, source: 'wiki' }]));
    s.setBehaviorTwin(twinStub(0.6));
    const seen: string[] = [];
    bus.onProjected((e) => seen.push(e.type));
    await s.synthesizeAcrossDepartments(['engineering'], 'marketing', '查询');
    expect(seen).toContain('brain.knowledge.fused');
  });

  it('getStats：totalSynthesisCalls 递增', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    await s.synthesizeAcrossDepartments([], 'eng', 'x');
    await s.synthesizeAcrossDepartments([], 'eng', 'y');
    expect(s.getStats().totalSynthesisCalls).toBe(2);
  });
});

describe('CrossDepartmentKnowledgeSynthesizer — 模式迁移', () => {
  it('相似度过低（0.1）→ failed', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    s.setBehaviorTwin(twinStub(0.1));
    const r = await s.migratePattern('pat_1', 'engineering', 'marketing');
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('相似度过低');
  });

  it('相似度 0.5 → adapted（confidence 0.6 = 0.5*1.2）', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    s.setBehaviorTwin(twinStub(0.5));
    const r = await s.migratePattern('pat_2', 'engineering', 'marketing');
    expect(r.status).toBe('adapted');
    expect(r.adaptationConfidence).toBeCloseTo(0.6, 2);
    expect(r.adaptedContent).toContain('pat_2');
  });

  it('相似度 0.3 → partial（<0.4 需要适配）', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    s.setBehaviorTwin(twinStub(0.3));
    const r = await s.migratePattern('pat_3', 'engineering', 'marketing');
    expect(r.status).toBe('partial');
  });

  it('成功迁移发射 brain.pattern.migrated 事件 + stats 递增', async () => {
    const bus = new EventBus();
    const s = new CrossDepartmentKnowledgeSynthesizer(bus);
    s.setBehaviorTwin(twinStub(0.5));
    const seen: string[] = [];
    bus.onProjected((e) => seen.push(e.type));
    await s.migratePattern('pat_4', 'engineering', 'marketing');
    expect(seen).toContain('brain.pattern.migrated');
    expect(s.getStats().totalMigrations).toBe(1);
    expect(s.getStats().successfulMigrations).toBe(1);
  });

  it('无 behaviorTwin → 默认相似度 0.5 → adapted', async () => {
    const s = new CrossDepartmentKnowledgeSynthesizer(new EventBus());
    const r = await s.migratePattern('pat_5', 'engineering', 'marketing');
    expect(r.status).toBe('adapted');
  });
});

// ── ExecutionFabric ──

function makeRegistry(impl?: (req: any) => Promise<{ success: boolean; data?: unknown; error?: string; duration: number }>) {
  const execute = impl ?? (async (req: any) => ({ success: true, data: `done:${req.action}`, duration: 1 }));
  return { execute } as unknown as ConnectorRegistry;
}

describe('ExecutionFabric — 能力解析与执行', () => {
  it('注册能力后 execute 经 connector 成功执行', async () => {
    const fabric = new ExecutionFabric(makeRegistry(), { cacheEnabled: false });
    fabric.registerAgentCapabilities('a1', 'agent1', ['code'], 0.9, 0.3);
    const r = await fabric.execute('code', 'fs.write', { content: 'x' });
    expect(r.success).toBe(true);
  });

  it('未知能力 → 失败（No available agent）', async () => {
    const fabric = new ExecutionFabric(makeRegistry(), { cacheEnabled: false });
    fabric.registerAgentCapabilities('a1', 'agent1', ['code']);
    const r = await fabric.execute('design', 'fs.write', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('No available agent');
  });

  it('unregisterAgent 后能力不再可解析', async () => {
    const fabric = new ExecutionFabric(makeRegistry(), { cacheEnabled: false });
    fabric.registerAgentCapabilities('a1', 'agent1', ['code']);
    expect(fabric.findCoverage(['code']).covered).toEqual(['code']);
    fabric.unregisterAgent('a1');
    expect(fabric.findCoverage(['code']).uncovered).toEqual(['code']);
  });

  it('findCoverage 报告覆盖/未覆盖比例', async () => {
    const fabric = new ExecutionFabric(makeRegistry(), { cacheEnabled: false });
    fabric.registerAgentCapabilities('a1', 'agent1', ['code', 'test']);
    const c = fabric.findCoverage(['code', 'test', 'design']);
    expect(c.covered).toEqual(['code', 'test']);
    expect(c.uncovered).toEqual(['design']);
    expect(c.coverageRatio).toBeCloseTo(2 / 3, 5);
  });

  it('resolveMultipleCapabilities 批量解析', () => {
    const fabric = new ExecutionFabric(makeRegistry(), { cacheEnabled: false });
    fabric.registerAgentCapabilities('a1', 'agent1', ['code']);
    const res = fabric.resolveMultipleCapabilities(['code', 'design']);
    expect(res[0].resolved).toBe(true);
    expect(res[1].resolved).toBe(false);
  });

  it('connector 失败 → 按 maxRetries 重试后返回失败', async () => {
    let calls = 0;
    const fabric = new ExecutionFabric(
      makeRegistry(async () => { calls++; return { success: false, error: 'boom', duration: 0 }; }),
      { cacheEnabled: false, maxRetries: 1, defaultTimeoutMs: 50 },
    );
    fabric.registerAgentCapabilities('a1', 'agent1', ['code']);
    const r = await fabric.execute('code', 'fs.write', {});
    expect(r.success).toBe(false);
    expect(calls).toBe(2); // 初始 + 1 次重试
  }, 15000);

  it('maxAttempts 用尽 → onAttemptsExhausted 回调（失败事件闭环，Wave 4）', async () => {
    let calls = 0;
    const exhausted: Array<{ action: string; maxAttempts: number; error: string }> = [];
    const fabric = new ExecutionFabric(
      makeRegistry(async () => { calls++; return { success: false, error: 'boom', duration: 0 }; }),
      {
        cacheEnabled: false,
        maxRetries: 1,
        defaultTimeoutMs: 50,
        onAttemptsExhausted: (info) => exhausted.push(info),
      },
    );
    fabric.registerAgentCapabilities('a1', 'agent1', ['code']);
    const r = await fabric.execute('code', 'fs.write', {}, { executionId: 'exec_1' });
    expect(r.success).toBe(false);
    expect(calls).toBe(2);
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].action).toBe('fs.write');
    expect(exhausted[0].maxAttempts).toBe(2);
    expect(exhausted[0].executionId).toBe('exec_1');
    expect(exhausted[0].error).toBe('boom');
  }, 15000);

  it('agentId 直连执行（跳过能力解析）', async () => {
    const calls: string[] = [];
    const fabric = new ExecutionFabric(
      makeRegistry(async (req) => { calls.push(req.action); return { success: true, data: 'ok', duration: 1 }; }),
      { cacheEnabled: false },
    );
    fabric.registerAgentCapabilities('a1', 'agent1', ['code']);
    const r = await fabric.execute('anything', 'git.commit', {}, { agentId: 'a1' });
    expect(r.success).toBe(true);
    expect(calls).toEqual(['git.commit']);
  });
});
