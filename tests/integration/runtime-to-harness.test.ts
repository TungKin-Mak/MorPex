/**
 * Integration: Runtime → Harness — Full 7-context environment
 */
import { AgentHarness, ContextBuilder } from '../../packages/core/src/planes/agent-plane/index.js';
import { AssertionContext, TraceBuilder, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const ctx = new AssertionContext();
  const trace = new TraceBuilder();

  trace.step('Harness.create with 7 contexts', 'started');
  const h = await AgentHarness.create(b =>
    b.setIntent('Build API', ['TypeScript']).setIntentPriority(2)
     .setPlan('p1', { nodes: [] }).setPlanPhase('execution').setProgress(0.5)
     .setExecutionState('running').incrementStep()
     .setPermissions(['read']).grantPermissions().addRestriction('delete')
     .attachArtifact({ id: 'a1', name: 'Spec', type: 'openapi', version: '1', uri: '/artifacts/spec' })
     .injectMemory([{ id: 'm1', content: 'Use Express', type: 'pattern', relevanceScore: 0.9, timestamp: Date.now() }])
     .setContextBias('backend')
     .loadExperience([{ id: 'e1', goal: 'Previous', planId: 'prev', outcome: 'success', duration: 1000, patterns: ['Express'], lessons: ['Test early'], timestamp: Date.now() - 3600000 }])
  );
  ctx.assert(h.isInitialized, 'initialized');
  trace.step('Harness.create', 'completed');

  const c = h.getContext();
  ctx.assert(c.intent.goal === 'Build API', 'intent');
  ctx.assert(c.plan.planId === 'p1', 'plan');
  ctx.assert(c.memory.relevantMemories.length === 1, 'memory');
  ctx.assert(c.artifact.availableArtifacts.length === 1, 'artifact');
  ctx.assert(c.executionState.status === 'running', 'state');
  ctx.assert(c.permission.granted === true, 'permission');
  ctx.assert(c.experience.patterns.includes('Express'), 'experience');

  const rt = h.getAgentRuntime();
  ctx.assert(typeof rt.goal === 'string', 'runtime.goal');
  ctx.assert(Array.isArray(rt.memories), 'runtime.memories');

  ctx.assert(h.checkPermission('read') === true, 'allowed');
  ctx.assert(h.checkPermission('delete') === false, 'blocked');

  trace.step('All 7 contexts verified', 'completed');

  return {
    name: 'Integration: Runtime→Harness',
    category: 'integration',
    passed: ctx.errors.length === 0,
    duration: Date.now() - start,
    assertions: ctx.total,
    assertionsPassed: ctx.passed,
    errors: ctx.errors,
    trace: trace.build(),
  };
}

export default run;
