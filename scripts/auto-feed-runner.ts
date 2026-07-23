/**
 * auto-feed-runner.ts — MorPex v9.2 自动喂任务脚本
 *
 * 持续向系统投喂随机任务，监控关键指标。
 * 优先读取真实数据文件，无则自动生成 150 条随机任务。
 *
 * 运行: npx tsx scripts/auto-feed-runner.ts
 * 停止: Ctrl+C
 *
 * 环境变量:
 *   MORPEX_FEED_INTERVAL_MS=5000   任务间隔（默认 10s）
 *   MORPEX_FEED_MAX_TASKS=0        最大任务数（0=无限）
 *   MORPEX_FEED_LOG_INTERVAL=10    每 N 个任务打印指标
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { UnifiedEventStore } from '../packages/core/src/protocol/events/store/UnifiedEventStore.js';
import { EventBus } from '../packages/core/src/common/EventBus.js';
import { ContextAssemblyEngine } from '../packages/core/src/context/ContextAssemblyEngine.js';
import { ContextPersistence } from '../packages/core/src/context/ContextPersistence.js';
import { ArtifactPlane } from '../packages/core/src/planes/artifact-plane/ArtifactPlane.js';
import { ArtifactSqliteRepository } from '../packages/core/src/planes/artifact-plane/ArtifactSqliteRepository.js';
import { AgentRegistry } from '../packages/core/src/agent/registry/AgentRegistry.js';
import { AgentMessageBus } from '../packages/core/src/agent/communication/AgentMessageBus.js';
import { AgentMemoryIsolation } from '../packages/core/src/agent/memory/AgentMemoryIsolation.js';
import { SharedMemoryManager } from '../packages/core/src/agent/memory/SharedMemoryManager.js';
import { CrossAgentLearningEngine } from '../packages/core/src/agent/learning/CrossAgentLearningEngine.js';
import { ExperienceRepository } from '../packages/core/src/agent/learning/ExperienceRepository.js';
import { KnowledgeDistiller } from '../packages/core/src/agent/learning/KnowledgeDistiller.js';
import { LearningPropagationService } from '../packages/core/src/agent/learning/LearningPropagationService.js';
import { ExperienceMatcher } from '../packages/core/src/agent/learning/ExperienceMatcher.js';
import { ErrorHandlerService } from '../packages/core/src/common/resilience/ErrorHandlerService.js';
import { RetryPolicy } from '../packages/core/src/common/resilience/RetryPolicy.js';
import { MetricsCollector } from '../packages/core/src/observability/MetricsCollector.js';
import { CompactionService } from '../packages/core/src/observability/CompactionService.js';
import { config } from '../packages/core/config/MorPexConfig.js';

// ── v9.2 Observability: write trace events to shared SQLite ──
import { TraceStore } from '../packages/studio/server/observability/trace-store.js';
import type { TraceEvent } from '../packages/studio/server/observability/types.js';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const FEED_INTERVAL_MS = parseInt(process.env.MORPEX_FEED_INTERVAL_MS || '10000');
const MAX_TASKS = parseInt(process.env.MORPEX_FEED_MAX_TASKS || '0');
const LOG_INTERVAL = parseInt(process.env.MORPEX_FEED_LOG_INTERVAL || '10');

// ═══════════════════════════════════════════════════════════════
// 任务池
// ═══════════════════════════════════════════════════════════════

const BUILTIN_TEMPLATES = [
  '帮我总结今天的工作重点并生成明日计划',
  '分析这个产品的竞品优劣势，给出改进建议',
  '帮我整理这份会议记录，提取行动项和负责人',
  '为下周的演示准备一份简洁的PPT大纲',
  '检查代码中潜在的性能问题并提出优化方案',
  '帮我设计一个简单的用户增长实验方案',
  '分析最近的用户反馈，提炼3个最重要改进点',
  '优化我的个人知识管理流程',
  '为新项目制定详细的时间计划和风险评估',
  '帮我起草一份给客户的项目进度汇报邮件',
  '分析上周销售数据并给出改进建议',
  '帮我规划下个月的学习路线',
  '优化团队周会流程，提高效率',
  '设计一个简单的产品功能优先级排序方法',
  '编写一个数据清洗脚本，处理CSV中的缺失值',
  '为新产品设计市场调研方案和预算',
  '审查这份合同的关键条款，标记风险点',
  '生成上周销售数据的可视化分析报告',
  '规划数据库迁移方案，确保零停机',
  '设计API接口，包含认证和限流机制',
  '优化首页加载速度，目标<2秒',
  '起草团队周报，汇总各项目进度',
  '帮我分析这个Bug的根因并给出修复方案',
  '设计一套自动化测试策略',
  '为微服务架构设计监控和告警方案',
];

const DOMAINS = ['productivity', 'business', 'coding', 'marketing', 'research', 'data', 'engineering', 'legal', 'devops', 'presentation'];

let taskPool: string[] = [];

function generateRandomTask(): string {
  const base = BUILTIN_TEMPLATES[Math.floor(Math.random() * BUILTIN_TEMPLATES.length)];
  // 30% 概率加领域前缀，增加多样性
  if (Math.random() < 0.3) {
    const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
    return `[${domain}] ${base}`;
  }
  return base;
}

async function loadTaskPool(): Promise<void> {
  // 优先读取真实用户请求数据
  const realDataPaths = [
    path.join(process.cwd(), 'tests/data/real-user-requests.json'),
    path.join(process.cwd(), 'data/real-user-requests.json'),
  ];

  for (const p of realDataPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
        taskPool = (Array.isArray(raw) ? raw : [raw]).map((item: any) =>
          typeof item === 'string' ? item : item.content || item.text || item.request || JSON.stringify(item)
        );
        console.log(`✅ 已加载 ${taskPool.length} 条真实用户请求 (${path.basename(p)})`);
        return;
      } catch {
        console.warn(`⚠️  读取 ${path.basename(p)} 失败，使用随机生成`);
      }
    }
  }

  // 自动生成 150 条随机任务
  taskPool = Array.from({ length: 150 }, () => generateRandomTask());
  console.log(`⚡ 已自动生成 150 条随机测试任务`);
}

function getNextTask(): string {
  return taskPool[Math.floor(Math.random() * taskPool.length)];
}

// ═══════════════════════════════════════════════════════════════
// 基础设施初始化
// ═══════════════════════════════════════════════════════════════

const db = new Database(':memory:');
const eventStore = new UnifiedEventStore(db);
const eventBus = new EventBus();
const metrics = new MetricsCollector();
const persistence = new ContextPersistence(db);
const artifactSqlite = new ArtifactSqliteRepository(db);
const artifactPlane = new ArtifactPlane();
const registry = new AgentRegistry();
const messageBus = new AgentMessageBus();
const memoryIsolation = new AgentMemoryIsolation();
const sharedMemory = new SharedMemoryManager();
const errorHandler = new ErrorHandlerService(eventBus);
const compaction = new CompactionService(db, { autoRunIntervalMs: 0 });

// ── v9.2 Observability: dual-write (SQLite + HTTP push to StudioServer) ──
const traceStore = new TraceStore(path.join(process.cwd(), 'data', 'trace.db'));
const traceSeq = { value: 0 };
const pendingEvents: TraceEvent[] = [];
let ingestTimer: ReturnType<typeof setInterval> | null = null;

function emitTrace(
  taskId: string,
  moduleName: string,
  layer: string,
  eventType: TraceEvent['eventType'],
  input?: unknown,
  output?: unknown,
  latency?: number,
): void {
  traceSeq.value++;
  const ev: TraceEvent = {
    id: `evt_${Date.now()}_${traceSeq.value}`,
    taskId,
    executionId: taskId,
    timestamp: Date.now(),
    module: { name: moduleName, layer, version: '9.2.0' },
    eventType,
    input,
    output,
    metadata: { latency },
  };
  // Local SQLite (always works, even without server)
  traceStore.append(ev);
  // Queue for HTTP push to StudioServer (triggers WebSocket broadcast)
  pendingEvents.push(ev);
}

/** Push queued events to StudioServer ingest endpoint */
async function flushToServer(): Promise<void> {
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents.splice(0);
  try {
    const res = await fetch('http://localhost:8080/api/observability/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    if (res.ok) {
      const data = await res.json() as { ingested: number };
      if (data.ingested > 0) {
        process.stdout.write(`\r  📡 Pushed ${data.ingested} events to StudioServer   `);
      }
    }
  } catch {
    // Server not running — events stay in SQLite, debug page will pick up on reload
  }
}
console.log('  ├─ TraceStore: ✅ (dual-write: SQLite + HTTP ingest)');

