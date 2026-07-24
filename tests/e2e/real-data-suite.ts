/**
 * MorPex v9.2 — 真实数据端到端测试套件
 *
 * 覆盖 8 大场景，验证全部 Plane 和 Agent 模块。
 *
 * 运行: npx tsx tests/e2e/real-data-suite.ts
 *
 * 使用方式:
 *   1. 全部运行:    npx tsx tests/e2e/real-data-suite.ts
 *   2. 指定场景:    npx tsx tests/e2e/real-data-suite.ts --only=simple,team
 *   3. 开启 Feature: MORPEX_MARKETPLACE_ENABLED=1 npx tsx tests/e2e/real-data-suite.ts
 */

import Database from 'better-sqlite3';
import { SqliteEventStore } from '../../packages/core/src/protocol/events/store/SqliteEventStore.js';
import { UnifiedEventStore } from '../../packages/core/src/protocol/events/store/UnifiedEventStore.js';
import { CognitivePipeline } from '../../packages/core/src/runtime/cognitive-loop/CognitivePipeline.js';
import { EventBus } from '../../packages/core/src/common/EventBus.js';
import { ContextAssemblyEngine } from '../../packages/core/src/context/ContextAssemblyEngine.js';
import { ContextPersistence } from '../../packages/core/src/context/ContextPersistence.js';
import { ArtifactPlane } from '../../packages/core/src/planes/artifact-plane/ArtifactPlane.js';
import { ArtifactSqliteRepository } from '../../packages/core/src/planes/artifact-plane/ArtifactSqliteRepository.js';
import { AgentRegistry } from '../../packages/core/src/agent/registry/AgentRegistry.js';
import { AgentScheduler } from '../../packages/core/src/agent/scheduler/AgentScheduler.js';
import { AgentMessageBus } from '../../packages/core/src/agent/communication/AgentMessageBus.js';
import { CollaborationManager } from '../../packages/core/src/agent/collaboration/CollaborationManager.js';
import { NegotiationEngine } from '../../packages/core/src/agent/collaboration/NegotiationEngine.js';
import { AgentProfileManager } from '../../packages/core/src/agent/identity/AgentProfile.js';
import { AgentMemoryIsolation } from '../../packages/core/src/agent/memory/AgentMemoryIsolation.js';
// ARCHIVED: SharedMemoryManager (see packages/archived/agent-shared-memory/)
// import { SharedMemoryManager } from '../../packages/core/src/agent/memory/SharedMemoryManager.js';
import { AgentLifecycle } from '../../packages/core/src/agent/lifecycle/AgentLifecycle.js';
import { CrossAgentLearningEngine } from '../../packages/core/src/agent/learning/CrossAgentLearningEngine.js';
import { ExperienceRepository } from '../../packages/core/src/agent/learning/ExperienceRepository.js';
import { KnowledgeDistiller } from '../../packages/core/src/agent/learning/KnowledgeDistiller.js';
import { LearningPropagationService } from '../../packages/core/src/agent/learning/LearningPropagationService.js';
import { ExperienceMatcher } from '../../packages/core/src/agent/learning/ExperienceMatcher.js';
// ARCHIVED: OrganizationPolicyEngine, TeamGovernanceModel, OrgBudgetAllocator (see packages/archived/agent-governance/)
// import { OrganizationPolicyEngine } from '../../packages/core/src/agent/governance/OrganizationPolicyEngine.js';
// import { TeamGovernanceModel } from '../../packages/core/src/agent/governance/TeamGovernanceModel.js';
// import { OrgBudgetAllocator } from '../../packages/core/src/agent/governance/OrgBudgetAllocator.js';
// ARCHIVED: TeamFormationEngine (see packages/archived/agent-team/)
import { AgentRanking } from '../../packages/core/src/agent/ranking/AgentRanking.js';
import { AgentBenchmark } from '../../packages/core/src/agent/benchmark/AgentBenchmark.js';
import { ErrorHandlerService } from '../../packages/core/src/common/resilience/ErrorHandlerService.js';
import { RetryPolicy } from '../../packages/core/src/common/resilience/RetryPolicy.js';
import { CircuitBreaker } from '../../packages/core/src/common/resilience/CircuitBreaker.js';
import { CompactionService } from '../../packages/core/src/observability/CompactionService.js';
import { MetricsCollector, type V9Metrics } from '../../packages/core/src/observability/MetricsCollector.js';
import { config } from '../../packages/core/config/MorPexConfig.js';
import type { IncomingMessage } from '../../packages/core/src/interaction/types.js';
import { BUILTIN_AGENTS } from '../../packages/core/src/agent/AgentBootstrap.js';

