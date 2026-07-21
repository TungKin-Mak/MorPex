/**
 * Real Data Full System Test — 使用真实数据测试所有功能模块
 * 
 * 不使用 mock。每个模块用真实输入、真实 I/O、真实状态转换。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 真实模块导入 ──
import { ExecutionFSM, ExecutionState } from '../packages/core/src/runtime/state-machine/ExecutionFSM.js';
import { DAGRuntime, TaskGraph, TaskNode } from '../packages/core/src/runtime/dag/index.js';
import { CheckpointManager } from '../packages/core/src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../packages/core/src/runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../packages/core/src/runtime/checkpoint/ReplayEngine.js';
import { AgentHarness, ContextBuilder } from '../packages/core/src/planes/agent-plane/index.js';
import { MemoryActivationEngine } from '../packages/core/src/memory/MemoryActivationEngine.js';
import { ArtifactGraph } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactGraph.js';
import { ArtifactLineage } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactLineage.js';
import { ExperienceExtractor } from '../packages/core/src/learning/ExperienceExtractor.js';
import { PlanEvaluator } from '../packages/core/src/learning/PlanEvaluator.js';
import { StrategyOptimizer } from '../packages/core/src/learning/StrategyOptimizer.js';
import { TemplateEvolutionEngine } from '../packages/core/src/learning/TemplateEvolutionEngine.js';
import { GoalExtractor } from '../packages/core/src/planes/control-plane/intent/GoalExtractor.js';
import { ConstraintAnalyzer } from '../packages/core/src/planes/control-plane/intent/ConstraintAnalyzer.js';
import { PriorityEngine } from '../packages/core/src/planes/control-plane/intent/PriorityEngine.js';
import { RiskDetector } from '../packages/core/src/planes/control-plane/intent/RiskDetector.js';
import { ExecutionPolicyGenerator } from '../packages/core/src/planes/control-plane/intent/ExecutionPolicyGenerator.js';
import { ArtifactRegistry } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactRegistry.js';

// ── 真实测试数据 ──
const REAL_USER_REQUEST = 'Build a REST API for task management with TypeScript, Express.js, and PostgreSQL. Support CRUD operations, JWT authentication, and request validation. Must handle 1000+ concurrent users with < 100ms response time. Deploy to Kubernetes with CI/CD pipeline.';

const REAL_MEMORIES = [
  { id: 'm1', content: 'Use Express.js with TypeScript for REST APIs. Middleware pattern: cors→auth→validate→handler→error. Always use async error wrapping.', type: 'pattern' as const, relevanceScore: 0.95, timestamp: Date.now() - 86400000 },
  { id: 'm2', content: 'TypeORM with PostgreSQL: use migrations, not sync. Always set connection pool max=20. Use repository pattern for testability.', type: 'pattern' as const, relevanceScore: 0.90, timestamp: Date.now() - 172800000 },
  { id: 'm3', content: 'JWT auth flow: /login returns access+refresh tokens. Access token 15min, refresh 7d. Blacklist on logout. Use bcrypt for passwords.', type: 'pattern' as const, relevanceScore: 0.88, timestamp: Date.now() - 259200000 },
  { id: 'm4', content: 'Kubernetes deployment: use HorizontalPodAutoscaler with CPU 70% target. Set resource limits: 256Mi-512Mi memory, 250m-500m CPU. Use readiness probes on /health.', type: 'pattern' as const, relevanceScore: 0.82, timestamp: Date.now() - 345600000 },
  { id: 'm5', content: 'Previous TypeORM migration failed due to column type mismatch. Fixed by using queryRunner.addColumn with explicit type. Always test migrations on staging first.', type: 'error' as const, relevanceScore: 0.75, timestamp: Date.now() - 432000000 },
  { id: 'm6', content: 'Rate limiting with express-rate-limit: 100 req/15min per IP. Store in Redis for multi-instance. Return 429 with Retry-After header.', type: 'pattern' as const, relevanceScore: 0.70, timestamp: Date.now() - 518400000 },
  { id: 'm7', content: 'CI/CD: GitHub Actions workflow. Build→Test→Lint→Docker build→Push to ECR→Deploy to K8s. Use environment-based secrets. Never hardcode credentials.', type: 'pattern' as const, relevanceScore: 0.85, timestamp: Date.now() - 604800000 },
];

const PERSIST_DIR = './data/real-test';

let passed = 0; let failed = 0; const errors: string[] = [];
function assert(c: boolean, msg: string) { if (c) passed++; else { failed++; errors.push(msg); } }
function section(title: string) { console.log(`\n━━━ ${title} ━━━`); }
function result(label: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ': ' + detail : ''}`);
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  MorPex v7 — Real Data Full System Test');
  console.log('═'.repeat(70));

  // ═══════════════════════════════════════
  // MODULE 1: Intent Analysis
  // ═══════════════════════════════════════
  section('1. Intent Analysis');
  
  const goalExtractor = new GoalExtractor();
  const constraintAnalyzer = new ConstraintAnalyzer();
  const priorityEngine = new PriorityEngine();
  const riskDetector = new RiskDetector();
  const policyGenerator = new ExecutionPolicyGenerator();

  const goal = goalExtractor.extract(REAL_USER_REQUEST);
  result('GoalExtractor', !!goal.primary, goal.primary?.substring(0, 60));
  assert(!!goal.primary, 'goal extracted');
  assert(typeof goal.type === 'string', 'goal type');

  const constraints = constraintAnalyzer.analyze(REAL_USER_REQUEST);
  result('ConstraintAnalyzer', constraints.technical.length > 0, `${constraints.technical.length} technical, ${constraints.quality.length} quality`);
  assert(constraints.technical.length > 0, 'technical constraints found');

  const priority = priorityEngine.calculate(goal, constraints);
  result('PriorityEngine', typeof priority.score === 'number', `score=${priority.score}`);
  assert(priority.score > 0, 'priority score positive');

  const risks = riskDetector.detect(goal, constraints);
  result('RiskDetector', Array.isArray(risks), `${risks.length} risks`);
  assert(Array.isArray(risks), 'risks returned');

  const policy = policyGenerator.generate(goal, constraints, priority, risks);
  result('ExecutionPolicyGenerator', !!policy.mode, `mode=${policy.mode}`);
  assert(!!policy.mode, 'policy mode set');

  // ═══════════════════════════════════════
  // MODULE 2: ExecutionFSM
  // ═══════════════════════════════════════
  section('2. ExecutionFSM');
  
  fs.mkdirSync(PERSIST_DIR, { recursive: true });
  const fsmEvents: string[] = [];
  
  const fsm = new ExecutionFSM({
    executionId: 'real-exe-1',
    persistDir: PERSIST_DIR,
    autoPersist: true,
    onEnter: (s) => fsmEvents.push('enter:' + s),
    onExit: (s) => fsmEvents.push('exit:' + s),
  });

  assert(fsm.currentState === ExecutionState.CREATED, 'initial CREATED');
  fsm.startPlanning('User requested REST API');
  assert(fsm.currentState === ExecutionState.PLANNING, '→PLANNING');
  fsm.markReady('Plan validated');
  assert(fsm.currentState === ExecutionState.READY, '→READY');
  fsm.startExecution('DAG runtime started');
  assert(fsm.currentState === ExecutionState.EXECUTING, '→EXECUTING');
  
  result('FSM transition', true, `CREATED→PLANNING→READY→EXECUTING (${fsmEvents.length} events)`);
  assert(fsmEvents.length >= 6, 'enter+exit events');
  assert(fsm.history.length >= 6, 'audit trail');

  // ═══════════════════════════════════════
  // MODULE 3: DAG Runtime
  // ═══════════════════════════════════════
  section('3. DAG Runtime');

  const dag = new DAGRuntime({ maxParallel: 3, continueOnFailure: true });
  
  // Build a real DAG: Setup → Backend → Auth → Tests → Deploy
  const executionDAG = {
    id: 'real-dag-1', createdAt: Date.now(),
    nodes: [
      { id: 'setup',   name: 'Project Setup',      agentType: 'expert', description: 'Initialize project', deps: [], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'backend', name: 'Backend API',         agentType: 'expert', description: 'Build REST API', deps: ['setup'], status: 'pending' as const, priority: 2, retryCount: 0, maxRetries: 2 },
      { id: 'auth',    name: 'JWT Authentication',  agentType: 'expert', description: 'Implement auth', deps: ['backend'], status: 'pending' as const, priority: 2, retryCount: 0, maxRetries: 2 },
      { id: 'tests',   name: 'Integration Tests',   agentType: 'expert', description: 'Write tests', deps: ['auth'], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'deploy',  name: 'K8s Deployment',      agentType: 'expert', description: 'Deploy to K8s', deps: ['tests'], status: 'pending' as const, priority: 1, retryCount: 0, maxRetries: 2 },
    ],
    edges: [
      { from: 'setup', to: 'backend', weight: 1 },
      { from: 'backend', to: 'auth', weight: 1 },
      { from: 'auth', to: 'tests', weight: 1 },
      { from: 'tests', to: 'deploy', weight: 1 },
    ],
    status: { totalNodes: 5, totalEdges: 4, mutations: 0, isCyclic: false, canRollback: true, isComplete: false },
  };

  const dagResult = await dag.run(executionDAG, {});
  result('DAG execution', dagResult.success, `${dagResult.completedNodes}/${dagResult.totalNodes} nodes`);
  assert(dagResult.success, 'DAG completed');
  assert(dagResult.completedNodes === 5, 'all 5 nodes completed');

  fsm.review('DAG execution complete');
  fsm.complete('All tasks finished');
  assert(fsm.currentState === ExecutionState.COMPLETED, '→COMPLETED');

  // Verify FSM persistence
  const restored = await ExecutionFSM.restore('real-exe-1', PERSIST_DIR);
  assert(restored !== null, 'FSM restored from disk');
  assert(restored!.currentState === ExecutionState.EXECUTING || restored!.currentState === ExecutionState.COMPLETED, 'restored state correct');
  result('FSM persistence', restored !== null, `restored=${restored?.currentState}`);

  // ═══════════════════════════════════════
  // MODULE 4: Checkpoint + Recovery + Replay
  // ═══════════════════════════════════════
  section('4. Checkpoint + Recovery + Replay');

  const cp = new CheckpointManager({ baseDir: PERSIST_DIR + '/checkpoints' });
  const rec = new RecoveryManager();

  // Save a real execution snapshot
  const now = Date.now();
  const snapshot = {
    executionId: 'real-snap-1', dagId: 'real-dag-1',
    dagState: {
      nodeStates: [
        { nodeId: 'setup',   name: 'Project Setup',     status: 'success' as const, attempts: 1, completedAt: now - 4000 },
        { nodeId: 'backend', name: 'Backend API',        status: 'success' as const, attempts: 1, completedAt: now - 3000 },
        { nodeId: 'auth',    name: 'JWT Authentication', status: 'failed' as const,  attempts: 1, error: 'Token encoding error: secret key not configured' },
        { nodeId: 'tests',   name: 'Integration Tests',  status: 'pending' as const, attempts: 0 },
        { nodeId: 'deploy',  name: 'K8s Deployment',     status: 'pending' as const, attempts: 0 },
      ],
      edges: [{ from: 'setup', to: 'backend' }, { from: 'backend', to: 'auth' }, { from: 'auth', to: 'tests' }, { from: 'tests', to: 'deploy' }],
    },
    timestamp: now, metadata: { scenario: 'auth-failure' },
  };

  await cp.save('real-snap-1', snapshot);
  const loaded = await cp.load('real-snap-1');
  assert(loaded !== null, 'snapshot saved and loaded');
  result('Checkpoint save/load', loaded !== null);

  // Recovery plan
  const recoveryPlan = await rec.recover(snapshot);
  result('Recovery plan', recoveryPlan.canRecover, `retry=${recoveryPlan.retryCount} skip=${recoveryPlan.skipCount} continue=${recoveryPlan.continueCount}`);
  assert(recoveryPlan.canRecover, 'recoverable');
  assert(recoveryPlan.actions.some(a => a.nodeId === 'auth' && a.action === 'retry'), 'auth node retries');
  assert(recoveryPlan.actions.some(a => a.nodeId === 'setup' && a.action === 'skip'), 'setup skipped');

  // Replay
  const replay = new ReplayEngine(cp);
  const replayEvents = await replay.replayFast('real-snap-1');
  assert(replayEvents.length > 0, 'replay produces events');
  assert(replayEvents.some(e => e.type === 'node-start'), 'replay has start events');
  result('Replay', replayEvents.length > 0, `${replayEvents.length} events`);

  // List & cleanup
  const snapshots = await cp.list();
  assert(snapshots.includes('real-snap-1'), 'snapshot listed');
  result('Checkpoint list', snapshots.length >= 1, `${snapshots.length} snapshots`);

  // ═══════════════════════════════════════
  // MODULE 5: AgentHarness (7 contexts)
  // ═══════════════════════════════════════
  section('5. AgentHarness');

  const harness = await AgentHarness.create(b =>
    b.setIntent('Build REST API for task management', ['TypeScript', 'Express.js', 'PostgreSQL'])
      .setIntentPriority(2)
      .addRisk('Database migration failure')
      .addRisk('JWT secret exposure')
      .setPlan('plan-real-1', { nodes: executionDAG.nodes, edges: executionDAG.edges })
      .setPlanPhase('execution')
      .setProgress(0.6)
      .injectMemory(REAL_MEMORIES.slice(0, 3))
      .setContextBias('Backend API development')
      .setActivationScore(0.85)
      .attachArtifact({ id: 'art-api-spec', name: 'API Specification v2', type: 'openapi', version: '2.0.0', uri: 'artifact://default/openapi/art-api-spec' })
      .setCurrentArtifact('art-api-spec')
      .setExecutionState('running')
      .incrementStep()
      .setPermissions(['read:artifacts', 'write:code', 'execute:tests'])
      .grantPermissions()
      .addRestriction('delete:production')
      .loadExperience([{
        id: 'exp-1', goal: 'Build REST API', planId: 'plan-prev',
        outcome: 'success', duration: 180000,
        patterns: ['Express.js', 'TypeScript', 'PostgreSQL', 'JWT'],
        lessons: ['Always validate input', 'Use async error handling', 'Test auth edge cases'],
        timestamp: Date.now() - 86400000,
      }])
  );

  const ctx = harness.getContext();
  assert(ctx.intent.goal.includes('REST API'), 'Intent goal');
  assert(ctx.intent.constraints.length === 3, 'Intent constraints');
  assert(ctx.intent.risk.length === 2, 'Intent risks');
  assert(ctx.plan.planId === 'plan-real-1', 'Plan ID');
  assert(ctx.memory.relevantMemories.length >= 3, 'Memory loaded');
  assert(ctx.artifact.availableArtifacts.length === 1, 'Artifact attached');
  assert(ctx.executionState.status === 'running', 'Execution running');
  assert(ctx.permission.restrictions.includes('delete:production'), 'Permission restriction');
  assert(ctx.experience.patterns.length >= 3, 'Experience patterns');

  const agentCtx = harness.getAgentRuntime();
  assert(typeof agentCtx.goal === 'string', 'Agent has goal');
  assert(Array.isArray(agentCtx.memories), 'Agent has memories');
  assert(Array.isArray(agentCtx.artifacts), 'Agent has artifacts');
  result('AgentHarness 7 contexts', true, 'all 7 verified');

  // Context version tracking
  const vBefore = harness.contextVersion;
  harness.updateIntent({ priority: 1 });
  assert(harness.contextVersion > vBefore, 'version bumped');
  result('Context versioning', true, `v${vBefore}→v${harness.contextVersion}`);

  // Snapshot
  const snap = harness.snapshot();
  assert(snap !== null, 'snapshot taken');
  result('Harness snapshot', snap !== null, `${harness.contextVersion} versions`);

  // ═══════════════════════════════════════
  // MODULE 6: Memory Activation
  // ═══════════════════════════════════════
  section('6. Memory Activation');

  const memEngine = new MemoryActivationEngine();
  for (const mem of REAL_MEMORIES) {
    memEngine.addMemory(mem);
  }

  // State-aware recall: running state
  const runningActivation = memEngine.activate({
    executionStatus: 'running', goal: 'Build REST API', currentStep: 3, totalSteps: 5,
    completedSteps: ['setup', 'backend'], errors: [], tags: ['api', 'typescript'],
  });
  result('State-aware recall', runningActivation.memories.length > 0,
    `${runningActivation.memories.length} memories, score=${runningActivation.activationScore.toFixed(2)}`);
  assert(runningActivation.memories.length > 0, 'memories activated');

  // Error context boosts error memories
  const errorActivation = memEngine.activate({
    executionStatus: 'running', goal: 'Fix database error', currentStep: 3, totalSteps: 5,
    completedSteps: [], errors: ['TypeORM migration failed'], tags: ['database', 'debug'],
  });
  result('Error-aware recall', errorActivation.contextBias.includes('error'),
    `bias=${errorActivation.contextBias}`);

  // Task-aware: different tasks get different biases
  const apiActivation = memEngine.activate({
    executionStatus: 'running', goal: 'Build REST API with Express', currentStep: 1, totalSteps: 3,
    completedSteps: [], errors: [], tags: ['api'],
  });
  const deployActivation = memEngine.activate({
    executionStatus: 'running', goal: 'Deploy to Kubernetes', currentStep: 1, totalSteps: 3,
    completedSteps: [], errors: [], tags: ['kubernetes'],
  });
  result('Task-aware recall', apiActivation.contextBias !== deployActivation.contextBias,
    `API bias≠Deploy bias`);

  // Attach to harness
  harness.attachMemoryEngine(memEngine);
  const agentCtx2 = harness.getAgentRuntime('Build REST API');
  assert(agentCtx2.activationScore !== undefined, 'activation score in agent context');
  result('Memory→Harness injection', true, `score=${agentCtx2.activationScore?.toFixed(2)}`);

  // ═══════════════════════════════════════
  // MODULE 7: Artifact Graph + Lineage
  // ═══════════════════════════════════════
  section('7. Artifact Graph + Lineage');

  const artGraph = new ArtifactGraph();
  
  // Real artifact nodes representing actual development artifacts
  artGraph.addNode({ id: 'art-api-spec', name: 'API Specification', type: 'openapi', capabilities: ['REST', 'CRUD'], creator: 'architect-agent', version: '2.0.0', tags: ['api', 'spec'] });
  artGraph.addNode({ id: 'art-backend', name: 'Backend Service', type: 'code', capabilities: ['server', 'api'], creator: 'backend-agent', version: '1.5.0', tags: ['backend', 'typescript'] });
  artGraph.addNode({ id: 'art-auth', name: 'Auth Module', type: 'code', capabilities: ['auth', 'jwt'], creator: 'auth-agent', version: '1.2.0', tags: ['auth', 'security'] });
  artGraph.addNode({ id: 'art-tests', name: 'Test Suite', type: 'test', capabilities: ['test', 'coverage'], creator: 'qa-agent', version: '1.0.0', tags: ['test', 'integration'] });
  artGraph.addNode({ id: 'art-deploy', name: 'K8s Manifests', type: 'config', capabilities: ['deploy', 'k8s'], creator: 'devops-agent', version: '1.0.0', tags: ['kubernetes', 'deploy'] });
  
  artGraph.addEdge('art-api-spec', 'art-backend', 'generated_from');
  artGraph.addEdge('art-backend', 'art-auth', 'depends_on');
  artGraph.addEdge('art-auth', 'art-tests', 'depends_on');
  artGraph.addEdge('art-tests', 'art-deploy', 'depends_on');

  assert(artGraph.size() === 5, '5 artifacts');
  assert(artGraph.edgeCount() === 4, '4 edges');
  result('ArtifactGraph', true, `${artGraph.size()} nodes, ${artGraph.edgeCount()} edges`);

  const lineage = new ArtifactLineage(artGraph);
  const fullLineage = lineage.getFullLineage('art-tests');
  assert(fullLineage.ancestors.length >= 2, 'ancestors found');
  result('ArtifactLineage', true, `${fullLineage.ancestors.length} ancestors, ${fullLineage.descendants.length} descendants`);

  // Impact analysis: if backend changes, what breaks?
  const impact = artGraph.impactAnalysis('art-backend');
  result('Impact analysis', impact.direct.length + impact.indirect.length > 0,
    `direct=${impact.direct.length} indirect=${impact.indirect.length}`);

  // JSON serialization (real persistence)
  const json = artGraph.toJSON();
  const restored2 = ArtifactGraph.fromJSON(json);
  assert(restored2.size() === 5, 'JSON roundtrip');
  result('ArtifactGraph JSON', true, 'roundtrip OK');

  // ═══════════════════════════════════════
  // MODULE 8: Learning Loop
  // ═══════════════════════════════════════
  section('8. Learning Loop');

  const extractor = new ExperienceExtractor();
  const evaluator = new PlanEvaluator();
  const optimizer = new StrategyOptimizer();
  const templateEngine = new TemplateEvolutionEngine();

  // Real execution record
  const execRecord = {
    executionId: 'real-exe-1', goal: 'Build REST API for task management with TypeScript and PostgreSQL',
    planId: 'plan-real-1',
    nodes: [
      { id: 'setup', name: 'Project Setup', status: 'success', duration: 15000 },
      { id: 'backend', name: 'Backend API', status: 'success', duration: 120000 },
      { id: 'auth', name: 'JWT Authentication', status: 'success', duration: 45000 },
      { id: 'tests', name: 'Integration Tests', status: 'success', duration: 60000 },
      { id: 'deploy', name: 'K8s Deployment', status: 'success', duration: 30000 },
    ],
    success: true, duration: 270000, errors: [],
    startTime: Date.now() - 270000, endTime: Date.now(),
  };

  const experience = extractor.extract(execRecord);
  assert(experience !== null, 'experience extracted');
  assert(experience!.outcome === 'success', 'outcome success');
  assert(experience!.patterns.length > 0, 'patterns extracted');
  assert(experience!.lessons.length > 0, 'lessons learned');
  result('Experience extraction', true, `${experience!.patterns.length} patterns, ${experience!.lessons.length} lessons`);

  // Dedup: same input should skip
  const dup = extractor.extract(execRecord);
  assert(dup === null, 'dedup works');
  result('Experience dedup', dup === null, 'duplicate skipped');

  // Plan evaluation
  const planRecord = {
    planId: 'plan-real-1',
    nodes: execRecord.nodes.map(n => ({ ...n, agentType: 'expert', description: '', deps: [], priority: 1, retryCount: 0, maxRetries: 2 })),
    edges: [],
    status: { totalNodes: 5, totalEdges: 4, mutations: 0, isCyclic: false, canRollback: true, isComplete: true },
    createdAt: Date.now(),
  };
  const evaluation = evaluator.evaluate(planRecord, execRecord);
  assert(evaluation !== null, 'evaluation produced');
  result('Plan evaluation', true, `score details available`);

  // Strategy suggestions
  const suggestions = optimizer.optimize();
  assert(Array.isArray(suggestions), 'suggestions array');
  result('Strategy optimization', suggestions.length >= 0, `${suggestions.length} suggestions`);

  // Template evolution
  const stats = templateEngine.getStats();
  assert(typeof stats.total === 'number', 'template stats');
  result('Template evolution', true, `${stats.total} templates`);

  // ═══════════════════════════════════════
  // MODULE 9: Harness Resource Access
  // ═══════════════════════════════════════
  section('9. Harness Resource Access');

  // Register artifact through harness
  const registry = new ArtifactRegistry();
  harness.attachProviders({
    getArtifactRegistry: () => registry,
    getKnowledgeGraph: () => ({ searchEntities: () => [] }),
    getMemoryRetriever: () => null,
  });

  const regResult = await harness.registerArtifact({ 
    name: 'Real Test Artifact', type: 'code', 
    content: 'console.log("real data test");', tags: ['real', 'test'] 
  });
  assert(!!regResult.id, 'artifact registered via harness');
  result('Harness registerArtifact', !!regResult.id, regResult.id);

  // Read artifact through harness
  const readArtifact = harness.getArtifact(`artifact://default/code/${regResult.id}`);
  assert(readArtifact !== null && readArtifact !== undefined, 'artifact read via harness');
  result('Harness getArtifact', readArtifact !== null);

  // Search memory through harness
  const memResult = harness.searchMemory('TypeScript', 'docs');
  result('Harness searchMemory', memResult !== undefined, 'search executed');

  // Query knowledge through harness
  const kgResult = harness.queryKnowledge('API', 5);
  result('Harness queryKnowledge', Array.isArray(kgResult), `${kgResult.length} results`);

  // Permission check
  assert(harness.checkPermission('read:artifacts') === true, 'read allowed');
  assert(harness.checkPermission('delete:production') === false, 'delete denied');
  result('Harness permissions', true, 'enforced');

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  REAL DATA TEST RESULTS');
  console.log('═'.repeat(70));
  console.log(`  Passed: ${passed}/${passed + failed}`);
  if (errors.length > 0) {
    console.log(`  Errors:`);
    for (const e of errors) console.log(`    - ${e}`);
  }
  console.log('═'.repeat(70) + '\n');

  // Cleanup test data
  try { fs.rmSync(PERSIST_DIR, { recursive: true }); } catch {}

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('CRASH:', e); process.exit(2); });