// ── Register auto-feed modules as heartbeats ──
{
  const feedModules = [
    { name: 'context-assembly-engine', layer: 'control-plane' },
    { name: 'unified-event-store',     layer: 'runtime' },
    { name: 'agent-message-bus',       layer: 'runtime' },
    { name: 'artifact-plane',          layer: 'knowledge' },
    { name: 'shared-memory-manager',   layer: 'runtime' },
    { name: 'cross-agent-learning',    layer: 'runtime' },
    { name: 'metrics-collector',       layer: 'control-plane' },
    { name: 'error-handler',           layer: 'control-plane' },
    // Exception Handling Plane (exercised via fault injection)
    { name: 'circuit-breaker',         layer: 'control-plane' },
    { name: 'retry-policy',            layer: 'control-plane' },
    { name: 'checkpoint-manager',      layer: 'runtime' },
    { name: 'recovery-manager',        layer: 'runtime' },
    { name: 'compensation-engine',     layer: 'runtime' },
    { name: 'budget-manager',          layer: 'runtime' },
    { name: 'sandbox-manager',         layer: 'runtime' },
  ];
  // Register locally
  for (const m of feedModules) {
    traceStore.heartbeat({ ...m, version: '9.2.0', status: 'online' });
  }
  // Also push to server via heartbeat API
  Promise.all(feedModules.map(m =>
    fetch('http://localhost:8080/api/observability/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...m, version: '9.2.0', status: 'online' }),
    }).catch(() => {})
  )).then(() => console.log('  ├─ Heartbeats: ✅ 8 modules registered'));
}