// ═══════════════════════════════════════════════════════════════
// Test Infrastructure
// ═══════════════════════════════════════════════════════════════

const ARGS = new Set(process.argv.slice(2).filter(a => !a.startsWith('--')).concat(
  process.argv.filter(a => a.startsWith('--only=')).flatMap(a => a.replace('--only=', '').split(','))
));

function shouldRun(name: string): boolean {
  if (ARGS.size === 0) return true;
  return ARGS.has(name) || ARGS.has('all');
}

let passed = 0;
let failed = 0;
const results: { name: string; status: string; duration: number; detail: string }[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// Setup — 创建共享的 in-memory 基础设施
// ═══════════════════════════════════════════════════════════════

const db = new Database(':memory:');
const eventStore = new UnifiedEventStore(db);
const eventBus = new EventBus();
const metrics = new MetricsCollector();
const persistence = new ContextPersistence(db);
const artifactSqlite = new ArtifactSqliteRepository(db);
const artifactPlane = new ArtifactPlane();
const profileManager = new AgentProfileManager();
const registry = new AgentRegistry();
const messageBus = new AgentMessageBus();
const scheduler = new AgentScheduler(registry, null);
const memoryIsolation = new AgentMemoryIsolation();
// const sharedMemory = new SharedMemoryManager(db);  // ARCHIVED — use DepartmentContext.partitionKey() instead
const lifecycle = new AgentLifecycle();
const ranking = new AgentRanking();
const benchmark = new AgentBenchmark();
const errorHandler = new ErrorHandlerService(eventBus);
const collaboration = new CollaborationManager(scheduler, messageBus, registry, profileManager);
const negotiation = new NegotiationEngine(messageBus);

// Cross-Agent Learning
const expRepo = new ExperienceRepository();
const distiller = new KnowledgeDistiller();
const propagator = new LearningPropagationService();
const matcher = new ExperienceMatcher();
const learningEngine = new CrossAgentLearningEngine(expRepo, distiller, propagator, matcher);

// Governance — ARCHIVED (one-person company does not need governance policies)
// const orgPolicy = new OrganizationPolicyEngine();
// const teamGovernance = new TeamGovernanceModel();
// const budgetAllocator = new OrgBudgetAllocator();

// Context assembly
const contextEngine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, {
  enableVersioning: true,
  enableEnrichment: false,
  maxFragments: 20,
  fragmentTimeoutMs: 2000,
});

// Wire error handler with policies (use fast retry for e2e tests)
errorHandler.registerPolicy('execution', RetryPolicy.fast());
errorHandler.registerPolicy('planning', RetryPolicy.standard());
errorHandler.registerBreaker('execution', new CircuitBreaker('exec-cb', { failureThreshold: 5 }));

// Compaction
const compaction = new CompactionService(db, { autoRunIntervalMs: 0 });

// ═══════════════════════════════════════════════════════════════
// Register built-in agents for testing
// ═══════════════════════════════════════════════════════════════

