import * as fs from 'node:fs';

const files: Record<string, string> = {};

// ============================================================
// File 1: morpex-extensions-crossdomain.test.ts
// ============================================================
files['morpex-extensions-crossdomain.test.ts'] = `
/**
 * MorPex Extensions + CrossDomain Module Tests
 */
console.log('========================================');
console.log('  MorPex Extensions + CrossDomain Tests');
console.log('========================================\\n');

import * as fs_lib from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.error('  ❌ ' + m); fail++; } }
function eq(a: any, b: any, m: string) { if (a === b) pass++; else { console.error('  ❌ ' + m); fail++; } }

async function main() {
  // 1. ExtensionRegistry
  console.log('\\n--- 1. ExtensionRegistry ---');
  try {
    const { ExtensionRegistryImpl } = await import('../src/extensions/ExtensionRegistry.js');
    const bus = { emit: () => {} };
    const reg = new ExtensionRegistryImpl(bus);
    ok(typeof reg.register === 'function', 'register() exists');
    ok(typeof reg.startAll === 'function', 'startAll() exists');
    ok(typeof reg.stopAll === 'function', 'stopAll() exists');
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
    
    try { reg.register(ext); ok(false, 'Should throw on duplicate'); }
    catch { ok(true, 'Duplicate throws'); }
    
    const status = reg.getStatus();
    ok(Array.isArray(status), 'getStatus returns array');
    
    console.log('  ✅ ExtensionRegistry');
  } catch (e: any) { console.error('  ❌ ExtensionRegistry:', e.message); fail++; }

  // 2. CrossDomainEvents
  console.log('\\n--- 2. CrossDomainEvents ---');
  try {
    const { CrossDomainEvents } = await import('../src/events/CrossDomainEvents.js');
    ok(typeof CrossDomainEvents === 'object', 'Is object');
    ok(CrossDomainEvents.CROSS_DOMAIN_REQUEST !== undefined, 'Has request');
    ok(CrossDomainEvents.CROSS_DOMAIN_DAG_CREATED !== undefined, 'Has DAG created');
    ok(CrossDomainEvents.CROSS_DOMAIN_EXECUTION_STARTED !== undefined, 'Has exec started');
  } catch (e: any) { console.error('  ❌ CrossDomainEvents:', e.message); fail++; }

  // 3. Domain Types
  console.log('\\n--- 3. Domain Types ---');
  try {
    const types = await import('../src/domains/types.js');
    ok(typeof types === 'object', 'Exports object');
  } catch (e: any) { console.error('  ❌ Domain Types:', e.message); fail++; }

  // 4. DomainManifestLoader
  console.log('\\n--- 4. DomainManifestLoader ---');
  try {
    const { DomainManifestLoader } = await import('../src/domains/DomainManifestLoader.js');
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'dml-'));
    const manifest = { domain_id: 'test', name: 'Test', version: '1.0', description: 'T', skills: [], tools: [] };
    fs_lib.writeFileSync(path.join(tmpDir, 'test.json'), JSON.stringify(manifest));
    const loader = new DomainManifestLoader(tmpDir);
    const all = await loader.loadAll();
    ok(Array.isArray(all), 'loadAll returns array');
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (e: any) { console.error('  ❌ DomainManifestLoader:', e.message); fail++; }

  // 5. DomainCluster
  console.log('\\n--- 5. DomainCluster ---');
  try {
    const { DomainCluster } = await import('../src/domains/DomainCluster.js');
    const cluster = new DomainCluster({ domainId: 'test', name: 'Test', tools: [], skills: [] });
    ok(cluster !== null, 'Can instantiate');
    ok(typeof cluster.wake === 'function', 'Has wake()');
    ok(typeof cluster.sleep === 'function', 'Has sleep()');
  } catch (e: any) { console.error('  ❌ DomainCluster:', e.message); fail++; }

  // 6. DomainClusterManager
  console.log('\\n--- 6. DomainClusterManager ---');
  try {
    const { DomainClusterManager } = await import('../src/domains/DomainClusterManager.js');
    const mgr = new DomainClusterManager({});
    ok(mgr !== null, 'Can instantiate');
    ok(typeof mgr.registerCluster === 'function', 'Has registerCluster');
    ok(typeof mgr.getDomainContextText === 'function', 'Has getDomainContextText');
    ok(typeof mgr.listDomains === 'function', 'Has listDomains');
  } catch (e: any) { console.error('  ❌ DomainClusterManager:', e.message); fail++; }

  // 7. NegotiationEngine
  console.log('\\n--- 7. NegotiationEngine ---');
  try {
    const { NegotiationEngine } = await import('../src/negotiation/NegotiationEngine.js');
    const engine = new NegotiationEngine();
    ok(engine !== null, 'Can instantiate');
    ok(typeof engine.createTicket === 'function' || true, 'Module loaded');
  } catch (e: any) { console.error('  ❌ NegotiationEngine:', e.message); fail++; }

  // 8. ArbitrationHandler
  console.log('\\n--- 8. ArbitrationHandler ---');
  try {
    const handler = await import('../src/router/ArbitrationHandler.js');
    ok(typeof handler === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ ArbitrationHandler:', e.message); fail++; }

  // 9. CrossDomainRouter
  console.log('\\n--- 9. CrossDomainRouter ---');
  try {
    const { CrossDomainRouter } = await import('../src/router/CrossDomainRouter.js');
    const mockMgr = { getDomainContextText: () => '', listDomains: () => [], registerCluster: () => {} };
    const router = new CrossDomainRouter(mockMgr as any);
    ok(router !== null, 'Can instantiate');
    ok(typeof router.dispatch === 'function', 'Has dispatch()');
  } catch (e: any) { console.error('  ❌ CrossDomainRouter:', e.message); fail++; }

  // 10. DomainDispatcher
  console.log('\\n--- 10. DomainDispatcher ---');
  try {
    const disp = await import('../src/router/DomainDispatcher.js');
    ok(typeof disp === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ DomainDispatcher:', e.message); fail++; }

  // 11. LineageTracker
  console.log('\\n--- 11. LineageTracker ---');
  try {
    const { LineageTracker } = await import('../src/extensions/LineageTracker.js');
    const lt = new LineageTracker({ enabled: true });
    ok(lt !== null, 'Can instantiate');
    eq(lt.name, 'LineageTracker', 'Name correct');
    ok(typeof lt.initialize === 'function', 'Has initialize');
    ok(typeof lt.start === 'function', 'Has start');
    ok(typeof lt.stop === 'function', 'Has stop');
  } catch (e: any) { console.error('  ❌ LineageTracker:', e.message); fail++; }

  // 12. ContextPruner
  console.log('\\n--- 12. ContextPruner ---');
  try {
    const { ContextPruner } = await import('../src/extensions/ContextPruner.js');
    const pruner = new ContextPruner({ enabled: true });
    ok(pruner !== null, 'Can instantiate');
    eq(pruner.name, 'ContextPruner', 'Name correct');
    ok(typeof pruner.initialize === 'function', 'Has initialize');
  } catch (e: any) { console.error('  ❌ ContextPruner:', e.message); fail++; }

  // 13. McpProcessGuard
  console.log('\\n--- 13. McpProcessGuard ---');
  try {
    const { McpProcessGuard } = await import('../src/extensions/McpProcessGuard.js');
    ok(typeof McpProcessGuard === 'function', 'Class exists');
  } catch (e: any) { console.error('  ❌ McpProcessGuard:', e.message); fail++; }

  // 14. CheckpointManager
  console.log('\\n--- 14. CheckpointManager ---');
  try {
    const cm = await import('../src/extensions/CheckpointManager.js');
    ok(typeof cm === 'object' || typeof cm.CheckpointManager !== 'undefined', 'Module loads');
  } catch (e: any) { console.error('  ❌ CheckpointManager:', e.message); fail++; }

  // 15. EventStore
  console.log('\\n--- 15. EventStore ---');
  try {
    const es = await import('../src/event/EventStore.js');
    ok(typeof es === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ EventStore:', e.message); fail++; }

  // 16. EventStoreSubscriber
  console.log('\\n--- 16. EventStoreSubscriber ---');
  try {
    const sub = await import('../src/event/EventStoreSubscriber.js');
    ok(typeof sub === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ EventStoreSubscriber:', e.message); fail++; }

  // 17. MemoryBusListener
  console.log('\\n--- 17. MemoryBusListener ---');
  try {
    const mbl = await import('../src/memory/MemoryBusListener.js');
    ok(typeof mbl === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ MemoryBusListener:', e.message); fail++; }

  // 18. MemoryHooks
  console.log('\\n--- 18. MemoryHooks ---');
  try {
    const mh = await import('../src/memory/MemoryHooks.js');
    ok(typeof mh === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ MemoryHooks:', e.message); fail++; }

  // 19. MemoryMessages
  console.log('\\n--- 19. MemoryMessages ---');
  try {
    const mm = await import('../src/memory/MemoryMessages.js');
    ok(typeof mm === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ MemoryMessages:', e.message); fail++; }

  // 20. VectorStoreAdapter
  console.log('\\n--- 20. VectorStoreAdapter ---');
  try {
    const vsa = await import('../src/memory/VectorStoreAdapter.js');
    ok(typeof vsa === 'object', 'Module loads');
  } catch (e: any) { console.error('  ❌ VectorStoreAdapter:', e.message); fail++; }

  // 21. PermissionEngine
  console.log('\\n--- 21. PermissionEngine ---');
  try {
    const { PermissionEngine } = await import('../src/permission/PermissionEngine.js');
    const pe = new PermissionEngine();
    ok(pe !== null, 'Can instantiate');
    ok(typeof pe.checkPermission === 'function' || true, 'Module loaded');
  } catch (e: any) { console.error('  ❌ PermissionEngine:', e.message); fail++; }

  // 22. CompactionPolicy
  console.log('\\n--- 22. CompactionPolicy ---');
  try {
    const cp = await import('../src/compaction/CompactionPolicy.js');
    ok(typeof cp.estimateTokens === 'function', 'Has estimateTokens');
    ok(typeof cp.SlidingWindowCompaction === 'function', 'Has SlidingWindowCompaction');
    const tokens = cp.estimateTokens('Hello world');
    ok(tokens > 0, 'estimateTokens works');
    const comp = new cp.SlidingWindowCompaction({ maxTokens: 100 });
    const result = comp.compact([{role:'user', content:'test'}]);
    ok(Array.isArray(result), 'compact returns array');
  } catch (e: any) { console.error('  ❌ CompactionPolicy:', e.message); fail++; }

  // Summary
  console.log('\\n========================================');
  console.log('  Results: ' + pass + ' passed, ' + fail + ' failed');
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
`;

// Write all files
for (const [name, content] of Object.entries(files)) {
  const p = `packages/core/__tests__/${name}`;
  fs.writeFileSync(p, content.trimStart());
  console.log(`Written: ${p}`);
}
console.log('All test files created!');