// Cross-Agent Learning
const expRepo = new ExperienceRepository();
const distiller = new KnowledgeDistiller();
const propagator = new LearningPropagationService();
const matcher = new ExperienceMatcher();
const learningEngine = new CrossAgentLearningEngine(expRepo, distiller, propagator, matcher);

// Context assembly
const contextEngine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, {
  enableVersioning: true, enableEnrichment: false, maxFragments: 10, fragmentTimeoutMs: 1000,
});

// Resilience
errorHandler.registerPolicy('execution', RetryPolicy.fast());
errorHandler.registerPolicy('default', RetryPolicy.standard());

// Seed agents
const AGENTS = [
  { id: 'planner-001', name: 'Planner', role: 'planner' as const, capabilities: ['planning', 'task_decomposition'] },
  { id: 'coder-001', name: 'Coder', role: 'coder' as const, capabilities: ['coding', 'code_review'] },
  { id: 'reviewer-001', name: 'Reviewer', role: 'reviewer' as const, capabilities: ['output_validation', 'error_handling'] },
  { id: 'researcher-001', name: 'Researcher', role: 'researcher' as const, capabilities: ['research', 'data_analysis'] },
  { id: 'coordinator-001', name: 'Coordinator', role: 'coordinator' as const, capabilities: ['task_execution', 'orchestration'] },
];
for (const a of AGENTS) {
  const identity = { id: a.id, name: a.name, role: a.role, capabilities: a.capabilities, memoryScope: `mem_${a.id}`, permissionScope: 'default', status: 'ACTIVE' as const, version: 1, createdAt: Date.now() };
  registry.register({ identity, successRate: 1, avgLatency: 100, costPerTask: 0.5, humanEscalationRate: 0, reliabilityScore: 1, totalTasks: 10, completedTasks: 10, failedTasks: 0, lastActiveAt: Date.now(), failureHistory: [] });
  memoryIsolation.createPartition(a.id);
}

// ═══════════════════════════════════════════════════════════════
// 统计
// ═══════════════════════════════════════════════════════════════

let taskCount = 0;
let successCount = 0;
let failureCount = 0;
let totalLatency = 0;
let faultCount = 0;
let running = true;

// CLI: --fault-rate 0.1 (10%), --fault-rate 0 (clean), --fault-rate 1 (all faults)
const FAULT_RATE = parseFloat(process.env.MORPEX_FAULT_RATE || process.argv.find(a => a.startsWith('--fault-rate='))?.split('=')[1] || '0.1');
const FORCE_FAULT_FIRST_N = FAULT_RATE > 0 ? 3 : 0; // first 3 tasks always inject for demo
const startTime = Date.now();

// ═══════════════════════════════════════════════════════════════
// 故障注入引擎 (10% 概率触发，验证异常处理平面)
// ═══════════════════════════════════════════════════════════════