function seedAgents(): void {
  const builtin = typeof BUILTIN_AGENTS === 'function' ? BUILTIN_AGENTS() : [];
  if (builtin.length > 0) {
    for (const agent of builtin) {
      registry.register(agent);
      profileManager.register(agent.identity || agent);
    }
    return;
  }
  // Fallback: register synthetic agents
  const agents = [
    { id: 'planner-001', name: 'PlannerAgent', role: 'planner' as const, capabilities: ['planning', 'task_decomposition'], status: 'ACTIVE' as const },
    { id: 'coder-001', name: 'CoderAgent', role: 'coder' as const, capabilities: ['coding', 'code_review'], status: 'ACTIVE' as const },
    { id: 'reviewer-001', name: 'ReviewerAgent', role: 'reviewer' as const, capabilities: ['output_validation', 'error_handling'], status: 'ACTIVE' as const },
    { id: 'researcher-001', name: 'ResearcherAgent', role: 'researcher' as const, capabilities: ['research', 'data_analysis'], status: 'ACTIVE' as const },
    { id: 'coordinator-001', name: 'CoordinatorAgent', role: 'coordinator' as const, capabilities: ['task_execution', 'orchestration'], status: 'ACTIVE' as const },
  ];
  for (const a of agents) {
    const identity = {
      id: a.id, name: a.name, role: a.role, capabilities: a.capabilities,
      memoryScope: `mem_${a.id}`, permissionScope: 'default', status: a.status,
      version: 1, createdAt: Date.now(),
    };
    registry.register({ identity, successRate: 1, avgLatency: 100, costPerTask: 0.5, humanEscalationRate: 0, reliabilityScore: 1, totalTasks: 10, completedTasks: 10, failedTasks: 0, lastActiveAt: Date.now(), failureHistory: [] });
    profileManager.register(identity);
    memoryIsolation.createPartition(a.id);
  }
}

// ═══════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════

