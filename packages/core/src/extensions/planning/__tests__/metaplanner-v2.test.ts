// @ts-nocheck
/**
 * MetaPlanner v2 — 集成测试与使用示例
 *
 * 验证 v2 升级的完整流程：
 *   1. 插件注册机制
 *   2. onPrePlan / onPostPlan / onRuntimeEvent 生命周期
 *   3. v1 能力保留（V1CapabilityAdapter）
 *   4. StrategicDeconstructor 里程碑拆解
 *   5. LookAheadSimulator 风险模拟
 *   6. DynamicReflexEngine 运行时反射
 *   7. DeviationGuard 熔断防护
 *   8. JSONL Trace 日志
 *
 * 运行方式：
 *   npx vitest run __tests__/metaplanner-v2.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { MetaPlanner } from '../MetaPlanner.js';
import { V1CapabilityAdapter } from '../engines/V1CapabilityAdapter.js';
import { StrategicDeconstructor } from '../engines/StrategicDeconstructor.js';
import { LookAheadSimulator } from '../engines/LookAheadSimulator.js';
import { DynamicReflexEngine } from '../engines/DynamicReflexEngine.js';
import { DeviationGuard } from '../guards/DeviationGuard.js';
import { RuntimeController } from '../RuntimeController.js';
import type {
  IPlanningExtension,
  PrePlanContext,
  PrePlanResult,
  PostPlanContext,
  PostPlanResult,
  Milestone,
  DAGPatch,
  DAGPatchOperation,
  RuntimeEventContext,
  DeviationEvent,
  MemoryBusLogEntry,
} from '../PlanTypes.js';
import type { ExecutionDAG } from '../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { SessionContext } from '../../../workflow/types.js';

// ── 辅助：创建已初始化的 MetaPlanner（用于需要 store 的集成测试） ──

let _tmpDirCounter = 0;

async function createInitializedMetaPlanner(configOverrides?: any): Promise<MetaPlanner> {
  const tmpDir = path.join(os.tmpdir(), `morpex-test-metaplanner-${Date.now()}-${_tmpDirCounter++}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const mp = new MetaPlanner({
    enabled: true,
    experienceStorePath: tmpDir + '/experiences/',
    templateStorePath: tmpDir + '/templates/',
    ...configOverrides,
    v2: {
      enableStrategicDeconstructor: configOverrides?.v2?.enableStrategicDeconstructor ?? false,
      enableLookAheadSimulator: configOverrides?.v2?.enableLookAheadSimulator ?? false,
      enableDynamicReflexEngine: configOverrides?.v2?.enableDynamicReflexEngine ?? false,
      maxDeviationCount: configOverrides?.v2?.maxDeviationCount ?? 3,
      simulationRejectionThreshold: configOverrides?.v2?.simulationRejectionThreshold ?? 0.7,
      traceLogPath: tmpDir + '/traces/',
    },
    knowledgeGraph: configOverrides?.knowledgeGraph,
    artifactRegistry: configOverrides?.artifactRegistry,
    vectorStore: configOverrides?.vectorStore,
    memoryBus: configOverrides?.memoryBus,
    dagEngine: configOverrides?.dagEngine,
  });

  await mp.store.initialize();
  return mp;
}

// ═══════════════════════════════════════════════════════════════
// 测试辅助：Mock 实现
// ═══════════════════════════════════════════════════════════════

function createMockExecutionDAG(overrides: Partial<ExecutionDAG> = {}): ExecutionDAG {
  return {
    nodes: [
      { taskId: 'node_1', domain: 'ai_ml', name: '数据采集', deps: [], priority: 10, agentType: 'data_collector', description: '采集训练数据', requires: [] },
      { taskId: 'node_2', domain: 'ai_ml', name: '模型训练', deps: ['node_1'], priority: 9, agentType: 'model_trainer', description: '训练模型', requires: ['data_collector'] },
      { taskId: 'node_3', domain: 'devops', name: '部署', deps: ['node_2'], priority: 8, agentType: 'deployer', description: '部署到生产环境', requires: ['model_trainer'] },
    ],
    isMultiDomain: true,
    involvedDomains: ['ai_ml', 'devops'],
    domainDependencies: [{ domain: 'devops', dependsOn: ['ai_ml'] }],
    globalIntent: '构建 AI 推荐系统并部署',
    reasoning: '先采集数据、训练模型，然后部署',
    ...overrides,
  };
}

function createMockSessionContext(): SessionContext {
  return {
    sessionId: 'test_session_001',
    executionId: 'test_exec_001',
    input: '构建 AI 推荐系统',
    artifacts: {},
    memory: [],
  };
}

/** 模拟 EventBus */
class MockEventBus {
  events: any[] = [];
  listeners = new Map<string, Set<Function>>();
  emit(event: any) { this.events.push(event); const handlers = this.listeners.get(event.type); if (handlers) for (const h of handlers) h(event); }
  on(type: string, handler: Function) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(handler); return () => this.listeners.get(type)?.delete(handler); }
  once() {}
  off() {}
  getHistory() { return this.events; }
  clear() { this.events = []; }
}