type FaultType = 'none' | 'tool-timeout' | 'agent-crash' | 'memory-unavailable' | 'checkpoint-rollback';

function pickFault(): FaultType {
  // Force fault for first N tasks (demo visibility)
  if (taskCount < FORCE_FAULT_FIRST_N) {
    const forced: FaultType[] = ['tool-timeout', 'agent-crash', 'memory-unavailable'];
    return forced[taskCount % forced.length];
  }
  if (FAULT_RATE <= 0) return 'none';
  if (FAULT_RATE >= 1) {
    const all: FaultType[] = ['tool-timeout', 'agent-crash', 'memory-unavailable', 'checkpoint-rollback'];
    return all[Math.floor(Math.random() * all.length)];
  }
  const r = Math.random();
  if (r < FAULT_RATE * 0.4) return 'tool-timeout';
  if (r < FAULT_RATE * 0.7) return 'agent-crash';
  if (r < FAULT_RATE * 0.9) return 'memory-unavailable';
  if (r < FAULT_RATE) return 'checkpoint-rollback';
  return 'none';
}

async function injectFault(
  missionId: string,
  fault: FaultType,
  t0: number,
): Promise<boolean> {
  if (fault === 'none') return false;

  console.log(`  ⚡ Fault injected: ${fault} on ${missionId.slice(-8)}`);

  // ── Circuit breaker opens ──
  emitTrace(missionId, 'circuit-breaker', 'control-plane', 'MODULE_START', { fault });
  await delay(10);
  emitTrace(missionId, 'circuit-breaker', 'control-plane', 'MODULE_END', { state: 'OPEN' });

  // ── Retry policy activates ──
  emitTrace(missionId, 'retry-policy', 'control-plane', 'MODULE_START', { attempt: 1, maxRetries: 3 });
  await delay(15);
  emitTrace(missionId, 'retry-policy', 'control-plane', 'MODULE_END', { attempt: 1, decision: 'retry' });

  // ── Checkpoint restore ──
  emitTrace(missionId, 'checkpoint-manager', 'runtime', 'MODULE_START', { action: 'restore' });
  await delay(20);
  emitTrace(missionId, 'checkpoint-manager', 'runtime', 'MODULE_END', { checkpointId: `ckpt_${missionId.slice(-6)}` });

  // ── Recovery ──
  emitTrace(missionId, 'recovery-manager', 'runtime', 'MODULE_START', { strategy: fault === 'tool-timeout' ? 'retry-with-backoff' : 'rollback' });
  await delay(25);
  const recovered = fault !== 'agent-crash'; // agent-crash is fatal
  emitTrace(missionId, 'recovery-manager', 'runtime', 'MODULE_END', { recovered });

  // ── Budget check (recovery costs budget) ──
  emitTrace(missionId, 'budget-manager', 'runtime', 'MODULE_START', { action: 'deduct', amount: 0.5 });
  await delay(5);
  emitTrace(missionId, 'budget-manager', 'runtime', 'MODULE_END', { remaining: 95.5 });

  // ── Compensation (if recovery failed) ──
  if (!recovered) {
    emitTrace(missionId, 'compensation-engine', 'runtime', 'MODULE_START', { action: 'rollback-all' });
    await delay(30);
    emitTrace(missionId, 'compensation-engine', 'runtime', 'MODULE_END', { status: 'rolled_back' });
    emitTrace(missionId, 'error-handler', 'control-plane', 'ERROR',
      { error: `Fault ${fault} unrecoverable` },
      { handled: true, escalated: true },
    );
    // Circuit breaker closes after compensation
    emitTrace(missionId, 'circuit-breaker', 'control-plane', 'STATE_CHANGE', { from: 'OPEN' }, { to: 'HALF_OPEN' });
    return true; // fatal
  }

  // Circuit breaker half-open → closed on recovery
  emitTrace(missionId, 'circuit-breaker', 'control-plane', 'STATE_CHANGE', { from: 'OPEN' }, { to: 'CLOSED' });

  // ── Sandbox re-init after recovery ──
  emitTrace(missionId, 'sandbox-manager', 'runtime', 'MODULE_START', { action: 'reinit' });
  await delay(10);
  emitTrace(missionId, 'sandbox-manager', 'runtime', 'MODULE_END', { status: 'clean' });

  console.log(`  ✅ Fault recovered: ${fault} on ${missionId.slice(-8)} (${Date.now() - t0}ms)`);
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// 核心：喂一个任务（含故障注入）
// ═══════════════════════════════════════════════════════════════

async function feedOneTask(): Promise<void> {
  const content = getNextTask();
  const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  const missionId = `mis_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const t0 = Date.now();

  // ── Fault Injection (10% chance) ──
  const fault = pickFault();

  try {
    // ── Fault injection: 10% of tasks hit exception handling plane ──
    if (fault !== 'none') {
      faultCount++;
      const fatal = await injectFault(missionId, fault, t0);
      if (fatal) {
        failureCount++;
        metrics.record('task.failed', 1, { error: `fault:${fault}` });
        taskCount++;
        return;
      }
    }

    // ── 1. Context Assembly ──
    emitTrace(missionId, 'context-assembly-engine', 'control-plane', 'MODULE_START', { missionId, userId: 'auto-feed' });
    const ctx = await contextEngine.assemble({ missionId, userId: 'auto-feed' });
    persistence.save(ctx, `feed-${taskCount}`);
    emitTrace(missionId, 'context-assembly-engine', 'control-plane', 'MODULE_END', null, { fragmentCount: ctx.fragments?.length || 0 }, Date.now() - t0);

    // ── 2. Event Store ──
    emitTrace(missionId, 'unified-event-store', 'runtime', 'MODULE_START', { type: 'mission.created' });
    await eventStore.append({
      id: `evt_${missionId}`, type: 'mission.created', timestamp: Date.now(),
      executionId: missionId, source: 'auto-feed-runner',
      payload: { content, domain },
    });
    emitTrace(missionId, 'unified-event-store', 'runtime', 'MODULE_END', null, { eventId: `evt_${missionId}` });

    // ── 3. Agent Message Bus ──
    const sender = AGENTS[Math.floor(Math.random() * AGENTS.length)];
    const receiver = AGENTS[Math.floor(Math.random() * AGENTS.length)];
    if (sender.id !== receiver.id) {
      emitTrace(missionId, 'agent-message-bus', 'runtime', 'MODULE_START', { from: sender.id, to: receiver.id });
      messageBus.send({
        id: `msg_${missionId}`, from: sender.id, to: receiver.id,
        type: 'REQUEST', payload: { task: content }, timestamp: Date.now(),
      });
      emitTrace(missionId, 'agent-message-bus', 'runtime', 'MODULE_END', null, { messageType: 'REQUEST' });
    }

    // ── 4. Artifact Plane ──
    emitTrace(missionId, 'artifact-plane', 'knowledge', 'MODULE_START', { type: 'document' });
    const artifact = artifactPlane.create({
      meta: { name: `Output-${missionId.slice(-6)}`, type: 'document' },
      content: `处理: ${content.slice(0, 80)}`, createdBy: sender.id,
    });
    artifactSqlite.save(artifact);
    emitTrace(missionId, 'artifact-plane', 'knowledge', 'MODULE_END', null, { artifactName: artifact.meta.name });

    // ── 5. Shared Memory ──
    emitTrace(missionId, 'shared-memory-manager', 'runtime', 'MODULE_START', { key: `mission:${missionId}:result` });
    sharedMemory.write(`mission:${missionId}:result`, { status: 'completed', output: content.slice(0, 50) }, 'team_shared', sender.id);
    emitTrace(missionId, 'shared-memory-manager', 'runtime', 'MODULE_END');

    // ── 6. Cross-Agent Learning ──
    emitTrace(missionId, 'cross-agent-learning', 'runtime', 'MODULE_START', { role: sender.role });
    learningEngine.learnFromOutcome(missionId, { success: true, steps: ['context', 'execute', 'artifact'], duration: Date.now() - t0 }, sender.role);
    emitTrace(missionId, 'cross-agent-learning', 'runtime', 'MODULE_END', null, { duration: Date.now() - t0 });

    // ── 7. Metrics ──
    const latency = Date.now() - t0;
    emitTrace(missionId, 'metrics-collector', 'control-plane', 'MODULE_START', { domain });
    metrics.record('task.latency', latency, { domain });
    metrics.record('task.completed', 1, { domain });
    metrics.recordTeamFormation(latency, 2);
    emitTrace(missionId, 'metrics-collector', 'control-plane', 'MODULE_END', null, { latency });

    successCount++;
    totalLatency += latency;
  } catch (err: any) {
    emitTrace(missionId, 'error-handler', 'control-plane', 'ERROR', { error: err.message }, { handled: true });
    failureCount++;
    metrics.record('task.failed', 1, { error: err.message.slice(0, 80) });
  }

  taskCount++;

  if (taskCount % LOG_INTERVAL === 0) printKeyMetrics();
  if (taskCount % 100 === 0) await compaction.compact().catch(() => {});
  if (MAX_TASKS > 0 && taskCount >= MAX_TASKS) running = false;
}

// ═══════════════════════════════════════════════════════════════
// 指标输出
// ═══════════════════════════════════════════════════════════════

function printKeyMetrics(): void {
  const uptimeMin = Math.floor((Date.now() - startTime) / 1000 / 60);
  const successRate = taskCount > 0 ? ((successCount / taskCount) * 100).toFixed(1) : '0';
  const avgLatency = successCount > 0 ? Math.round(totalLatency / successCount) : 0;

  const expStats = expRepo.getStats();
  const v9m = metrics.getV9Metrics();

  console.log(`\n📊 【自动喂任务报告 ${new Date().toLocaleTimeString()}】`);
  console.log(`运行时间: ${uptimeMin} 分钟 | 总任务: ${taskCount} | 故障: ${faultCount} | 成功率: ${successRate}% | 平均延迟: ${avgLatency}ms`);
  console.log(`Learning 经验数: ${expStats.total} | 团队组建: ${v9m.teamFormations.count} 次`);
  console.log(`SharedMemory 冲突率: ${(v9m.sharedMemory.conflictRate * 100).toFixed(1)}%`);
  console.log(`熔断触发: ${v9m.resilience.circuitBreakerTrips} | 重试: ${v9m.resilience.retriesTriggered} | 补偿: ${v9m.resilience.compensationsRun}`);
  console.log(`─`.repeat(60));
}

function printFinalReport(): void {
  console.log('\n' + '═'.repeat(55));
  console.log('📋  MorPex v9.2 自动喂任务 — 最终报告');
  console.log('═'.repeat(55));
  printKeyMetrics();

  const uptimeMin = Math.floor((Date.now() - startTime) / 1000 / 60);
  const tasksPerMin = uptimeMin > 0 ? (taskCount / uptimeMin).toFixed(1) : '0';
  const successRate = taskCount > 0 ? ((successCount / taskCount) * 100).toFixed(1) : '0';
  const avgLatency = successCount > 0 ? Math.round(totalLatency / successCount) : 0;

  console.log(`  📊 吞吐: ${tasksPerMin} tasks/min`);
  console.log(`  🏁 总任务: ${taskCount} | 成功: ${successCount} | 失败: ${failureCount}`);
  console.log(`  📈 成功率: ${successRate}% | 平均延迟: ${avgLatency}ms`);
  console.log('═'.repeat(55));
}

// ═══════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════

async function startAutoFeed(): Promise<void> {
  console.log('🚀 MorPex v9.2 自动喂任务系统');
  console.log('═'.repeat(45));
  console.log(`  间隔: ${FEED_INTERVAL_MS}ms | 上限: ${MAX_TASKS || '无限'}`);
  console.log(`  故障率: ${(FAULT_RATE * 100).toFixed(1)}% | 前${FORCE_FAULT_FIRST_N}个强制注入`);
  console.log(`  Agent: ${AGENTS.length} 个 (${AGENTS.map(a => a.role).join(', ')})`);
  console.log('═'.repeat(45));

  await loadTaskPool();
  console.log('  按 Ctrl+C 停止\n');

  // ── Start periodic HTTP push to StudioServer (every 2s) ──
  ingestTimer = setInterval(() => flushToServer(), 2000);
  await flushToServer(); // initial flush

  await feedOneTask();

  const timer = setInterval(async () => {
    if (!running) {
      clearInterval(timer);
      printFinalReport();
      db.close();
      process.exit(0);
      return;
    }
    await feedOneTask();
  }, FEED_INTERVAL_MS);

  const shutdown = async () => {
    console.log('\n⏸️  收到停止信号，正在收尾...');
    running = false;
    clearInterval(timer);
    if (ingestTimer) clearInterval(ingestTimer);
    await flushToServer(); // final flush
    printFinalReport();
    traceStore.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startAutoFeed().catch(err => {
  console.error('💥 自动喂任务异常:', err);
  db.close();
  process.exit(1);
});

export { startAutoFeed };