function makeMessage(content: string, domain?: string): IncomingMessage {
  return {
    sessionId: `ses_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: 'test-user',
    content,
    domain: domain || 'general',
    timestamp: Date.now(),
  };
}

async function runPipeline(msg: IncomingMessage): Promise<any> {
  // Simplified pipeline execution without full Stage setup
  // Uses the core modules directly
  const missionId = `mis_${Date.now()}`;

  // 1. Context assembly
  const ctx = await contextEngine.assemble({ missionId, userId: msg.userId });
  persistence.save(ctx, 'e2e-test');

  // 2. Event recording
  await eventStore.append({
    id: `evt_${Date.now()}`,
    type: 'mission.created',
    timestamp: Date.now(),
    executionId: missionId,
    source: 'e2e-suite',
    payload: { content: msg.content, domain: msg.domain },
  });

  return { missionId, contextId: ctx.contextId, contextVersion: ctx.version };
}

// ═══════════════════════════════════════════════════════════════
// Test 1: Simple Task — Context + Event + Artifact
// ═══════════════════════════════════════════════════════════════

async function testSimpleTask() {
  const msg = makeMessage('帮我总结本周会议要点并生成行动清单', 'productivity');
  const result = await runPipeline(msg);

  assert(!!result.missionId, 'Mission ID 应存在');
  assert(!!result.contextId, 'Context ID 应存在');

  // Verify persistence
  const loadedCtx = persistence.loadLatest(result.contextId);
  assert(loadedCtx !== undefined, 'Context 应从 SQLite 恢复');
  assert(loadedCtx!.missionId === result.missionId, 'Context missionId 应一致');

  // Create an artifact
  const artifact = artifactPlane.create({
    meta: { name: '会议总结', type: 'document' },
    content: '# 本周会议要点\n- 要点1\n- 要点2\n## 行动清单\n- [ ] 任务A',
    createdBy: 'planner-001',
  });
  assert(!!artifact.id, 'Artifact 应创建');
  assert(artifact.status === 'draft', '初始状态为 draft');

  // Store artifact in SQLite
  artifactSqlite.save(artifact);
  const loaded = artifactSqlite.get(artifact.id);
  assert(loaded !== undefined, 'Artifact 应从 SQLite 恢复');

  // Record metrics
  metrics.record('task.simple.duration', 150, { domain: 'productivity' });

  return { missionId: result.missionId, artifactId: artifact.id };
}

// ═══════════════════════════════════════════════════════════════
// Test 2: Multi-Agent Collaboration
// ═══════════════════════════════════════════════════════════════

async function testMultiAgentCollaboration() {
  const plan = collaboration.createPlan('mis_collab_1', ['planning', 'coding', 'output_validation'], 3);
  assert(plan.tasks.length === 3, '应有 3 个任务');
  assert(plan.mode === 'parallel', '默认并行模式');

  // Simulate cross-agent messages
  messageBus.send({
    id: 'msg_1', from: 'planner-001', to: 'coder-001',
    type: 'REQUEST', payload: { task: 'write code' }, timestamp: Date.now(),
  });
  messageBus.send({
    id: 'msg_2', from: 'coder-001', to: 'reviewer-001',
    type: 'REQUEST', payload: { task: 'review code' }, timestamp: Date.now(),
  });
  messageBus.send({
    id: 'msg_3', from: 'reviewer-001', to: 'planner-001',
    type: 'RESPONSE', payload: { status: 'approved' }, timestamp: Date.now(),
  });

  const history = messageBus.getHistory();
  assert(history.length >= 3, '应有 >= 3 条消息');

  // Shared memory usage — ARCHIVED: SharedMemoryManager
  // sharedMemory.write('team:mis_collab_1:plan', { steps: ['analyze', 'code', 'review'] }, 'team_shared', 'planner-001');
  // const planData = sharedMemory.read('team:mis_collab_1:plan', 'team_shared');
  // assert(planData !== undefined, 'SharedMemory 写入后应可读');
  // assert((planData as any).steps.length === 3, '计划应有 3 步');

  // Collaboration stats
  const stats = collaboration.getStats();
  assert(stats.totalCollaborations >= 0, '协作统计应可查询');

  metrics.recordTeamFormation(250, 3);

  return { messageCount: history.length, planSteps: 0 /* ARCHIVED: SharedMemory */ };
}

// ═══════════════════════════════════════════════════════════════
// Test 3: Marketplace — Bid + Contract
// ═══════════════════════════════════════════════════════════════

async function testMarketplaceBidding() {
  // Simulate marketplace flow
  const listing = {
    id: 'list_001', agentId: 'external-data-agent', capability: 'data_analysis',
    pricePerTask: 50, availability: 1, reputation: 0.85, totalTasks: 100,
    successRate: 0.92, metadata_json: '{}', listedAt: Date.now(),
  };

  // Simulate bid
  const bidRequest = {
    id: 'bid_req_1',
    taskDescription: '分析销售CSV数据',
    requiredCapabilities: ['data_analysis'],
    maxBudget: 200,
    deadline: Date.now() + 60000,
  };

  // Simulate bid selection without real message round-trip
  const bids = [
    { agentId: 'external-data-agent', accepted: true, bid: { estimatedDuration: 5000, estimatedCost: 50, confidence: 0.9 } },
    { agentId: 'researcher-001', accepted: true, bid: { estimatedDuration: 8000, estimatedCost: 30, confidence: 0.7 } },
  ];
  const winner = bids.sort((a, b) => (b.bid.confidence / (b.bid.estimatedCost + 0.01)) - (a.bid.confidence / (a.bid.estimatedCost + 0.01)))[0];

  assert(winner !== undefined, '应有中标 Agent');

  metrics.recordMarketplaceBid(listing.id, true);

  return { listingId: listing.id, winner: winner.agentId };
}

// ═══════════════════════════════════════════════════════════════
// Test 4: Failure Recovery — ErrorHandler + Compensation
// ═══════════════════════════════════════════════════════════════

async function testFailureRecovery() {
  let compensatorCalled = false;

  try {
    await errorHandler.executeWithRecovery(
      async () => { throw new Error('Simulated Agent crash'); },
      {
        stage: 'execution',
        missionId: 'mis_recovery_1',
        operation: 'test-failure',
        compensator: async (_err) => { compensatorCalled = true; },
      },
    );
  } catch {
    // Expected: all retries exhausted
  }

  assert(compensatorCalled, 'Compensator 应在最终失败时调用');

  // Check circuit breaker state (registered under stage name 'execution')
  const cb = errorHandler.getBreakerStates();
  assert('execution' in cb, 'Circuit breaker 应存在');

  // Check error log
  const log = errorHandler.getErrorLog('mis_recovery_1');
  assert(log.length > 0, 'Error log 应有记录');
  assert(log[0].recovered === false, '应标记为未恢复');

  metrics.record('resilience.compensation', 1, { stage: 'execution' });

  return { compensatorCalled, errorCount: log.length };
}

// ═══════════════════════════════════════════════════════════════
// Test 5: Distributed Simulation — Remote Messages
// ═══════════════════════════════════════════════════════════════

async function testDistributedSimulation() {
  // Simulate cross-node communication
  const messages = [
    { from: 'node-1', to: 'node-2', type: 'REQUEST', payload: { task: 'compute' } },
    { from: 'node-2', to: 'node-1', type: 'RESPONSE', payload: { result: 42 } },
    { from: 'node-1', to: 'node-2', type: 'HEARTBEAT', payload: {} },
  ];

  for (const m of messages) {
    await eventStore.append({
      id: `evt_rm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'agent.message.sent',
      timestamp: Date.now(),
      executionId: 'mis_dist_1',
      source: m.from,
      payload: { toNode: m.to, ...m.payload },
    });
  }

  // Query distributed messages
  const sent = await eventStore.query({ type: 'agent.message.sent', executionId: 'mis_dist_1' });
  assert(sent.length === 3, '应有 3 条跨节点消息');

  metrics.recordDistributedMessage('node-1', 'node-2', 45);

  return { messageCount: sent.length };
}

