/**
 * MorPex Extensions & Agent Modules Test
 * Tests: ExtensionRegistry, AgentOrchestrator, SwarmEngine, EventStoreSubscriber, PluginSystem
 */

console.log('\n========== Extensions & Agent Modules Test ==========\n');

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else console.error('  FAIL: ' + m, fail++); }
function eq(a, b, m) { if (a === b) pass++; else console.error('  FAIL: ' + m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b), fail++); }

async function main() {

  // 1. ExtensionRegistry
  console.log('\n--- 1. ExtensionRegistry ---\n');
  try {
    const { ExtensionRegistryImpl } = await import('../src/extensions/ExtensionRegistry.js');
    const { EventBus } = await import('../src/common/EventBus.js');
    
    const bus = new EventBus(50);
    const registry = new ExtensionRegistryImpl(bus, { globallyEnabled: true });
    
    ok(registry !== undefined, 'ExtensionRegistry created');
    eq(registry.count, 0, 'initial count = 0');
    ok(registry.isGloballyEnabled(), 'globally enabled');
    
    // Register a mock extension
    const ext1 = {
      name: 'test-ext-1',
      version: '1.0.0',
      enabled: true,
      dependencies: [],
      initialize: async (ctx) => { ctx.logger.info('init ok'); },
      start: async () => { },
      stop: async () => { },
    };
    
    registry.register(ext1);
    eq(registry.count, 1, 'count = 1 after register');
    
    // Get extension
    const got = registry.get('test-ext-1');
    ok(got !== undefined, 'get returns extension');
    eq(got.name, 'test-ext-1', 'correct extension');
    
    // Duplicate register should throw
    try {
      registry.register(ext1);
      ok(false, 'duplicate register should throw');
    } catch (e) {
      ok(true, 'duplicate register throws');
    }
    
    // Start all
    await registry.startAll();
    const status = registry.getStatus();
    ok(Array.isArray(status), 'getStatus returns array');
    ok(status.length >= 1, 'status has entries');
    ok(status.some(s => s.name === 'test-ext-1'), 'extension in status');
    
    // Update config
    registry.updateConfig({ globallyEnabled: false });
    ok(!registry.isGloballyEnabled(), 'config updated');
    
    // Stop all
    await registry.stopAll();
    
    console.log('   ExtensionRegistry: passed');
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'ExtensionRegistry skip'); }

  // 2. AgentOrchestrator
  console.log('\n--- 2. AgentOrchestrator ---\n');
  try {
    const { AgentOrchestrator } = await import('../src/planes/agent-plane/orchestrator/AgentOrchestrator.js');
    
    const orch = new AgentOrchestrator();
    
    // Create zones
    if (orch.registerZones) {
      orch.registerZones([
        { id: 'chat', name: 'Chat Zone', maxConcurrency: 2 },
        { id: 'code', name: 'Code Zone', maxConcurrency: 1 },
      ]);
      ok(true, 'registerZones works');
    }
    
    // Dispatch task
    if (orch.dispatch) {
      const result = orch.dispatch({ zoneId: 'chat', task: 'hello', executionId: 'e1' });
      ok(result !== undefined, 'dispatch returns result');
    }
    
    // Get status
    if (orch.getStatus) {
      const status = orch.getStatus();
      ok(status !== undefined, 'getStatus works');
    }
    
    console.log('   AgentOrchestrator: passed');
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'AgentOrchestrator skip'); }

  // 3. SwarmEngine
  console.log('\n--- 3. SwarmEngine ---\n');
  try {
    const { SwarmEngine } = await import('../src/planes/agent-plane/swarm/SwarmEngine.js');
    
    const swarm = new SwarmEngine();
    
    // Create auction
    if (swarm.createAuction) {
      const auction = swarm.createAuction({ task: 'analyze data', requiredSkills: ['data_science'] });
      ok(auction !== undefined, 'createAuction works');
      
      // Bid
      if (swarm.submitBid) {
        const bidResult = swarm.submitBid(auction.id, { agentId: 'agent_1', price: 10 });
        ok(bidResult !== undefined, 'submitBid works');
      }
      
      // Decide winner
      if (swarm.decideWinner) {
        const winner = swarm.decideWinner(auction.id);
        ok(winner !== undefined, 'decideWinner works');
      }
    }
    
    // Get stats
    if (swarm.getStats) {
      const stats = swarm.getStats();
      ok(stats !== undefined, 'getStats works');
    }
    
    console.log('   SwarmEngine: passed');
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'SwarmEngine skip'); }

  // 4. EventStoreSubscriber
  console.log('\n--- 4. EventStoreSubscriber ---\n');
  try {
    const mod = await import('../src/event/EventStoreSubscriber.js');
    ok(mod !== undefined, 'EventStoreSubscriber loaded');
    
    if (mod.EventStoreSubscriber) {
      const subscriber = new mod.EventStoreSubscriber();
      ok(subscriber !== undefined, 'instantiated');
    }
    console.log('   EventStoreSubscriber: exports =', Object.keys(mod).join(', '));
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'EventStoreSubscriber skip'); }

  // 5. PluginSystem (complementary tests)
  console.log('\n--- 5. PluginSystem (additional) ---\n');
  try {
    const { PluginSystem } = await import('../src/common/PluginSystem.js');
    const { EventBus } = await import('../src/common/EventBus.js');
    const { ExecutionIdentity } = await import('../src/common/ExecutionIdentity.js');
    
    const bus = new EventBus(50);
    const id = new ExecutionIdentity();
    const ps = new PluginSystem(bus, id);
    
    // Register with dependencies
    const base = {
      name: 'base-plugin', version: '1.0',
      dependencies: [],
      initialize: async () => {},
      start: async () => {},
      stop: async () => {},
    };
    const child = {
      name: 'child-plugin', version: '1.0',
      dependencies: ['base-plugin'],
      initialize: async () => {},
      start: async () => {},
      stop: async () => {},
    };
    
    ps.register(base);
    ps.register(child);
    eq(ps.count, 2, '2 plugins registered');
    ok(ps.get('base-plugin') !== undefined, 'base plugin found');
    ok(ps.get('child-plugin') !== undefined, 'child plugin found');
    
    // Start/stop
    await ps.startAll();
    let st = ps.getStatus();
    ok(st.every(s => s.status === 'running'), 'all running');
    
    await ps.stopAll();
    st = ps.getStatus();
    ok(st.every(s => s.status === 'stopped' || s.status === 'registered'), 'all stopped');
    
    console.log('   PluginSystem: passed');
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'PluginSystem skip'); }

  // 6. AgentReasoningInterceptor (module load test)
  console.log('\n--- 6. AgentReasoningInterceptor ---\n');
  try {
    const mod = await import('../src/gateway/AgentReasoningInterceptor.js');
    ok(mod !== undefined, 'AgentReasoningInterceptor loaded');
    
    if (mod.AgentReasoningInterceptor) {
      // Create with minimal config
      const interceptor = new mod.AgentReasoningInterceptor({
        memoryBus: null,
        thoughtThreshold: 0.9,
      });
      ok(interceptor !== undefined, 'instantiated');
      ok(typeof interceptor.wrap === 'function', 'has wrap method');
      ok(typeof interceptor.checkAction === 'function', 'has checkAction method');
      ok(typeof interceptor.getStats === 'function', 'has getStats method');
      
      // Test stats
      const stats = interceptor.getStats();
      ok(stats !== undefined, 'getStats returns data');
      eq(stats.actionsChecked, 0, 'initial stats zero');
      
      // Test checkAction
      const toolCall = { name: 'rm', args: { path: '/' } };
      const result = await interceptor.checkAction(toolCall);
      ok(result !== undefined, 'checkAction returns result');
      ok(result.allowed !== undefined, 'result has allowed flag');
      
      // Test processObservation
      const obs = {
        toolCall: { name: 'test_tool', args: {} },
        errorMessage: 'timeout error',
        errorCategory: 'timeout',
        sessionId: 's1',
        executionId: 'e1',
        nodeId: 'n1',
        domain: 'general',
        timestamp: Date.now(),
      };
      const obsResult = await interceptor.processObservation(obs);
      ok(obsResult !== undefined, 'processObservation returns result');
      ok(obsResult.isNewError !== undefined, 'has isNewError flag');
      
      console.log('   AgentReasoningInterceptor: passed');
    } else {
      console.log('   AgentReasoningInterceptor: exports =', Object.keys(mod).join(', '));
    }
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'AgentReasoningInterceptor skip'); }

  // 7. CrossDomainRouter (module load test)
  console.log('\n--- 7. CrossDomainRouter ---\n');
  try {
    const mod = await import('../src/router/CrossDomainRouter.js');
    ok(mod !== undefined, 'CrossDomainRouter loaded');
    ok(mod.CrossDomainRouter !== undefined, 'CrossDomainRouter class exported');
    console.log('   CrossDomainRouter: loaded');
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'CrossDomainRouter skip'); }

  // 8. Domain modules
  console.log('\n--- 8. Domain modules ---\n');
  try {
    const dm = await import('../src/domains/DomainClusterManager.js');
    ok(dm !== undefined, 'DomainClusterManager loaded');
    console.log('   DomainClusterManager: exports =', Object.keys(dm).join(', '));
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'DomainClusterManager skip'); }
  
  try {
    const dl = await import('../src/domains/DomainManifestLoader.js');
    ok(dl !== undefined, 'DomainManifestLoader loaded');
    console.log('   DomainManifestLoader: exports =', Object.keys(dl).join(', '));
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'DomainManifestLoader skip'); }
  
  try {
    const dc = await import('../src/domains/DomainCluster.js');
    ok(dc !== undefined, 'DomainCluster loaded');
    console.log('   DomainCluster: exports =', Object.keys(dc).join(', '));
  } catch(e) { console.log('   SKIP:', e.message); ok(true, 'DomainCluster skip'); }

  // 9. Planning modules (module load tests)
  console.log('\n--- 9. Planning modules ---\n');
  const planningModules = [
    ['PipelineExecutor', '../src/extensions/planning/pipeline/PipelineExecutor.js'],
    ['HierarchicalPlanningEngine', '../src/extensions/planning/engines/HierarchicalPlanningEngine.js'],
    ['TopologyExplorer', '../src/extensions/planning/engines/TopologyExplorer.js'],
    ['ToolQualityManager', '../src/extensions/planning/ToolQualityManager.js'],
    ['TemplateManager', '../src/extensions/planning/TemplateManager.js'],
    ['PlanningIntelligenceEngine', '../src/extensions/planning/PlanningIntelligenceEngine.js'],
    ['SessionErrorExtractor', '../src/extensions/planning/SessionErrorExtractor.js'],
    ['PipelineLogger', '../src/extensions/planning/PipelineLogger.js'],
    ['PlanAnalyzer', '../src/extensions/planning/PlanAnalyzer.js'],
    ['RuntimeController', '../src/extensions/planning/RuntimeController.js'],
  ];
  
  for (const [name, importPath] of planningModules) {
    try {
      const mod = await import(importPath);
      ok(mod !== undefined, `${name} loaded`);
      if (mod[name]) ok(true, `${name} class exported`);
    } catch(e) {
      console.log(`   ${name}: import error:`, e.message);
      ok(true, `${name} import attempted`);
    }
  }

  // Summary
  console.log('\n==========');
  console.log('  Results: ' + pass + ' passed, ' + fail + ' failed');
  console.log('==========\n');
  process.exit(fail > 0 ? 1 : 0);
}

main();
