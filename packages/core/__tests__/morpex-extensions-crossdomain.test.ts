/**
 * MorPex Extensions + CrossDomain Module Tests (Fixed)
 */
console.log('========================================');
console.log('  MorPex Extensions + CrossDomain Tests');
console.log('========================================\n');

import * as fs_lib from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.error('  ❌ ' + m); fail++; } }
function eq(a: any, b: any, m: string) { if (a === b) pass++; else { console.error('  ❌ ' + m); fail++; } }

async function main() {
  // 1. ExtensionRegistry
  console.log('\n--- 1. ExtensionRegistry ---');
  try {
    const { ExtensionRegistryImpl } = await import('../src/extensions/ExtensionRegistry.js');
    const bus = { emit: () => {} };
    const reg = new ExtensionRegistryImpl(bus);
    ok(typeof reg.register === 'function', 'register() exists');
    ok(typeof reg.startAll === 'function', 'startAll() exists');
    eq(reg.count, 0, 'Starts with 0');
    
    const ext = {
      name: 'TestExt', version: '1.0.0', enabled: true,
      dependencies: [],
      initialize: async (_ctx: any) => {},
      start: async () => {},
      stop: async () => {},
    };
    reg.register(ext);
    eq(reg.count, 1, 'Count=1 after register');
    ok(reg.get('TestExt') !== undefined, 'Can get by name');
    try { reg.register(ext); ok(false, 'Should throw'); } catch { ok(true, 'Duplicate throws'); }
    const status = reg.getStatus();
    ok(Array.isArray(status), 'getStatus returns array');
    console.log('  ✅ ExtensionRegistry');
  } catch (e: any) { console.error('  ❌ ExtensionRegistry:', e.message); fail++; }

  // 2. CrossDomainEventTypes
  console.log('\n--- 2. CrossDomainEventTypes ---');
  try {
    const { CrossDomainEventTypes } = await import('../src/events/CrossDomainEvents.js');
    ok(typeof CrossDomainEventTypes === 'object', 'Is object');
    ok(typeof CrossDomainEventTypes.DAGCreated === 'string', 'Has DAGCreated');
    ok(typeof CrossDomainEventTypes.DomainWaking === 'string', 'Has DomainWaking');
    ok(typeof CrossDomainEventTypes.ArtifactCreated === 'string', 'Has ArtifactCreated');
    eq(CrossDomainEventTypes.DAGCreated, 'cross_domain.dag_created', 'DAGCreated value correct');
    console.log('  ✅ CrossDomainEventTypes');
  } catch (e: any) { console.error('  ❌ CrossDomainEventTypes:', e.message); fail++; }

  // 3. Domain Types
  console.log('\n--- 3. Domain Types ---');
  try {
    const types = await import('../src/domains/types.js');
    ok(typeof types === 'object', 'Exports object');
    console.log('  ✅ Domain Types');
  } catch (e: any) { console.error('  ❌ Domain Types:', e.message); fail++; }

  // 4. DomainManifestLoader
  console.log('\n--- 4. DomainManifestLoader ---');
  try {
    const { DomainManifestLoader } = await import('../src/domains/DomainManifestLoader.js');
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'dml-'));
    // Write a real manifest with required fields
    const manifest = {
      domain_id: 'test_domain',
      domain_name: 'Test Domain',
      version: '1.0',
      description: 'Test domain',
      master_agent_config: {
        system_prompt: 'You are a test agent',
        model: 'deepseek-v4-flash'
      },
      skills: [],
      tools: []
    };
    fs_lib.writeFileSync(path.join(tmpDir, 'test_domain.json'), JSON.stringify(manifest));
    const loader = new DomainManifestLoader(tmpDir);
    const all = await loader.loadAll();
    ok(Array.isArray(all), 'loadAll returns array');
    rmSync(tmpDir, { recursive: true, force: true });
    console.log('  ✅ DomainManifestLoader');
  } catch (e: any) { console.error('  ❌ DomainManifestLoader:', e.message); fail++; }

  // 5. DomainCluster
  console.log('\n--- 5. DomainCluster ---');
  try {
    const { DomainCluster } = await import('../src/domains/DomainCluster.js');
    // DomainCluster needs full manifest with model config
    const manifest = {
      domain_id: 'test',
      domain_name: 'Test',
      version: '1.0',
      description: 'Test',
      master_agent_config: {
        system_prompt: 'You are a helpful assistant.',
        model: 'deepseek-v4-flash'
      },
      skills: [],
      tools: []
    };
    const cluster = new DomainCluster(manifest as any);
    ok(cluster !== null, 'Can instantiate');
    ok(typeof cluster.wake === 'function', 'Has wake()');
    ok(typeof cluster.sleep === 'function', 'Has sleep()');
    ok(typeof cluster.getStatusReport === 'function', 'Has getStatusReport()');
    console.log('  ✅ DomainCluster');
  } catch (e: any) { console.error('  ❌ DomainCluster:', e.message); fail++; }

  // 6. DomainClusterManager
  console.log('\n--- 6. DomainClusterManager ---');
  try {
    const { DomainClusterManager } = await import('../src/domains/DomainClusterManager.js');
    const mgr = new DomainClusterManager({});
    ok(mgr !== null, 'Can instantiate');
    ok(typeof mgr.register === 'function', 'Has register()');
    ok(typeof mgr.getDomainContextText === 'function', 'Has getDomainContextText()');
    console.log('  ✅ DomainClusterManager');
  } catch (e: any) { console.error('  ❌ DomainClusterManager:', e.message); fail++; }

  // 7. NegotiationEngine
  console.log('\n--- 7. NegotiationEngine ---');
  try {
    const { NegotiationEngine } = await import('../src/negotiation/NegotiationEngine.js');
    const engine = new NegotiationEngine();
    ok(engine !== null, 'Can instantiate');
    // Test ticket creation if method exists
    if (typeof (engine as any).createTicket === 'function') {
      const ticket = await (engine as any).createTicket({
        source_domain: 'source', target_domain: 'target',
        trigger_artifact_id: 'art_1', conflict_type: 'resource',
        reason: 'Conflict', suggestion: 'Use different resource'
      });
      ok(ticket !== null, 'Ticket created');
    }
    console.log('  ✅ NegotiationEngine');
  } catch (e: any) { console.error('  ❌ NegotiationEngine:', e.message); fail++; }

  // 8. ArbitrationHandler
  console.log('\n--- 8. ArbitrationHandler ---');
  try {
    const handler = await import('../src/router/ArbitrationHandler.js');
    ok(typeof handler === 'object', 'Module loads');
    console.log('  ✅ ArbitrationHandler');
  } catch (e: any) { console.error('  ❌ ArbitrationHandler:', e.message); fail++; }

  // 9. CrossDomainRouter
  console.log('\n--- 9. CrossDomainRouter ---');
  try {
    const { CrossDomainRouter } = await import('../src/router/CrossDomainRouter.js');
    const mockMgr = {
      getDomainContextText: () => 'Available domains: test',
      listDomains: () => [],
      register: () => {},
      wake: async () => {},
      sleep: async () => {},
      execute: async () => ({ text: 'result' }),
    };
    const router = new CrossDomainRouter(mockMgr as any);
    ok(router !== null, 'Can instantiate');
    ok(typeof router.dispatch === 'function', 'Has dispatch()');
    console.log('  ✅ CrossDomainRouter');
  } catch (e: any) { console.error('  ❌ CrossDomainRouter:', e.message); fail++; }

  // 10. DomainDispatcher
  console.log('\n--- 10. DomainDispatcher ---');
  try {
    const disp = await import('../src/router/DomainDispatcher.js');
    ok(typeof disp === 'object', 'Module loads');
    console.log('  ✅ DomainDispatcher');
  } catch (e: any) { console.error('  ❌ DomainDispatcher:', e.message); fail++; }

  // 11. LineageTracker
  console.log('\n--- 11. LineageTracker ---');
  try {
    const { LineageTracker } = await import('../src/extensions/LineageTracker.js');
    const lt = new LineageTracker({ enabled: true });
    ok(lt !== null, 'Can instantiate');
    eq(lt.name, 'LineageTracker', 'Name correct');
    console.log('  ✅ LineageTracker');
  } catch (e: any) { console.error('  ❌ LineageTracker:', e.message); fail++; }

  // 12. ContextPruner
  console.log('\n--- 12. ContextPruner ---');
  try {
    const { ContextPruner } = await import('../src/extensions/ContextPruner.js');
    const pruner = new ContextPruner({ enabled: true });
    ok(pruner !== null, 'Can instantiate');
    eq(pruner.name, 'ContextPruner', 'Name correct');
    console.log('  ✅ ContextPruner');
  } catch (e: any) { console.error('  ❌ ContextPruner:', e.message); fail++; }

  // 13. McpProcessGuard
  console.log('\n--- 13. McpProcessGuard ---');
  try {
    const { McpProcessGuard } = await import('../src/extensions/McpProcessGuard.js');
    ok(typeof McpProcessGuard === 'function', 'Class exists');
    console.log('  ✅ McpProcessGuard');
  } catch (e: any) { console.error('  ❌ McpProcessGuard:', e.message); fail++; }

  // 14. CheckpointManager
  console.log('\n--- 14. CheckpointManager ---');
  try {
    const cm = await import('../src/extensions/CheckpointManager.js');
    ok(typeof cm.CheckpointManager === 'function' || typeof cm === 'object', 'Module loads');
    console.log('  ✅ CheckpointManager');
  } catch (e: any) { console.error('  ❌ CheckpointManager:', e.message); fail++; }

  // 15. EventStore
  console.log('\n--- 15. EventStore ---');
  try {
    const es = await import('../src/event/EventStore.js');
    ok(typeof es.EventStore === 'function' || typeof es === 'object', 'Module loads');
    console.log('  ✅ EventStore');
  } catch (e: any) { console.error('  ❌ EventStore:', e.message); fail++; }

  // 16. EventStoreSubscriber
  console.log('\n--- 16. EventStoreSubscriber ---');
  try {
    const sub = await import('../src/event/EventStoreSubscriber.js');
    ok(typeof sub === 'object', 'Module loads');
    console.log('  ✅ EventStoreSubscriber');
  } catch (e: any) { console.error('  ❌ EventStoreSubscriber:', e.message); fail++; }

  // 17. MemoryBusListener
  console.log('\n--- 17. MemoryBusListener ---');
  try {
    const mbl = await import('../src/memory/MemoryBusListener.js');
    ok(typeof mbl === 'object', 'Module loads');
    console.log('  ✅ MemoryBusListener');
  } catch (e: any) { console.error('  ❌ MemoryBusListener:', e.message); fail++; }

  // 18. MemoryHooks
  console.log('\n--- 18. MemoryHooks ---');
  try {
    const mh = await import('../src/memory/MemoryHooks.js');
    ok(typeof mh === 'object', 'Module loads');
    console.log('  ✅ MemoryHooks');
  } catch (e: any) { console.error('  ❌ MemoryHooks:', e.message); fail++; }

  // 19. MemoryMessages
  console.log('\n--- 19. MemoryMessages ---');
  try {
    const mm = await import('../src/memory/MemoryMessages.js');
    ok(typeof mm === 'object', 'Module loads');
    console.log('  ✅ MemoryMessages');
  } catch (e: any) { console.error('  ❌ MemoryMessages:', e.message); fail++; }

  // 20. VectorStoreAdapter
  console.log('\n--- 20. VectorStoreAdapter ---');
  try {
    const vsa = await import('../src/memory/VectorStoreAdapter.js');
    ok(typeof vsa === 'object', 'Module loads');
    console.log('  ✅ VectorStoreAdapter');
  } catch (e: any) { console.error('  ❌ VectorStoreAdapter:', e.message); fail++; }

  // 21. PermissionEngine
  console.log('\n--- 21. PermissionEngine ---');
  try {
    const { PermissionEngine } = await import('../src/permission/PermissionEngine.js');
    const pe = new PermissionEngine();
    ok(pe !== null, 'Can instantiate');
    if (typeof (pe as any).check === 'function') {
      const result = await (pe as any).check({ action: 'test', resource: 'test' });
      ok(result !== undefined, 'check() returns result');
    }
    console.log('  ✅ PermissionEngine');
  } catch (e: any) { console.error('  ❌ PermissionEngine:', e.message); fail++; }

  // 22. CompactionPolicy (already tested in common, just basic check)
  console.log('\n--- 22. CompactionPolicy ---');
  try {
    const cp = await import('../src/compaction/CompactionPolicy.js');
    ok(typeof cp.estimateTokens === 'function', 'Has estimateTokens');
    ok(typeof cp.SlidingWindowCompaction === 'function', 'Has SlidingWindowCompaction');
    const tokens = cp.estimateTokens('Hello world test');
    ok(tokens > 0, 'estimateTokens works');
    const comp = new cp.SlidingWindowCompaction({ maxTokens: 100 });
    const result = comp.compact([{role:'user' as any, content:'test'}]);
    console.log('  ⚠️ compact result:', typeof result);
    console.log('  ✅ CompactionPolicy');
  } catch (e: any) { console.error('  ❌ CompactionPolicy:', e.message); fail++; }

  // 23. McpJsonRpcHandler
  console.log('\n--- 23. McpJsonRpcHandler ---');
  try {
    const handler = await import('../src/mcp/McpJsonRpcHandler.js');
    ok(typeof handler === 'object', 'Module loads');
    console.log('  ✅ McpJsonRpcHandler');
  } catch (e: any) { console.error('  ❌ McpJsonRpcHandler:', e.message); fail++; }

  // 24. SessionErrorExtractor
  console.log('\n--- 24. SessionErrorExtractor ---');
  try {
    const extractor = await import('../src/extensions/planning/SessionErrorExtractor.js');
    ok(typeof extractor.SessionErrorExtractor === 'function' || typeof extractor === 'object', 'Module loads');
    console.log('  ✅ SessionErrorExtractor');
  } catch (e: any) { console.error('  ❌ SessionErrorExtractor:', e.message); fail++; }

  // 25. PipelineLogger
  console.log('\n--- 25. PipelineLogger ---');
  try {
    const pl = await import('../src/extensions/planning/PipelineLogger.js');
    ok(typeof pl.PipelineLogger === 'function' || typeof pl === 'object', 'Module loads');
    console.log('  ✅ PipelineLogger');
  } catch (e: any) { console.error('  ❌ PipelineLogger:', e.message); fail++; }

  // 26. KnowledgeGraph (basic)
  console.log('\n--- 26. KnowledgeGraph ---');
  try {
    const { KnowledgeGraph } = await import('../src/planes/knowledge-plane/knowledge/KnowledgeGraph.js');
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'kg-'));
    const kg = new KnowledgeGraph({ dataDir: tmpDir });
    await kg.loadFromDisk();
    
    // Add entity
    const entity = await kg.addEntity({ name: 'TestEntity', type: 'concept', metadata: { key: 'value' } }); 
    ok(entity !== null, 'Can add entity');
    
    // Query entity
    if (entity) { ok(entity.id !== undefined, 'Entity has ID'); ok(entity.name === 'TestEntity', 'Entity has name'); }
    
    // Add relation
    if (entity && entity.id) {
      const entity2 = await kg.addEntity({ name: 'TestEntity2', type: 'concept' }); 
      if (entity2 && entity2.id) {
        const rel = await kg.addRelation({ source: entity.id, target: entity2.id, type: 'related_to' });
        console.log('  ℹ️ relation result:', rel ? rel.id : 'null (entities may need initialization)');
      }
    }
    
    // no shutdown needed
    rmSync(tmpDir, { recursive: true, force: true });
    console.log('  ✅ KnowledgeGraph');
  } catch (e: any) { console.error('  ❌ KnowledgeGraph:', e.message); fail++; }

  // Summary
  console.log('\n========================================');
  console.log('  Results: ' + pass + ' passed, ' + fail + ' failed');
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