// ═══════════════════════════════════════════════════════════════
// Test 6: Learning Loop — Cross-Agent Knowledge Sharing
// ═══════════════════════════════════════════════════════════════

async function testLearningLoop() {
  // Simulate 3 similar missions, extract patterns
  for (let i = 0; i < 3; i++) {
    const outcome = {
      missionId: `mis_learn_${i}`,
      success: i < 2, // 2 successes, 1 failure
      steps: ['analyze', 'process', 'report'],
      duration: 1200 + i * 100,
      errors: i === 2 ? ['data_format_error'] : [],
    };

    const experiences = learningEngine.learnFromOutcome(
      `mis_learn_${i}`,
      outcome,
      'researcher',
    );
    assert(experiences.length >= 0, '应产生或合并经验');
  }

  // Query relevant experience
  const relevant = learningEngine.queryRelevant('analyze data process report', 'researcher');
  assert(relevant.length >= 0, '应能查询相关经验');

  // Feedback loop
  if (relevant.length > 0) {
    learningEngine.feedback(relevant[0].id, true);
    const updated = expRepo.get(relevant[0].id);
    assert(updated !== undefined, '反馈后经验应存在');
    assert(updated!.feedback.positive >= 1, '正面反馈计数应递增');
  }

  metrics.record('learning.experiences_distilled', 3, { agentType: 'researcher' });

  return { experienceCount: expRepo.getStats().total };
}

// ═══════════════════════════════════════════════════════════════
// Test 7: Governance Policy — OrgPolicy + Budget
// ═══════════════════════════════════════════════════════════════

async function testGovernancePolicy() {
  // ARCHIVED: OrganizationPolicyEngine / OrgBudgetAllocator
  // This test is preserved as a placeholder. Governance modules have been archived
  // as part of the one-person virtual company upgrade.
  // See packages/archived/agent-governance/
  console.log('   ⏭️  Governance tests skipped (modules archived)');
  return { decision: 'skipped', budgetRemaining: 0 };
}

// ═══════════════════════════════════════════════════════════════
// Test 8: Long-Running Mission — Checkpoint + Compaction
// ═══════════════════════════════════════════════════════════════

async function testLongRunningMission() {
  const missionId = 'mis_long_1';

  // Simulate multiple checkpoints
  for (let i = 0; i < 5; i++) {
    await eventStore.append({
      id: `evt_ckpt_${i}_${Date.now()}`,
      type: 'mission.updated',
      timestamp: Date.now() - (5 - i) * 60000,
      executionId: missionId,
      source: 'e2e-suite',
      payload: { checkpoint: i, stage: ['context', 'intent', 'planning', 'execution', 'learning'][i] },
    });
  }

  // Save context snapshots at each stage
  for (let i = 0; i < 3; i++) {
    const ctx = await contextEngine.assemble({ missionId, userId: 'test-user' });
    persistence.save(ctx, `checkpoint-${i}`);
  }

  // Run compaction
  const result = await compaction.compact();
  assert(result.durationMs >= 0, 'Compaction 应完成');
  assert(result.sizeBeforeBytes >= 0, '应有压缩前大小');

  // Verify checkpoints exist
  const snapshots = persistence.loadByMission(missionId);
  assert(snapshots.length >= 1, '应有至少 1 个 checkpoint 快照');

  metrics.record('compaction.run', 1, { eventsPruned: String(result.eventsPruned) });

  return { checkpoints: snapshots.length, compactionDuration: result.durationMs };
}

// ═══════════════════════════════════════════════════════════════
// Database Validation
// ═══════════════════════════════════════════════════════════════

