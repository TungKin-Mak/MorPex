/**
 * Phase 2 Real Call Chain Verification
 * AgentHarness v2 — 7 个上下文维度的完整运行环境
 */
import { AgentHarness, ContextBuilder } from '../planes/agent-plane/index.js';
import type { HarnessContext } from '../planes/agent-plane/HarnessContext.js';

const assert = (c: boolean, m: string) => { if (!c) throw Error('FAIL: '+m); console.log('  OK '+m); };

async function main() {
  console.log('\n=== Phase 2 Real Call Chain ===\n');

  // ── 1. ContextBuilder 构建 7 个上下文 ──
  console.log('--- 1. ContextBuilder ---');
  const builder = new ContextBuilder()
    .setIntent('Build a REST API for task management', ['Must use TypeScript', 'Must have tests'])
    .setIntentPriority(3)
    .addRisk('Schema migration may break existing data')
    .setPlan('plan_20260719_001', { nodes: [{ id: 'a' }], edges: [] })
    .setPlanPhase('execution')
    .setProgress(0.3)
    .injectMemory([{ id: 'm1', content: 'Use Express.js for REST APIs', type: 'pattern', relevanceScore: 0.9, timestamp: Date.now() }])
    .setContextBias('Backend development')
    .setActivationScore(0.85)
    .attachArtifact({ id: 'art1', name: 'API Spec v2', type: 'openapi', version: '2.0.0', uri: '/artifacts/api-spec-v2.yaml' })
    .setCurrentArtifact('art1')
    .setExecutionState('running')
    .incrementStep()
    .incrementAttempt()
    .setPermissions(['read:artifacts', 'write:code', 'execute:tests'])
    .grantPermissions()
    .addRestriction('delete:production')
    .loadExperience([{
      id: 'exp1', goal: 'Build REST API', planId: 'plan_prev',
      outcome: 'success', duration: 120000,
      patterns: ['Express.js', 'MVC', 'TypeScript'],
      lessons: ['Use middleware for auth', 'Validate input early'],
      timestamp: Date.now() - 86400000
    }]);

  const context = builder.build();
  
  // Verify all 7 contexts populated
  assert(context.intent.goal === 'Build a REST API for task management', 'Intent context');
  assert(context.intent.constraints.length === 2, 'Intent constraints');
  assert(context.intent.priority === 3, 'Intent priority');
  assert(context.intent.risk.length === 1, 'Intent risk');
  
  assert(context.plan.planId === 'plan_20260719_001', 'Plan context');
  assert(context.plan.currentPhase === 'execution', 'Plan phase');
  assert(context.plan.progress === 0.3, 'Plan progress');

  assert(context.memory.relevantMemories.length === 1, 'Memory context');
  assert(context.memory.contextBias === 'Backend development', 'Memory bias');
  assert(context.memory.activationScore === 0.85, 'Memory activation');

  assert(context.artifact.availableArtifacts.length === 1, 'Artifact context');
  assert(context.artifact.currentArtifact === 'art1', 'Artifact current');

  assert(context.executionState.status === 'running', 'Execution state');
  assert(context.executionState.step === 1, 'Execution step');
  assert(context.executionState.attempt === 1, 'Execution attempt');

  assert(context.permission.requiredPermissions.length === 3, 'Permission context');
  assert(context.permission.granted === true, 'Permission grant');
  assert(context.permission.restrictions.length === 1, 'Permission restriction');

  assert(context.experience.similarExperiences.length === 1, 'Experience context');
  assert(context.experience.patterns.length === 3, 'Experience patterns');
  assert(context.experience.recommendations.length === 2, 'Experience recommendations');

  console.log('\n  ✅ All 7 contexts built correctly');

  // ── 2. AgentHarness 初始化 ──
  console.log('\n--- 2. AgentHarness.initialize ---');
  const harness = new AgentHarness();
  
  const events: Array<{ event: string; data: any }> = [];
  harness.onEvent((event, data) => events.push({ event, data }));
  
  await harness.initialize(context);
  assert(harness.isInitialized, 'Harness initialized');
  assert(events.length === 1, 'Harness event emitted');
  assert(events[0].event === 'harness.ready', 'Harness ready event');

  // ── 3. AgentHarness.create (快捷方式) ──
  console.log('\n--- 3. AgentHarness.create ---');
  const harness2 = await AgentHarness.create(b =>
    b.setIntent('Analyze data', ['Use Python'])
      .setPlan('plan_002', { nodes: [] })
      .setExecutionState('running')
  );
  assert(harness2.isInitialized, 'Quick create');
  const ctx2 = harness2.getContext();
  assert(ctx2.intent.goal === 'Analyze data', 'Quick create intent');
  assert(ctx2.intent.constraints[0] === 'Use Python', 'Quick create constraint');

  // ── 4. 运行时方法 ──
  console.log('\n--- 4. Runtime methods ---');
  
  // Update intent
  harness.updateIntent({ goal: 'Updated goal', priority: 1 });
  const updatedCtx = harness.getContext();
  assert(updatedCtx.intent.goal === 'Updated goal', 'updateIntent');
  assert(updatedCtx.intent.priority === 1, 'updateIntent priority');

  // Update execution state
  harness.updateExecutionState({ status: 'completed' });
  assert(harness.getContext().executionState.status === 'completed', 'updateExecutionState');

  // Attach artifact
  harness.attachArtifact({ id: 'art2', name: 'Data Model', type: 'sql', version: '1.0.0', uri: '/artifacts/model.sql' });
  assert(harness.getContext().artifact.availableArtifacts.length === 2, 'attachArtifact');

  // Inject memory
  harness.injectMemory({ id: 'm2', content: 'Use pandas for data analysis', type: 'pattern', relevanceScore: 0.95, timestamp: Date.now() });
  assert(harness.getContext().memory.relevantMemories.length === 2, 'injectMemory');

  // Check permission
  assert(harness.checkPermission('read:artifacts') === true, 'checkPermission allowed');
  assert(harness.checkPermission('delete:production') === false, 'checkPermission denied');

  // ── 5. getAgentRuntime ──
  console.log('\n--- 5. getAgentRuntime ---');
  const runtime = harness.getAgentRuntime();
  assert(runtime.goal === 'Updated goal', 'runtime.goal');
  assert(runtime.constraints.length === 2, 'runtime.constraints');
  assert(runtime.artifacts.length === 2, 'runtime.artifacts');
  assert(runtime.memories.length === 2, 'runtime.memories');
  assert(runtime.patterns.length === 3, 'runtime.patterns');
  assert(runtime.executionStatus === 'completed', 'runtime.executionStatus');
  console.log('\n  ✅ AgentRuntime context extracted correctly');

  // ── 6. Connect to ExecutionGateway ──
  console.log('\n--- 6. Gateway Integration ---');
  // Verify AgentHarness can be constructed and passed to gateway
  // (This tests the type compatibility)
  const harnessForGateway = await AgentHarness.create(b =>
    b.setIntent('Test gateway', [])
      .setPlan('gw_plan', { nodes: [] })
      .setExecutionState('idle')
      .grantPermissions()
  );
  const gwCtx = harnessForGateway.getAgentRuntime();
  assert(typeof gwCtx.goal === 'string', 'Gateway-compatible context');
  assert(Array.isArray(gwCtx.artifacts), 'Gateway artifacts');
  assert(Array.isArray(gwCtx.memories), 'Gateway memories');

  // ── 7. Reset ──
  console.log('\n--- 7. Reset ---');
  harness2.reset();
  assert(!harness2.isInitialized, 'Reset clears state');

  console.log('\n=== Phase 2 all PASSED ===\n');
}
main().catch(e=>{console.error('FAIL:', e.message||e); process.exit(1);});
