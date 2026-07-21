/**
 * Architecture: Harness Boundary — no direct provider access
 */
import { AgentHarness } from '../../packages/core/src/planes/agent-plane/AgentHarness.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const assert = new AssertionContext();

  const harness = await AgentHarness.create(b =>
    b.setIntent('Test boundary', [])
      .setPlan('p-boundary', { nodes: [] })
      .setExecutionState('running')
      .grantPermissions()
      .injectMemory([{ id:'bm1', content:'test', type:'pattern', relevanceScore:0.5, timestamp:Date.now() }])
      .attachArtifact({ id:'bart1', name:'Test Artifact', type:'code', version:'1.0', uri:'artifact://default/code/test' })
  );
  assert.assert(harness.isInitialized, 'Harness initialized');

  const ctx = harness.getContext();
  assert.assert(ctx.intent.goal === 'Test boundary', 'IntentContext via harness');
  assert.assert(ctx.plan.planId === 'p-boundary', 'PlanContext via harness');
  assert.assert(ctx.executionState.status === 'running', 'ExecutionState via harness');
  assert.assert(ctx.memory.relevantMemories.length >= 1, 'MemoryContext via harness');
  assert.assert(ctx.artifact.availableArtifacts.length >= 1, 'ArtifactContext via harness');
  assert.assert(ctx.permission.granted === true, 'PermissionContext via harness');
  assert.assert(ctx.experience.patterns.length >= 0, 'ExperienceContext accessible');

  // Harness-mediated resource methods
  const providers = harness as any;
  assert.assert(typeof providers.registerArtifact === 'function', 'registerArtifact via harness');
  assert.assert(typeof providers.getArtifact === 'function', 'getArtifact via harness');
  assert.assert(typeof providers.searchMemory === 'function', 'searchMemory via harness');
  assert.assert(typeof providers.queryKnowledge === 'function', 'queryKnowledge via harness');

  const runtime = harness.getAgentRuntime();
  assert.assert(runtime.goal === 'Test boundary', 'Runtime context');
  assert.assert(Array.isArray(runtime.artifacts), 'Runtime artifacts list');

  return {
    name: 'Architecture: Harness Boundary', category: 'architecture',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
