/**
 * Context Assembly Integration Tests — v9.1
 *
 * 覆盖: ContextFragmentRegistry → ContextBuilder → ContextVersioner →
 *       ContextTemplateRepository → ContextEnricherPipeline → ContextAssemblyEngine
 *
 * 使用自执行模式，兼容 Node.js --test 运行。
 */
import { ContextFragmentRegistry } from '../src/context/ContextFragmentRegistry.js';
import type { FragmentProvider, ContextAssemblyInput } from '../src/context/ContextFragmentRegistry.js';
import { ContextBuilder } from '../src/context/ContextBuilder.js';
import type { ExecutionContext } from '../src/context/ContextBuilder.js';
import { ContextVersioner } from '../src/context/ContextVersioner.js';
import { ContextTemplateRepository } from '../src/context/ContextTemplateRepository.js';
import { ContextEnricherPipeline } from '../src/context/ContextEnricher.js';
import type { ContextEnricher } from '../src/context/ContextEnricher.js';
import { ContextAssemblyEngine } from '../src/context/ContextAssemblyEngine.js';

let passed = 0; let failed = 0;
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

async function run() {
  console.log('\n=== Context Assembly Tests ===\n');

  // ── Helpers ──
  function createMockProvider(source: string, data: Record<string, unknown>): FragmentProvider {
    return {
      source: source as any,
      async collect(input: ContextAssemblyInput) {
        return { source: source as any, data, version: 1, collectedAt: Date.now() };
      },
    };
  }

  // ── 1. ContextFragmentRegistry ──
  try {
    const registry = new ContextFragmentRegistry();
    const provider = createMockProvider('user_profile', { name: 'Alice' });
    registry.register(provider);
    assert(registry.count() === 1, 'count === 1');
    assert(registry.listSources().includes('user_profile'), 'has user_profile');
    const fragments = await registry.collectAll({ missionId: 'm1' });
    assert(fragments.length === 1, 'collected 1 fragment');
    assert(fragments[0].source === 'user_profile', 'source is user_profile');
    assert((fragments[0].data as any).name === 'Alice', 'data.name is Alice');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextFragmentRegistry: register and collect: ${e.message}`); }

  try {
    const registry = new ContextFragmentRegistry();
    registry.register(createMockProvider('user_profile', {}));
    assert(registry.count() === 1, 'count === 1');
    registry.unregister('user_profile');
    assert(registry.count() === 0, 'count === 0 after unregister');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextFragmentRegistry: unregister: ${e.message}`); }

  try {
    const registry = new ContextFragmentRegistry();
    registry.register(createMockProvider('user_profile', { name: 'Alice' }));
    registry.register({
      source: 'behavior_twin',
      async collect() { throw new Error('fail'); },
    });
    const fragments = await registry.collectAll({ missionId: 'm1' });
    assert(fragments.length === 1, 'only successful provider collected');
    assert(fragments[0].source === 'user_profile', 'user_profile survived');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextFragmentRegistry: collect partial failure: ${e.message}`); }

  // ── 2. ContextBuilder ──
  try {
    const builder = new ContextBuilder();
    builder.setBaseData({ schemaVersion: '1.0' });
    builder.setSessionData({ missionId: 'm1', userId: 'u1' });
    builder.setEphemeralData({ riskScore: 0.5 });
    const ctx = builder.build('m1');
    assert(ctx.contextId.startsWith('ctx_m1_'), 'contextId format');
    assert(ctx.version === 1, 'version === 1');
    assert(ctx.missionId === 'm1', 'missionId === m1');
    assert(ctx.layers.base.schemaVersion === '1.0', 'base layer data');
    assert(ctx.layers.session.missionId === 'm1', 'session layer data');
    assert(ctx.layers.ephemeral.riskScore === 0.5, 'ephemeral layer data');
    assert(ctx.schemaVersion === '1.0', 'schemaVersion');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextBuilder: build with layers: ${e.message}`); }

  try {
    const builder = new ContextBuilder();
    builder.setBaseData({ key: 'a' });
    const ctx1 = builder.build('m1');
    assert(ctx1.version === 1, 'first build version === 1');
    builder.reset();
    builder.setBaseData({ key: 'b' });
    const ctx2 = builder.build('m1');
    assert(ctx2.version === 2, 'second build version === 2');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextBuilder: version increments: ${e.message}`); }

  try {
    const builder = new ContextBuilder();
    const frag = { source: 'user_profile' as const, data: { name: 'Alice' }, version: 1, collectedAt: Date.now() };
    builder.addFragment(frag);
    const ctx = builder.build('m1');
    assert(ctx.fragments.length === 1, '1 fragment stored');
    assert(ctx.fragments[0].source === 'user_profile', 'fragment source correct');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextBuilder: addFragments: ${e.message}`); }

  // ── 3. ContextVersioner ──
  try {
    const versioner = new ContextVersioner();
    const ctx: ExecutionContext = {
      contextId: 'ctx_test_1', version: 1, missionId: 'm1',
      layers: { base: {}, session: {}, ephemeral: {} }, fragments: [], assembledAt: Date.now(), schemaVersion: '1.0',
    };
    versioner.snapshot(ctx, 'initial');
    const current = versioner.getCurrent('ctx_test_1');
    assert(current !== undefined, 'current snapshot exists');
    assert(current!.version === 1, 'version === 1');
    assert(current!.changeDescription === 'initial', 'change description');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextVersioner: snapshot: ${e.message}`); }

  try {
    const versioner = new ContextVersioner();
    const base: ExecutionContext = {
      contextId: 'ctx_h1', version: 0, missionId: 'm1',
      layers: { base: {}, session: {}, ephemeral: {} }, fragments: [], assembledAt: Date.now(), schemaVersion: '1.0',
    };
    for (let v = 1; v <= 3; v++) {
      base.version = v;
      versioner.snapshot({ ...base, layers: { ...base.layers, session: { ver: v } } });
    }
    const history = versioner.getHistory('ctx_h1');
    assert(history.length === 3, '3 snapshots');
    assert(history[0].version === 1, 'first version === 1');
    assert(history[2].version === 3, 'last version === 3');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextVersioner: getHistory: ${e.message}`); }

  try {
    const versioner = new ContextVersioner();
    const base: ExecutionContext = {
      contextId: 'ctx_d1', version: 1, missionId: 'm1',
      layers: { base: { key: 'old' }, session: {}, ephemeral: {} }, fragments: [], assembledAt: Date.now(), schemaVersion: '1.0',
    };
    versioner.snapshot(base);
    base.version = 2;
    base.layers.base.key = 'new';
    versioner.snapshot(base, 'updated key');
    const diffs = versioner.diff('ctx_d1', 1, 2);
    assert(diffs.length > 0, 'diffs found');
    const keyDiff = diffs.find(d => d.path === 'layers.base.key');
    assert(keyDiff !== undefined, 'key diff exists');
    assert(keyDiff!.from === 'old', 'from old');
    assert(keyDiff!.to === 'new', 'to new');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextVersioner: diff: ${e.message}`); }

  try {
    const versioner = new ContextVersioner();
    const base: ExecutionContext = {
      contextId: 'ctx_r1', version: 1, missionId: 'm1',
      layers: { base: { value: 'v1' }, session: {}, ephemeral: {} }, fragments: [], assembledAt: Date.now(), schemaVersion: '1.0',
    };
    versioner.snapshot(base);
    base.version = 2;
    base.layers.base.value = 'v2';
    versioner.snapshot(base);
    const rolled = versioner.rollback('ctx_r1', 1);
    assert(rolled !== undefined, 'rollback succeeded');
    assert(rolled.context.layers.base.value === 'v1', 'rolled back to v1');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextVersioner: rollback: ${e.message}`); }

  // ── 4. ContextTemplateRepository ──
  try {
    const repo = new ContextTemplateRepository();
    assert(repo.count() >= 3, 'at least 3 built-in templates');
    const def = repo.get('default');
    assert(def !== undefined, 'default template exists');
    assert(def!.requiredFragments.includes('user_profile'), 'default requires user_profile');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextTemplateRepository: register: ${e.message}`); }

  try {
    const repo = new ContextTemplateRepository();
    const matched = repo.match(['quick']);
    assert(matched.length > 0, 'matched quick template');
    assert(matched[0].templateId === 'quick-task', 'quick-task matches');
    const deep = repo.match(['research']);
    assert(deep.length > 0, 'matched research templates');
    assert(deep[0].templateId === 'deep-research', 'deep-research matches');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextTemplateRepository: match: ${e.message}`); }

  // ── 5. ContextEnricherPipeline ──
  try {
    const pipeline = new ContextEnricherPipeline();
    const enricher1: ContextEnricher = {
      name: 'risk-scorer', priority: 10,
      async enrich(ctx) { ctx.layers.ephemeral.riskScore = 0.75; return ctx; },
    };
    const enricher2: ContextEnricher = {
      name: 'priority-setter', priority: 5,
      async enrich(ctx) { ctx.layers.ephemeral.priority = 'high'; return ctx; },
    };
    pipeline.register(enricher1);
    pipeline.register(enricher2);
    assert(pipeline.count() === 2, '2 enrichers registered');
    const list = pipeline.listEnrichers();
    assert(list[0].priority === 5, 'priority 5 runs first');
    const ctx: ExecutionContext = {
      contextId: 'ctx_e1', version: 1, missionId: 'm1',
      layers: { base: {}, session: {}, ephemeral: {} }, fragments: [], assembledAt: Date.now(), schemaVersion: '1.0',
    };
    const enriched = await pipeline.enrich(ctx);
    assert(enriched.layers.ephemeral.riskScore === 0.75, 'risk score set');
    assert(enriched.layers.ephemeral.priority === 'high', 'priority set');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextEnricherPipeline: ${e.message}`); }

  // ── 6. ContextAssemblyEngine ──
  try {
    const registry = new ContextFragmentRegistry();
    registry.register(createMockProvider('user_profile', { name: 'Alice', role: 'developer' }));
    registry.register(createMockProvider('mission_state', { id: 'm1', status: 'active' }));
    const engine = new ContextAssemblyEngine(registry);
    const ctx = await engine.assemble({ missionId: 'm1', userId: 'u1' });
    assert(ctx.contextId.startsWith('ctx_m1_'), 'contextId format');
    assert(ctx.version === 1, 'version === 1');
    assert(ctx.missionId === 'm1', 'missionId === m1');
    assert(ctx.layers.session.missionId === 'm1', 'session data set');
    assert(ctx.layers.session.userId === 'u1', 'userId set');
    passed++;
  } catch (e: any) { failed++; console.error(`  FAIL ContextAssemblyEngine: full flow: ${e.message}`); }

  // ── Report ──
  console.log(`\n=== Context Assembly Tests: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run();
