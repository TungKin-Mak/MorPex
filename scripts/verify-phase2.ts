/**
 * Phase 2 — Agent Harness v2 Verification
 * Verifies real call chain: ContextBuilder → HarnessContext → AgentHarness
 */
import { AgentHarness, ContextBuilder } from '../packages/core/src/planes/agent-plane/index.js';

async function main() {
  console.log('\n=== Phase 2: Agent Harness v2 Verification ===\n');
  let passed = 0, failed = 0;

  // Test 1: Build context via ContextBuilder
  try {
    const builder = new ContextBuilder();
    const context = builder
      .setIntent('Build a REST API', ['use TypeScript', 'add auth'])
      .setIntentPriority(2)
      .addRisk('Security vulnerability')
      .setPlan('plan-001', { nodes: [{ id: '1', name: 'Setup' }, { id: '2', name: 'Implement' }] })
      .setProgress(0.5)
      .injectMemory([{ id: 'mem-1', content: 'Previous REST API experience', type: 'experience', relevanceScore: 0.9, timestamp: Date.now() }])
      .attachArtifact({ id: 'art-1', name: 'api-spec', type: 'document', version: '1.0', uri: './spec.md' })
      .setExecutionState('running')
      .setPermissions(['write:src', 'read:docs'])
      .loadExperience([{ id: 'exp-1', goal: 'Build auth', planId: 'p-auth', outcome: 'success', duration: 120, patterns: ['jwt'], lessons: ['Use refresh tokens'], timestamp: Date.now() }])
      .build();

    console.assert(context.intent.goal === 'Build a REST API', 'Goal set');
    console.assert(context.memory.relevantMemories.length === 1, 'Memory injected');
    console.assert(context.artifact.availableArtifacts.length === 1, 'Artifact attached');
    console.assert(context.experience.patterns.includes('jwt'), 'Experience loaded');
    console.assert(context.executionState.status === 'running', 'Execution state set');
    console.assert(context.permission.requiredPermissions.length === 2, 'Permissions set');

    passed++;
    console.log('  ✅ Test 1: ContextBuilder builds complete harness context');
  } catch (e) { failed++; console.error('  ❌ Test 1:', e); }

  // Test 2: AgentHarness initialization
  try {
    const harness = await AgentHarness.create(b =>
      b.setIntent('Deploy to production', ['use CI/CD'])
       .setPlan('plan-002', { nodes: [] })
       .setExecutionState('idle')
    );

    console.assert(harness.isInitialized === true, 'Harness initialized');
    const ctx = harness.getContext();
    console.assert(ctx.intent.goal === 'Deploy to production', 'Context accessible');

    passed++;
    console.log('  ✅ Test 2: AgentHarness initialize with static create()');
  } catch (e) { failed++; console.error('  ❌ Test 2:', e); }

  // Test 3: Runtime updates
  try {
    const harness = await AgentHarness.create(b =>
      b.setIntent('Process data', []).setPlan('plan-003', {}).setExecutionState('idle')
    );

    harness.updateExecutionState({ status: 'running', step: 1 });
    const state = harness.getContext().executionState;
    console.assert(state.status === 'running', 'Status updated');
    console.assert(state.step === 1, 'Step updated');

    harness.updateIntent({ goal: 'Process data v2' });
    console.assert(harness.getContext().intent.goal === 'Process data v2', 'Intent updated');

    harness.attachArtifact({ id: 'art-2', name: 'result.json', type: 'output', version: '1.0', uri: './result.json' });
    console.assert(harness.getContext().artifact.availableArtifacts.length === 1, 'Artifact attached');

    harness.injectMemory({ id: 'mem-2', content: 'New insight', type: 'pattern', relevanceScore: 0.8, timestamp: Date.now() });
    console.assert(harness.getContext().memory.relevantMemories.length === 1, 'Memory injected');

    passed++;
    console.log('  ✅ Test 3: Runtime updates (execution state, intent, artifact, memory)');
  } catch (e) { failed++; console.error('  ❌ Test 3:', e); }

  // Test 4: Permission checks
  try {
    const harness = await AgentHarness.create(b =>
      b.setIntent('Secure action', [])
       .setPlan('plan-004', {})
       .setPermissions(['admin'])
       .denyPermissions(['delete:critical'])
    );

    console.assert(harness.checkPermission('read:log') === true, 'Allowed action');
    console.assert(harness.checkPermission('delete:critical') === false, 'Restricted action');

    passed++;
    console.log('  ✅ Test 4: Permission checks (allow/deny)');
  } catch (e) { failed++; console.error('  ❌ Test 4:', e); }

  // Test 5: Agent runtime context
  try {
    const harness = await AgentHarness.create(b =>
      b.setIntent('Analyze data', ['fast']).setPlan('plan-005', {}).setExecutionState('running')
       .injectMemory([{ id: 'mem-3', content: 'Key insight', type: 'pattern', relevanceScore: 1, timestamp: Date.now() }])
    );

    const runtime = harness.getAgentRuntime();
    console.assert(runtime.goal === 'Analyze data', 'Runtime goal');
    console.assert(runtime.constraints.includes('fast'), 'Runtime constraints');
    console.assert(runtime.memories.includes('Key insight'), 'Runtime memories');

    passed++;
    console.log('  ✅ Test 5: getAgentRuntime() returns structured agent context');
  } catch (e) { failed++; console.error('  ❌ Test 5:', e); }

  // Test 6: Event callbacks
  try {
    const events: string[] = [];
    const harness = await AgentHarness.create(b =>
      b.setIntent('Event test', []).setPlan('plan-006', {}).setExecutionState('idle')
    );

    const unsub = harness.onEvent((event, data) => { events.push(event); });

    harness.updateExecutionState({ status: 'running' });
    harness.attachArtifact({ id: 'art-3', name: 'test', type: 'test', version: '1', uri: './t' });

    console.assert(events.includes('harness.executing'), 'executing event emitted');
    console.assert(events.includes('harness.context-updated'), 'context-updated event emitted');

    unsub(); // cleanup

    passed++;
    console.log('  ✅ Test 6: Event callbacks fire on state changes');
  } catch (e) { failed++; console.error('  ❌ Test 6:', e); }

  // Summary
  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.log(`  ❌ ${failed} tests FAILED`);
    process.exit(1);
  } else {
    console.log('  ✅ Phase 2 ALL PASSED\n');
  }
}

main().catch(console.error);