/** 模拟 DAGEngine */
class MockDAGEngine {
  private nodes = new Map<string, any>();
  addNode(n: any) { this.nodes.set(n.id, n); return true; }
  getNode(id: string) { return this.nodes.get(id); }
  removeNode(id: string) { return this.nodes.delete(id); }
  insertAfter(afterId: string, n: any) { return this.addNode(n); }
  rerouteNode(id: string, alt?: string) { return true; }
  getAllNodes() { return [...this.nodes.values()]; }
  getReadyNodes() { return [...this.nodes.values()].filter((n: any) => n.status === 'pending'); }
  clear() { this.nodes.clear(); }
}

/** 模拟 MemoryBus */
class MockMemoryBus {
  private handlers = new Map<string, Set<Function>>();
  private logEntries: MemoryBusLogEntry[] = [];
  on(event: string, handler: Function) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event)!.add(handler); return () => this.handlers.get(event)?.delete(handler); }
  emit(rawEvent: any) { const hs = this.handlers.get(rawEvent.type); if (hs) for (const h of hs) h(rawEvent); }
  async appendLog(entry: MemoryBusLogEntry) { this.logEntries.push(entry); }
  getLogEntries() { return this.logEntries; }
  clear() { this.handlers.clear(); this.logEntries = []; }
}

/** 模拟 KnowledgeGraph */
class MockKnowledgeGraph {
  searchEntities(query: any) { return [{ id: 'kg_1', type: 'agent', name: 'ML Pipeline', domainId: 'ai_ml', tags: ['ai_ml'], timestamp: Date.now() }]; }
  getNeighborhood(id: string, depth?: number) { return { entities: [], relations: [] }; }
  findPath(f: string, t: string) { return null; }
}

/** 模拟 ArtifactRegistry */
class MockArtifactRegistry {
  listByDomain(domain: string) { return [{ id: 'art_1', type: 'model', name: 'Recommendation Model v1', domain: 'ai_ml' }]; }
}

/** 模拟 VectorStore */
class MockVectorStore {
  async search(text: string, topK: number) { return ['rec_1', 'rec_2']; }
}

// ═══════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════