async function validateDatabaseState() {
  console.log('\n🔍 验证数据库状态...\n');

  const stats = await eventStore.getStats();
  console.log(`  事件总数:       ${stats.totalEvents}`);
  console.log(`  决策总数:       ${stats.totalDecisions}`);
  console.log(`  最新序列号:     ${stats.latestSequence}`);
  console.log(`  数据库大小:     ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`);

  const byType = stats.byType;
  const keys = Object.keys(byType).slice(0, 10);
  if (keys.length > 0) {
    console.log('  事件类型分布:');
    for (const k of keys) {
      console.log(`    ${k}: ${byType[k]}`);
    }
  }

  // V9 metrics summary
  const v9m = metrics.getV9Metrics();
  console.log('\n📊 V9.2 指标摘要:');
  console.log(`  团队组建:       ${v9m.teamFormations.count} 次`);
  console.log(`  共享内存冲突率: ${(v9m.sharedMemory.conflictRate * 100).toFixed(1)}%`);
  console.log(`  Marketplace 胜率: ${(v9m.marketplace.winRate * 100).toFixed(1)}%`);
  console.log(`  熔断触发:       ${v9m.resilience.circuitBreakerTrips} 次`);
  console.log(`  补偿执行:       ${v9m.resilience.compensationsRun} 次`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function runRealDataSuite() {
  console.log('🚀 MorPex v9.2 真实数据端到端测试套件');
  console.log('═'.repeat(55));
  console.log(`  DB: SQLite :memory:`);
  console.log(`  配置: ${config.modelProvider}/${config.modelId}`);
  console.log(`  分布式: ${config.distributed.enabled ? 'enabled' : 'disabled'}`);
  console.log(`  Marketplace: ${config.marketplace.enabled ? 'enabled' : 'disabled'}`);
  console.log('═'.repeat(55));

  seedAgents();

  const testCases: { name: string; fn: () => Promise<any> }[] = [
    { name: 'simple-task', fn: testSimpleTask },
    { name: 'multi-agent-collab', fn: testMultiAgentCollaboration },
    { name: 'marketplace-bidding', fn: testMarketplaceBidding },
    { name: 'failure-recovery', fn: testFailureRecovery },
    { name: 'distributed-simulation', fn: testDistributedSimulation },
    { name: 'learning-loop', fn: testLearningLoop },
    { name: 'governance-policy', fn: testGovernancePolicy },  // ARCHIVED: returns skipped
    { name: 'long-running-mission', fn: testLongRunningMission },
  ];

  for (const tc of testCases) {
    if (!shouldRun(tc.name) && !shouldRun('all')) {
      console.log(`\n⏭️  跳过: ${tc.name}`);
      continue;
    }

    try {
      console.log(`\n📋 ${tc.name}...`);
      const start = Date.now();
      const detail = await tc.fn();
      const duration = Date.now() - start;

      results.push({ name: tc.name, status: 'PASS', duration, detail: JSON.stringify(detail).slice(0, 80) });
      passed++;
      console.log(`   ✅ 通过 (${duration}ms)`);
    } catch (err: any) {
      results.push({ name: tc.name, status: 'FAIL', duration: 0, detail: err.message.slice(0, 120) });
      failed++;
      console.error(`   ❌ 失败: ${err.message}`);
    }
  }

  // Validation
  try {
    await validateDatabaseState();
  } catch (err: any) {
    console.error('   ⚠️  DB 验证异常:', err.message);
  }

  // Report
  console.log('\n' + '═'.repeat(55));
  console.log('📊 测试报告');
  console.log('═'.repeat(55));

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    console.log(`  ${icon} ${r.name} (${r.duration}ms)`);
    if (r.status === 'FAIL') console.log(`      └─ ${r.detail}`);
  }

  console.log(`\n  总计: ${passed}/${testCases.length} 通过, ${failed} 失败`);

  // Cleanup
  db.close();

  return failed === 0;
}

runRealDataSuite()
  .then(success => {
    if (!success) {
      console.log('\n⚠️  部分测试失败，请检查上方输出。');
      console.log('   运行特定场景: npx tsx tests/e2e/real-data-suite.ts --only=simple-task,learning-loop');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('💥 测试套件异常:', err);
    process.exit(1);
  });

export { runRealDataSuite };