describe('MetaPlanner v2 升级测试', () => {

  // ── 1. 插件注册机制 ──

  describe('插件注册机制', () => {
    it('应该自动注册 v1 适配器', () => {
      const mp = new MetaPlanner({ enabled: true });

      const extensions = mp.getExtensions();
      expect(extensions.length).toBeGreaterThanOrEqual(1);
      expect(extensions.some(e => e.name === 'V1CapabilityAdapter')).toBe(true);
    });

    it('应该支持 registerExtension 自定义扩展', () => {
      const mp = new MetaPlanner({ enabled: true });

      const customExt: IPlanningExtension = {
        name: 'CustomAnalyzer',
        version: '1.0.0',
        enabled: true,
        priority: 15,
        async onPrePlan(ctx: PrePlanContext) {
          return { enrichedContext: ['[CustomAnalyzer] 自定义分析'] };
        },
      };

      mp.registerExtension(customExt);
      expect(mp.getExtension('CustomAnalyzer')).toBeDefined();
    });

    it('应该支持 unregisterExtension 移除扩展', () => {
      const mp = new MetaPlanner({ enabled: true });

      const customExt: IPlanningExtension = {
        name: 'TempExt',
        version: '1.0.0',
        enabled: true,
      };

      mp.registerExtension(customExt);
      expect(mp.getExtension('TempExt')).toBeDefined();

      mp.unregisterExtension('TempExt');
      expect(mp.getExtension('TempExt')).toBeUndefined();
    });

    it('应该按优先级排序扩展', () => {
      const mp = new MetaPlanner({ enabled: true });

      mp.registerExtension({ name: 'HighPriority', version: '1.0', enabled: true, priority: 5 });
      mp.registerExtension({ name: 'LowPriority', version: '1.0', enabled: true, priority: 50 });
      mp.registerExtension({ name: 'MidPriority', version: '1.0', enabled: true, priority: 20 });

      const names = mp.getExtensions().map(e => e.name);
      const order = ['V1CapabilityAdapter', 'HighPriority', 'MidPriority', 'LowPriority'];
      // V1CapabilityAdapter has priority 0, then custom extensions
      const filtered = names.filter(n => order.includes(n));
      expect(filtered).toEqual(['V1CapabilityAdapter', 'HighPriority', 'MidPriority', 'LowPriority']);
    });
  });

  // ── 2. v1 能力保留 ──

  describe('v1 能力保留', () => {
    it('V1CapabilityAdapter 应提取标签', async () => {
      const adapter = new V1CapabilityAdapter({ enabled: true });
      const ctx: PrePlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: 'Build an AI recommendation system with machine learning and deploy to AWS using Docker',
        tags: [],
      };

      const result = await adapter.onPrePlan(ctx);
      expect(result.enrichedContext).toBeDefined();
      const lines = result.enrichedContext as string[];
      const tagLine = lines.find(l => l.startsWith('[V1CapabilityAdapter] tags:'));
      expect(tagLine).toContain('ai_ml');
      expect(tagLine).toContain('devops');
      expect(tagLine).toContain('build');
    });

    it('V1CapabilityAdapter 应进行模板匹配', async () => {
      const adapter = new V1CapabilityAdapter({ enabled: true });
      const ctx: PrePlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: '构建微服务架构',
        tags: ['web_dev', 'build', 'design'],
      };

      const result = await adapter.onPrePlan(ctx);
      expect(result.enrichedContext).toBeDefined();
    });
  });

  // ── 3. 战略拆解器 ──

  describe('StrategicDeconstructor', () => {
    it('应使用 KnowledgeGraph 生成里程碑', async () => {
      const kg = new MockKnowledgeGraph();
      const registry = new MockArtifactRegistry();
      const sd = new StrategicDeconstructor({ knowledgeGraph: kg, artifactRegistry: registry, enabled: true });

      const ctx: PrePlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: '构建 AI 推荐系统',
        tags: ['ai_ml', 'devops', 'build'],
      };

      const result = await sd.onPrePlan(ctx);
      expect(result.milestones).toBeDefined();
      expect(result.milestones!.length).toBeGreaterThan(0);

      const ms = result.milestones!;
      expect(ms[0]).toHaveProperty('id');
      expect(ms[0]).toHaveProperty('name');
      expect(ms[0]).toHaveProperty('domain');
      expect(ms[0]).toHaveProperty('priority');
      expect(ms[0]).toHaveProperty('dependsOn');
      expect(ms[0]).toHaveProperty('expectedArtifacts');
    });

    it('KnowledgeGraph 不可用时应优雅降级', async () => {
      const sd = new StrategicDeconstructor({ enabled: true });
      const ctx: PrePlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: '测试输入',
        tags: ['web_dev', 'build'],
      };

      const result = await sd.onPrePlan(ctx);
      // 应该通过标签推断出兜底里程碑
      expect(result.milestones).toBeDefined();
      expect(result.milestones!.length).toBeGreaterThan(0);
    });

    it('禁用时不应执行', async () => {
      const sd = new StrategicDeconstructor({ enabled: false });
      const ctx: PrePlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: '测试',
        tags: [],
      };

      const result = await sd.onPrePlan(ctx);
      expect(result.milestones).toBeUndefined();
      expect(result.enrichedContext).toBeUndefined();
    });
  });

  // ── 4. 前瞻模拟器 ──

  describe('LookAheadSimulator', () => {
    it('应检测环形依赖', async () => {
      const sim = new LookAheadSimulator({ enabled: true });
      const dag = createMockExecutionDAG({
        // 构造循环依赖：node_2 依赖 node_3，node_3 依赖 node_2
        nodes: [
          { taskId: 'a', domain: 'test', name: 'A', deps: ['b'], priority: 10, agentType: 't', description: '' },
          { taskId: 'b', domain: 'test', name: 'B', deps: ['a'], priority: 9, agentType: 't', description: '' },
        ],
        isMultiDomain: false,
        involvedDomains: ['test'],
        globalIntent: 'test',
      });

      const ctx: PostPlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: 'test',
        tags: ['test'],
        dag,
      };

      const result = await sim.onPostPlan(ctx);
      expect(result.simulationReport).toBeDefined();

      const report = result.simulationReport!;
      expect(report.deadlockWarnings.length).toBeGreaterThan(0);
      // deadlockFactor contributes 0.7 * 0.50 = 0.35 min; >0.3 confirms cycle detection feeds risk
      expect(report.overallRiskScore).toBeGreaterThan(0.3);
    });

    it('高风险应触发拒绝', async () => {
      const sim = new LookAheadSimulator({ enabled: true, riskThreshold: 0.1 }); // 极低阈值
      const dag = createMockExecutionDAG({
        nodes: [
          { taskId: 'x', domain: 'security', name: 'X', deps: ['y'], priority: 10, agentType: 't', description: '' },
          { taskId: 'y', domain: 'security', name: 'Y', deps: ['x'], priority: 9, agentType: 't', description: '' },
        ],
        isMultiDomain: false,
        involvedDomains: ['security'],
        globalIntent: 'test',
      });

      const ctx: PostPlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: 'test',
        tags: ['security'],
        dag,
      };

      const result = await sim.onPostPlan(ctx);
      expect(result.rejected).toBe(true);
      expect(result.rejectionReasons).toBeDefined();
      expect(result.rejectionReasons!.length).toBeGreaterThan(0);
    });

    it('低风险不应触发拒绝', async () => {
      const sim = new LookAheadSimulator({ enabled: true, riskThreshold: 0.9 });
      const dag = createMockExecutionDAG({
        nodes: [
          { taskId: 'a1', domain: 'web_dev', name: 'A1', deps: [], priority: 10, agentType: 't', description: '' },
          { taskId: 'a2', domain: 'web_dev', name: 'A2', deps: ['a1'], priority: 9, agentType: 't', description: '' },
        ],
        isMultiDomain: false,
        involvedDomains: ['web_dev'],
        globalIntent: 'test',
      });

      const ctx: PostPlanContext = {
        sessionId: 's1',
        executionId: 'e1',
        userInput: 'test',
        tags: ['web_dev'],
        dag,
      };

      const result = await sim.onPostPlan(ctx);
      expect(result.rejected).toBeFalsy();
    });
  });

  // ── 5. 动态反射引擎 ──

  describe('DynamicReflexEngine', () => {
    it('应处理 STATE_DEVIATION 事件并生成 patch', async () => {
      const guard = new DeviationGuard({ maxDeviationsPerSession: 3 });
      const dre = new DynamicReflexEngine({ guard, enabled: true });

      const controller = new RuntimeController(new MockDAGEngine(), 's1');

      const ctx: RuntimeEventContext = {
        sessionId: 's1',
        executionId: 'e1',
        event: {
          type: 'STATE_DEVIATION',
          sessionId: 's1',
          executionId: 'e1',
          timestamp: Date.now(),
          payload: { failedNodeId: 'node_2', reason: '输出偏离预期' },
        },
      };

      const result = await dre.onRuntimeEvent(ctx, controller);
      expect(result.handled).toBe(true);
      expect(result.action).toBe('patched');
      expect(result.patch).toBeDefined();
    });

    it('严重度低的事件应忽略', async () => {
      const guard = new DeviationGuard({ maxDeviationsPerSession: 3 });
      const dre = new DynamicReflexEngine({ guard, enabled: true });

      const controller = new RuntimeController(new MockDAGEngine(), 's1');

      const ctx: RuntimeEventContext = {
        sessionId: 's1',
        executionId: 'e1',
        event: {
          type: 'ARTIFACT_MISSING',
          sessionId: 's1',
          executionId: 'e1',
          timestamp: Date.now(),
          payload: { artifactType: 'minor_report' },
        },
      };

      const result = await dre.onRuntimeEvent(ctx, controller);
      expect(result.action).not.toBe('patched');
    });
  });

  // ── 6. 偏差守卫 ──

  describe('DeviationGuard 熔断防护', () => {
    let guard: DeviationGuard;

    beforeEach(() => {
      guard = new DeviationGuard({ maxDeviationsPerSession: 3 });
    });

    it('初始应允许重规划', () => {
      expect(guard.isAllowed('session_1')).toBe(true);
    });

    it('未达到阈值应允许', () => {
      guard.recordDeviation({
        sessionId: 'session_1',
        eventId: 'evt_1',
        type: 'STATE_DEVIATION',
        description: '第一次偏差',
        timestamp: Date.now(),
      });
      guard.recordDeviation({
        sessionId: 'session_1',
        eventId: 'evt_2',
        type: 'STATE_DEVIATION',
        description: '第二次偏差',
        timestamp: Date.now(),
      });

      expect(guard.isAllowed('session_1')).toBe(true);
      expect(guard.getDeviationCount('session_1')).toBe(2);
    });

    it('达到阈值应触发熔断', () => {
      for (let i = 0; i < 3; i++) {
        guard.recordDeviation({
          sessionId: 'session_2',
          eventId: `evt_${i}`,
          type: 'STATE_DEVIATION',
          description: `偏差 ${i + 1}`,
          timestamp: Date.now(),
        });
      }

      expect(guard.getDeviationCount('session_2')).toBe(3);
      expect(guard.isAllowed('session_2')).toBe(false); // 熔断
      expect(guard.isCircuitBroken('session_2')).toBe(true);
    });

    it('reset 应重置偏差计数', () => {
      guard.recordDeviation({
        sessionId: 'session_3',
        eventId: 'evt_1',
        type: 'SELF_HEALING_FAILED',
        description: '偏差',
        timestamp: Date.now(),
      });

      expect(guard.getDeviationCount('session_3')).toBe(1);
      guard.reset('session_3');
      expect(guard.getDeviationCount('session_3')).toBe(0);
      expect(guard.isCircuitBroken('session_3')).toBe(false);
    });

    it('不同 session 的偏差计数应隔离', () => {
      guard.recordDeviation({
        sessionId: 'session_a',
        eventId: 'e1',
        type: 'STATE_DEVIATION',
        description: 'a 的偏差',
        timestamp: Date.now(),
      });

      expect(guard.getDeviationCount('session_a')).toBe(1);
      expect(guard.getDeviationCount('session_b')).toBe(0);
    });
  });

  // ── 7. RuntimeController ──

  describe('RuntimeController', () => {
    it('应支持 pause / resume', () => {
      const engine = new MockDAGEngine();
      const controller = new RuntimeController(engine, 's1');

      expect(controller.isPaused).toBe(false);
      controller.pause();
      expect(controller.isPaused).toBe(true);
      controller.resume();
      expect(controller.isPaused).toBe(false);
    });

    it('应返回 DAG 状态', () => {
      const engine = new MockDAGEngine();
      engine.addNode({ id: 'n1', name: 'Node 1', status: 'success', deps: [], priority: 10, agentType: 't', description: '', retryCount: 0, maxRetries: 3 });
      engine.addNode({ id: 'n2', name: 'Node 2', status: 'pending', deps: ['n1'], priority: 9, agentType: 't', description: '', retryCount: 0, maxRetries: 3 });

      const controller = new RuntimeController(engine, 's1');
      const status = controller.getDAGStatus();

      expect(status.nodeCount).toBe(2);
      expect(status.completedCount).toBe(1);
      expect(status.pendingCount).toBe(1);
    });
  });

  // ── 8. wrapOrchestrate 集成测试 ──

  describe('wrapOrchestrate 集成', () => {
    it('签名应向下兼容 - 不传 sessionCtx 也应工作', async () => {
      const mp = await createInitializedMetaPlanner();

      // 模拟原始 orchestrate
      const mockOrchestrate = async (userInput: string, sessionCtx?: SessionContext) => {
        return {
          dag: createMockExecutionDAG(),
          result: { success: true, results: [], totalTokensUsed: 500 },
        };
      };

      const smartOrchestrate = mp.wrapOrchestrate(mockOrchestrate);

      // 不传 sessionCtx（v1 兼容）
      const { dag, result } = await smartOrchestrate('构建一个推荐系统');

      expect(dag).toBeDefined();
      expect(dag.nodes.length).toBeGreaterThan(0);
      expect(result.success).toBe(true);
    });

    it('应正确传递 sessionCtx', async () => {
      const mp = await createInitializedMetaPlanner();

      const mockOrchestrate = async (userInput: string, sessionCtx?: SessionContext) => {
        // 验证 sessionCtx 被正确增强
        expect(sessionCtx).toBeDefined();
        return {
          dag: createMockExecutionDAG(),
          result: { success: true, results: [] },
        };
      };

      const smartOrchestrate = mp.wrapOrchestrate(mockOrchestrate);
      const sessionCtx = createMockSessionContext();

      await smartOrchestrate('test', sessionCtx);
    });

    it('禁用时不应执行扩展逻辑', async () => {
      const mp = new MetaPlanner({ enabled: false });

      let originalCalled = false;
      const mockOrchestrate = async () => {
        originalCalled = true;
        return { dag: createMockExecutionDAG(), result: { success: true } };
      };

      const smartOrchestrate = mp.wrapOrchestrate(mockOrchestrate);
      await smartOrchestrate('test');

      expect(originalCalled).toBe(true);
    });
  });

  // ── 9. 全流程 v2 特性测试 ──

  describe('v2 全流程', () => {
    it('三大引擎启用时应完整流水线', async () => {
      const kg = new MockKnowledgeGraph();
      const registry = new MockArtifactRegistry();
      const vs = new MockVectorStore();
      const mb = new MockMemoryBus();
      const de = new MockDAGEngine();

      const mp = await createInitializedMetaPlanner({
        v2: {
          enableStrategicDeconstructor: true,
          enableLookAheadSimulator: true,
          enableDynamicReflexEngine: true,
          maxDeviationCount: 3,
          simulationRejectionThreshold: 0.8,
        },
        knowledgeGraph: kg,
        artifactRegistry: registry,
        vectorStore: vs,
        memoryBus: mb,
        dagEngine: de,
      });

      const extensions = mp.getExtensions();
      expect(extensions.some(e => e.name === 'V1CapabilityAdapter')).toBe(true);
      expect(extensions.some(e => e.name === 'StrategicDeconstructor')).toBe(true);
      expect(extensions.some(e => e.name === 'LookAheadSimulator')).toBe(true);
      expect(extensions.some(e => e.name === 'DynamicReflexEngine')).toBe(true);

      const mockOrchestrate = async (userInput: string, sessionCtx?: SessionContext) => ({
        dag: createMockExecutionDAG(),
        result: { success: true, results: [], totalTokensUsed: 300 },
      });

      const smartOrchestrate = mp.wrapOrchestrate(mockOrchestrate);
      const { dag, result } = await smartOrchestrate('构建 AI 推荐系统部署到 AWS');

      expect(dag).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('自定义扩展应介入全流程', async () => {
      const mp = await createInitializedMetaPlanner();

      const trace: string[] = [];

      mp.registerExtension({
        name: 'TraceExt',
        version: '1.0',
        enabled: true,
        priority: 100,
        async onPrePlan(ctx: PrePlanContext) {
          trace.push(`pre:${ctx.userInput.slice(0, 10)}`);
          return { enrichedContext: ['[TraceExt] pre'] };
        },
        async onPostPlan(ctx: PostPlanContext) {
          trace.push(`post:${ctx.dag.nodes.length} nodes`);
          return {};
        },
      });

      const mockOrchestrate = async (userInput: string) => ({
        dag: createMockExecutionDAG(),
        result: { success: true, results: [] },
      });

      const smartOrchestrate = mp.wrapOrchestrate(mockOrchestrate);
      await smartOrchestrate('Hello World Test');

      expect(trace).toContain('pre:Hello Worl');
      // Note: 7-stage pipeline generates its own DAG via fallback templates
      // The actual node count depends on the MCDA winner selection
      expect(trace.some(t => t.startsWith('post:') && /nodes/.test(t))).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 快速使用示例（可独立运行）
// ═══════════════════════════════════════════════════════════════

/**
 * 使用示例：升级后的 MetaPlanner v2
 *
 * ```typescript
 * import { MetaPlanner } from './planning/index.js';
 *
 * // 1. 创建 MetaPlanner v2（注入外部依赖）
 * const metaPlanner = new MetaPlanner(
 *   { enabled: true },
 *   {
 *     enableStrategicDeconstructor: true,
 *     enableLookAheadSimulator: true,
 *     enableDynamicReflexEngine: true,
 *     maxDeviationCount: 3,
 *     simulationRejectionThreshold: 0.7,
 *   },
 *   {
 *     knowledgeGraph,
 *     artifactRegistry,
 *     vectorStore,
 *     memoryBus,
 *     dagEngine,
 *   },
 * );
 *
 * // 2. 注册自定义扩展（可选）
 * metaPlanner.registerExtension({
 *   name: 'CustomSecurityScanner',
 *   version: '1.0.0',
 *   enabled: true,
 *   priority: 25,
 *   async onPostPlan(context) {
 *     // 检查 DAG 中是否有安全敏感的节点
 *     return {};
 *   },
 * });
 *
 * // 3. 包装 ExecutionOrchestrator（签名完全向下兼容）
 * const smartOrchestrate = metaPlanner.wrapOrchestrate(
 *   orchestrator.orchestrate.bind(orchestrator),
 * );
 *
 * // 4. 执行（自动触发全生命周期管道）
 * const { dag, result } = await smartOrchestrate(
 *   '设计一个 AI 驱动的电商推荐系统并部署到 AWS',
 *   sessionCtx,
 * );
 *
 * // 5. 查询扩展状态
 * const status = metaPlanner.getExtensionStatus();
 * console.log(status);
 *
 * // 6. 查询偏差守卫统计
 * const guardStats = metaPlanner.getDeviationGuardStats();
 * console.log(guardStats);
 * ```
 */
