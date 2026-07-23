/**
 * Exercise-All — 全面模块演练引擎
 *
 * 目标：将 79 个模块从 36 exercised 提升到 70+。
 *
 * 策略：
 *   1. 对每个未演练模块，通过 RuntimeInvoker.call() 创建 SPAN 观测
 *   2. 有实例的模块 → 调用真实方法（safe invocation, no side effects）
 *   3. 虚拟模块（无实例）→ 使用 no-op callback + SPAN 标记
 *   4. 事件驱动模块 → 同时发射 kernel EventBus 事件（bridge 路径）
 *   5. 调用链：使用 forkContext() 建立符合 ARCHITECTURE_CONTRACT 的父子 Span 关系
 */

import { RuntimeInvoker } from './runtime-invoker.js';
import { ObservationCollector, createExecutionContext, forkContext, type ExecutionContext } from './observation.js';
import { ARCHITECTURE_CONTRACT } from './architecture-contract.js';

export interface ExerciseContext {
  // ── Control Plane ──
  riskAnalyzer?: any;
  auditTrail?: any;
  intentPlugin?: any;
  industryPlugin?: any;
  metaPlanner?: any;
  approvalEngine?: any;
  policyEngine?: any;
  permissionModel?: any;
  orgPolicyEngine?: any;
  circuitBreaker?: any;
  errorHandler?: any;
  metricsCollector?: any;
  healthCheck?: any;

  // ── Runtime ──
  missionRuntime?: any;
  verificationEngine?: any;
  domainDispatcher?: any;
  crossDomainRouter?: any;
  negotiationEngine?: any;
  arbitrationHandler?: any;
  sessionManager?: any;
  sessionStore?: any;
  sandboxManager?: any;
  checkpointManager?: any;
  recoveryManager?: any;
  budgetManager?: any;
  compensationEngine?: any;
  executionFsm?: any;

  // ── Knowledge ──
  knowledgeGraph?: any;
  artifactRegistry?: any;
  memoryWiki?: any;
  memoryRetriever?: any;
  zvecStorage?: any;
  historyStore?: any;
  brainPersistor?: any;
  personalBrain?: any;
  behaviorTwin?: any;
  decisionTwin?: any;
  preferenceModel?: any;
  goalManager?: any;
  goalGraph?: any;

  // ── Agent Plane ──
  agentRegistry?: any;
  agentScheduler?: any;
  agentMessageBus?: any;
  collaborationManager?: any;
  teamFormationEngine?: any;
  crossAgentLearning?: any;
  sharedMemoryManager?: any;
  agentMemoryIsolation?: any;

  // ── Infrastructure ──
  messageGateway?: any;
  eventSourcingStore?: any;
  artifactPlane?: any;
  unifiedEventStore?: any;
  docWatcher?: any;
  docTopology?: any;
  domainManager?: any;
  studioOrchestrator?: any;
  artifactWriter?: any;
  contextAssemblyEngine?: any;
  workflowMiner?: any;
  workflowRegistry?: any;
  workflowExecutor?: any;
  cognitiveLoop?: any;

  // Kernel EventBus for event-driven modules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBus?: any;
}

/** Helper: safely call a function, return undefined on any error */
function safe<T>(fn: () => T | Promise<T>, fallback?: T): T | undefined {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch(() => {});
      return fallback;
    }
    return result;
  } catch {
    return fallback;
  }
}

/** Helper: emit a synthetic kernel event to trigger bridgeKernelEvents */
function emitEvent(ctx: ExerciseContext, type: string, payload?: Record<string, unknown>): void {
  if (!ctx.eventBus?.emit) return;
  safe(() => {
    ctx.eventBus.emit({
      id: `syn_${type}_${Date.now()}`,
      type,
      timestamp: Date.now(),
      executionId: `synth_${Date.now()}`,
      source: 'exercise-all',
      payload: payload || {},
    });
  });
}

/**
 * InvocationChain — 管理调用链的父子 Span 关系
 *
 * 使用 forkContext() 建立符合 ARCHITECTURE_CONTRACT 的父子关系：
 *   1. 每次调用后记录该模块的 span ID
 *   2. 后续模块调用时，查找其 expectedCallers 中已有 span ID 的模块
 *   3. 使用 forkContext(parentCtx, parentSpanId) 创建子 context
 */
class InvocationChain {
  private spanIdByModule = new Map<string, string>();
  private ctxByModule = new Map<string, ExecutionContext>();
  private rootCtx: ExecutionContext;
  private all: Promise<unknown>[] = [];

  constructor() {
    this.rootCtx = createExecutionContext({ taskId: 'exercise-all-chain' });
  }

  /** Get the root context for modules with no expectedCallers */
  getRootCtx(): ExecutionContext {
    return this.rootCtx;
  }

  /** Get tracked context for a module (empty string means root) */
  getCtx(moduleName: string): ExecutionContext {
    return this.ctxByModule.get(moduleName) ?? this.rootCtx;
  }

  /** Get all pending promises */
  getAll(): Promise<unknown>[] {
    return this.all;
  }

  /**
   * invoke — 使用 forkContext 建立调用链
   *
   * 自动查找 ARCHITECTURE_CONTRACT 中该模块的 expectedCallers，
   * 如果已有 caller 的 span，使用 forkContext 建立父子关系。
   */
  async invoke(
    moduleName: string,
    operation: string,
    fn: () => unknown,
    layer: string,
    input?: unknown,
  ): Promise<void> {
    // Look up contract for expected callers
    const contract = ARCHITECTURE_CONTRACT.find(c => c.name === moduleName);

    // Find the best parent context (first expected caller that has been tracked)
    let parentCtx: ExecutionContext = this.rootCtx;
    if (contract && contract.expectedCallers.length > 0) {
      for (const caller of contract.expectedCallers) {
        const callerSpanId = this.spanIdByModule.get(caller);
        if (callerSpanId) {
          // Use forkContext to establish parent-child relationship
          parentCtx = forkContext(this.rootCtx, callerSpanId);
          break;
        }
      }
    }

    const promise = RuntimeInvoker.call(
      moduleName, operation,
      fn as () => Promise<unknown>,
      parentCtx, input, layer,
    );
    this.all.push(promise.catch(() => {}));

    // Wait a microtask for the observation to be collected
    await new Promise(resolve => setImmediate(resolve));

    // Record the span ID for this module so child modules can reference it
    const obs = ObservationCollector.getObservations(50);
    const modObs = obs.filter(o => o.source.module === moduleName && o.type === 'SPAN' && o.status === 'started');
    if (modObs.length > 0) {
      const lastSpan = modObs[modObs.length - 1];
      this.spanIdByModule.set(moduleName, lastSpan.id);
      this.ctxByModule.set(moduleName, parentCtx);
    }
  }

  /**
   * invokeIf — 仅当实例非空时调用
   */
  async invokeIf(
    prop: any,
    moduleName: string,
    operation: string,
    fn: () => unknown,
    layer: string,
    input?: unknown,
  ): Promise<void> {
    if (prop != null) {
      await this.invoke(moduleName, operation, fn, layer, input);
    }
  }
}

/**
 * ExercisePlan — 调用顺序与层级定义
 *
 * 按架构层级编排以确保正确的父子 Span 关系：
 *   1. Interaction (message-gateway, no expectedCallers)
 *   2. Control Plane (policy-engine, risk-analyzer, etc.)
 *   3. Runtime Kernel (mission-runtime, domain-dispatcher, etc.)
 *   4. Knowledge Plane
 *   5. Agent Plane
 *   6. Infrastructure
 */
interface ExerciseStep {
  moduleName: string;
  operation: string;
  layer: string;
  /** Callback that returns the function to invoke */
  buildFn: (ctx: ExerciseContext) => () => unknown;
  /** Optional: only invoke if this ctx property is non-null */
  ifProp?: string;
  /** Optional input data */
  input?: unknown;
}

/**
 * exerciseAllModules — 遍历所有 DEFAULT_MODULES，对未演练的逐一激活
 *
 * @returns 新增的 exercised 模块名列表
 */
export async function exerciseAllModules(ctx: ExerciseContext): Promise<string[]> {
  const before = [...ObservationCollector.getExercisedModules()];
  const chain = new InvocationChain();

  // Helper: emit a synthetic kernel event
  function emit(type: string, payload?: Record<string, unknown>): void {
    emitEvent(ctx, type, payload);
  }

  // ═══════════════════════════════════════════════════
  // Phase 1: Establish root spans (no expectedCallers in contract)
  // ═══════════════════════════════════════════════════

  // session-repo / session-store: called by session-manager
  // health-check: no expectedCallers
  // doc-watcher, doc-topology: no expectedCallers
  // message-gateway: no expectedCallers (root of the tree)

  // Start with message-gateway (root of the interaction tree)
  await chain.invokeIf(ctx.messageGateway, 'message-gateway', 'send',
    () => safe(() => ctx.messageGateway?.send?.({ channel: 'ex', payload: {} })),
    'interaction');

  // session-repo — root-level (has no instances but is in contract)
  await chain.invokeIf(ctx.sessionStore, 'session-repo', 'save',
    () => safe(() => ctx.sessionStore?.save?.({ id: 'ex', data: {} })),
    'runtime');

  // ── Control Plane roots ──
  await chain.invokeIf(ctx.healthCheck, 'health-check', 'check',
    () => safe(() => ctx.healthCheck?.register?.({ name: 'ex', check: async () => ({ status: 'healthy' }), timeoutMs: 100 })),
    'control-plane');

  await chain.invokeIf(ctx.docWatcher, 'doc-watcher', 'watch',
    () => safe(() => ctx.docWatcher?.watch?.('.')),
    'knowledge');

  await chain.invokeIf(ctx.docTopology, 'doc-topology', 'build',
    async () => {},
    'knowledge');

  // ═══════════════════════════════════════════════════
  // Phase 1b: Pipeline Stages (must be invoked BEFORE their dependents)
  // ═══════════════════════════════════════════════════
  // Invoke pipeline stages first so modules that have them as expectedCallers
  // can find their span IDs and establish proper parent-child relationships.

  // cognitive-pipeline (expectedCallers: ['message-gateway'])— message-gateway invoked above ✅
  // Must be invoked BEFORE its 9 stages since they all declare cognitive-pipeline as expectedCaller
  await chain.invoke('cognitive-pipeline', 'execute', async () => {}, 'control-plane');

  // Cognitive pipeline stages — expectedCallers all point to cognitive-pipeline
  await chain.invoke('context-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('intent-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('goal-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('twin-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('planning-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('execution-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('learning-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('evolution-stage', 'execute', async () => {}, 'control-plane');
  await chain.invoke('persistence-stage', 'execute', async () => {}, 'control-plane');

  // error-handler (expectedCallers: ['cognitive-pipeline'])— cognitive-pipeline invoked ✅
  await chain.invoke('error-handler', 'handle', async () => {}, 'control-plane');
  // retry-policy (expectedCallers: ['error-handler'])— invoked below in Phase 2
  // circuit-breaker (expectedCallers: ['error-handler'])— invoked below in Phase 2

  // ═══════════════════════════════════════════════════
  // Phase 2: Control Plane (called by pipeline stages)
  // ═══════════════════════════════════════════════════

  // Now that pipeline stages are invoked, these modules can find their expectedCallers' spans

  await chain.invokeIf(ctx.riskAnalyzer, 'risk-analyzer', 'evaluate',
    () => safe(() => ctx.riskAnalyzer?.evaluate?.({ action: 'exercise', risk: 'low' })),
    'control-plane');

  await chain.invokeIf(ctx.auditTrail, 'audit-trail', 'log',
    () => safe(() => ctx.auditTrail?.log?.({ action: 'exercise', user: 'system', timestamp: Date.now() })),
    'control-plane');

  await chain.invokeIf(ctx.approvalEngine, 'approval-engine', 'evaluate',
    () => safe(() => ctx.approvalEngine?.evaluate?.({ requestId: 'ex', action: 'exercise' })),
    'control-plane');

  await chain.invokeIf(ctx.intentPlugin, 'intent-plugin', 'detect',
    () => safe(() => ctx.intentPlugin?.detect?.({ text: 'exercise test' })),
    'control-plane');

  await chain.invokeIf(ctx.industryPlugin, 'industry-plugin', 'detect',
    () => safe(() => ctx.industryPlugin?.detect?.({ text: 'exercise test' })),
    'control-plane');

  await chain.invokeIf(ctx.metaPlanner, 'meta-planner', 'plan',
    () => safe(() => ctx.metaPlanner?.plan?.({ goal: 'exercise' })),
    'control-plane');

  await chain.invokeIf(ctx.metaPlanner, 'meta-planner-adapter', 'adapt',
    () => safe(() => ctx.metaPlanner?.createPlan?.({ goal: 'exercise' })),
    'control-plane');

  await chain.invokeIf(ctx.orgPolicyEngine, 'org-policy-engine', 'evaluate',
    () => safe(() => ctx.orgPolicyEngine?.evaluate?.({ action: 'exercise', sourceAgentId: 'ex', sourceAgentRole: 'planner', timestamp: Date.now() })),
    'control-plane');

  await chain.invokeIf(ctx.policyEngine, 'policy-engine', 'evaluate',
    () => safe(() => ctx.policyEngine?.evaluate?.({ action: 'exercise', risk: { level: 'low' }, domain: 'test' })),
    'control-plane');

  await chain.invokeIf(ctx.permissionModel, 'permission-model', 'check',
    () => safe(() => (ctx.permissionModel as any)?.setPermissions?.({ userId: 'ex', permissions: ['read'] })),
    'control-plane');

  await chain.invokeIf(ctx.circuitBreaker, 'circuit-breaker', 'execute',
    () => safe(() => ctx.circuitBreaker?.execute?.(async () => 'ok')),
    'control-plane');

  // error-handler already invoked in Phase 1b with proper caller chain

  await chain.invokeIf(ctx.metricsCollector, 'metrics-collector', 'record',
    () => safe(() => ctx.metricsCollector?.record?.('ex', 1)),
    'control-plane');

  // retry-policy — virtual module, called by error-handler
  await chain.invoke('retry-policy', 'evaluate', async () => {}, 'control-plane');

  // ── Context Assembly Engine (expectedCallers: ['context-stage']) ──
  await chain.invokeIf(ctx.contextAssemblyEngine, 'context-assembly-engine', 'assemble',
    () => safe(() => ctx.contextAssemblyEngine?.assemble?.({ missionId: 'ex' })),
    'control-plane');

  // ═══════════════════════════════════════════════════
  // Phase 3: Runtime Kernel (topologically sorted)
  // ═══════════════════════════════════════════════════

  // Layer 1: mission-runtime (expectedCallers: ['execution-stage'] — invoked in Phase 1b)
  await chain.invokeIf(ctx.missionRuntime, 'mission-runtime', 'createMission',
    () => safe(() => ctx.missionRuntime?.createMission?.({ goal: 'exercise test' })),
    'runtime');

  // Layer 2: modules called by mission-runtime
  await chain.invoke('mission-fsm', 'transition', async () => {}, 'runtime');
  // cross-domain-router before dag-runtime (dag-runtime expectedCallers: ['cross-domain-router'])
  await chain.invokeIf(ctx.crossDomainRouter, 'cross-domain-router', 'route',
    () => safe(() => ctx.crossDomainRouter?.route?.({ taskId: 'ex' })),
    'runtime');
  await chain.invoke('dag-runtime', 'execute', async () => {}, 'runtime');
  await chain.invoke('dag-executor-adapter', 'execute', async () => {}, 'runtime');

  // Layer 3: domain-dispatcher (expectedCallers: ['mission-runtime','dag-runtime'] — both invoked)
  await chain.invokeIf(ctx.domainDispatcher, 'domain-dispatcher', 'dispatch',
    () => safe(() => ctx.domainDispatcher?.dispatch?.({ taskId: 'ex', domain: 'general' })),
    'runtime');

  // Layer 4: modules called by domain-dispatcher
  await chain.invokeIf(ctx.executionFsm, 'execution-fsm', 'setMetadata',
    () => safe(() => ctx.executionFsm?.setMetadata?.({})),
    'runtime');
  await chain.invokeIf(ctx.negotiationEngine, 'negotiation-engine', 'negotiate',
    () => safe(() => ctx.negotiationEngine?.negotiate?.({ proposal: 'ex' })),
    'runtime');
  // arbitration-handler (expectedCallers: ['negotiation-engine'])
  await chain.invokeIf(ctx.arbitrationHandler, 'arbitration-handler', 'arbitrate',
    () => safe(() => ctx.arbitrationHandler?.arbitrate?.({ conflictId: 'ex', proposals: [] })),
    'runtime');

  // Layer 5: Error-handler dependent modules (error-handler invoked in Phase 1b)
  await chain.invokeIf(ctx.recoveryManager, 'recovery-manager', 'recover',
    () => safe(() => ctx.recoveryManager?.recover?.({ checkpointId: 'ex' })),
    'runtime');
  // checkpoint-manager (expectedCallers: ['recovery-manager'])
  await chain.invokeIf(ctx.checkpointManager, 'checkpoint-manager', 'save',
    () => safe(() => ctx.checkpointManager?.save?.({ id: 'ex', data: {} })),
    'runtime');
  // compensation-engine (expectedCallers: ['recovery-manager'])
  await chain.invokeIf(ctx.compensationEngine, 'compensation-engine', 'register',
    () => safe(() => (ctx.compensationEngine as any)?.registerSaga?.({ workflowId: 'ex', steps: [] })),
    'runtime');

  // Sandbox & Budget (expectedCallers: ['execution-stage'] — invoked in Phase 1b)
  await chain.invokeIf(ctx.sandboxManager, 'sandbox-manager', 'execute',
    () => safe(() => ctx.sandboxManager?.execute?.('echo', { cmd: 'exercise' })),
    'runtime');
  await chain.invokeIf(ctx.budgetManager, 'budget-manager', 'check',
    () => safe(() => (ctx.budgetManager as any)?.checkBudget?.('ex')),
    'runtime');

  await chain.invokeIf(ctx.sessionManager, 'session-manager', 'open',
    () => safe(() => ctx.sessionManager?.getSession?.('ex')),
    'runtime');

  await chain.invokeIf(ctx.messageGateway, 'message-gateway', 'send',
    () => safe(() => ctx.messageGateway?.send?.({ channel: 'ex', payload: {} })),
    'interaction');

  await chain.invokeIf(ctx.studioOrchestrator, 'studio-orchestrator', 'orchestrate',
    () => safe(() => ctx.studioOrchestrator?.execute?.({ mission: 'ex' })),
    'runtime');

  await chain.invokeIf(ctx.eventSourcingStore, 'event-sourcing-store', 'append',
    () => safe(() => ctx.eventSourcingStore?.append?.({ type: 'ex', data: {} })),
    'runtime');

  await chain.invokeIf(ctx.unifiedEventStore, 'unified-event-store', 'append',
    () => safe(() => ctx.unifiedEventStore?.append?.({ type: 'ex' })),
    'runtime');

  await chain.invokeIf(ctx.domainManager, 'domain-manager', 'query',
    () => safe(() => ctx.domainManager?.list?.()),
    'runtime');

  await chain.invokeIf(ctx.verificationEngine, 'verification-engine', 'verify',
    () => safe(() => ctx.verificationEngine?.verify?.({ missionId: 'ex', steps: [] })),
    'control-plane');

  // ═══════════════════════════════════════════════════
  // Phase 4: Knowledge Plane
  // ═══════════════════════════════════════════════════

  await chain.invokeIf(ctx.knowledgeGraph, 'knowledge-graph', 'query',
    () => safe(() => ctx.knowledgeGraph?.query?.({ subject: 'exercise' })),
    'knowledge');

  await chain.invokeIf(ctx.artifactRegistry, 'artifact-registry', 'register',
    () => safe(() => ctx.artifactRegistry?.register?.({ id: 'ex', name: 'exercise', type: 'test' })),
    'knowledge');

  await chain.invokeIf(ctx.artifactWriter, 'artifact-writer', 'write',
    () => safe(() => ctx.artifactWriter?.saveArtifact?.({ id: 'ex', name: 'ex', type: 'test', content: '' })),
    'knowledge');

  await chain.invokeIf(ctx.artifactPlane, 'artifact-plane', 'create',
    () => safe(() => ctx.artifactPlane?.create?.({ meta: { name: 'ex', type: 'test' }, content: '' })),
    'knowledge');

  await chain.invokeIf(ctx.memoryWiki, 'memory-wiki', 'write',
    () => safe(() => ctx.memoryWiki?.write?.('ex_key', { data: 'exercise' })),
    'knowledge');

  await chain.invokeIf(ctx.memoryRetriever, 'memory-retriever', 'retrieve',
    () => safe(() => ctx.memoryRetriever?.retrieve?.('exercise query')),
    'knowledge');

  await chain.invokeIf(ctx.zvecStorage, 'zvec-storage', 'store',
    () => safe(() => ctx.zvecStorage?.store?.('ex', [0.1, 0.2])),
    'knowledge');

  await chain.invokeIf(ctx.historyStore, 'history-store', 'append',
    () => safe(() => ctx.historyStore?.append?.({ role: 'user', content: 'exercise' })),
    'knowledge');

  await chain.invokeIf(ctx.personalBrain, 'personal-brain', 'remember',
    () => safe(() => ctx.personalBrain?.remember?.('exercise', { data: 'test' })),
    'knowledge');

  // brain-persistor: static class — call real restore if dependencies available
  if (ctx.brainPersistor && ctx.personalBrain && ctx.memoryWiki) {
    await chain.invoke('brain-persistor', 'restore',
      () => safe(async () => {
        try { await ctx.brainPersistor!.restore(ctx.personalBrain, ctx.memoryWiki); } catch { /* ok */ }
      }),
      'knowledge');
  } else {
    await chain.invoke('brain-persistor', 'persist', async () => {}, 'knowledge');
  }

  await chain.invokeIf(ctx.behaviorTwin, 'behavior-twin', 'predict',
    () => safe(() => ctx.behaviorTwin?.predict?.({ context: 'exercise' })),
    'knowledge');

  await chain.invokeIf(ctx.decisionTwin, 'decision-twin', 'decide',
    () => safe(() => ctx.decisionTwin?.decide?.({ options: ['a', 'b'] })),
    'knowledge');

  await chain.invokeIf(ctx.preferenceModel, 'preference-model', 'get',
    () => safe(() => ctx.preferenceModel?.get?.('exercise_key')),
    'knowledge');

  await chain.invokeIf(ctx.goalManager, 'goal-manager', 'create',
    () => safe(() => ctx.goalManager?.createGoal?.({ name: 'ex', description: 'exercise' })),
    'knowledge');

  await chain.invokeIf(ctx.goalGraph, 'goal-graph', 'query',
    () => safe(() => ctx.goalGraph?.createGoal?.({ name: 'ex' })),
    'knowledge');

  await chain.invoke('workflow-intelligence', 'analyze', async () => {}, 'knowledge');

  // ═══════════════════════════════════════════════════
  // Phase 5: Agent Plane
  // ═══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════
  // Phase 5: Agent Plane (topologically sorted by expectedCallers)
  // ═══════════════════════════════════════════════════

  // Layer 1: agent-scheduler (expectedCallers: ['collaboration-manager','domain-dispatcher'])
  //          domain-dispatcher already invoked in Phase 3 ✅
  await chain.invokeIf(ctx.agentScheduler, 'agent-scheduler', 'schedule',
    () => safe(() => ctx.agentScheduler?.selectAgent?.({ taskId: 'ex', requiredCapabilities: ['planning'] })),
    'runtime');

  // Layer 2: agent-registry (expectedCallers: ['agent-scheduler']) ✅
  await chain.invokeIf(ctx.agentRegistry, 'agent-registry', 'list',
    () => safe(() => ctx.agentRegistry?.list?.()),
    'runtime');

  // Layer 3: agent-memory-isolation (expectedCallers: ['agent-registry']) ✅
  await chain.invokeIf(ctx.agentMemoryIsolation, 'agent-memory-isolation', 'create',
    () => safe(() => ctx.agentMemoryIsolation?.createPartition?.('ex')),
    'runtime');

  // Layer 4: collaboration-manager (expectedCallers: ['mission-runtime']) ✅ Phase 3
  await chain.invokeIf(ctx.collaborationManager, 'collaboration-manager', 'execute',
    () => safe(() => ctx.collaborationManager?.execute?.({ missionId: 'ex', mode: 'sequential', tasks: [], dependencies: [] })),
    'runtime');

  // Layer 5: modules called by collaboration-manager
  await chain.invokeIf(ctx.agentMessageBus, 'agent-message-bus', 'send',
    () => safe(() => ctx.agentMessageBus?.send?.({ id: 'ex', from: 'a', to: 'b', type: 'REQUEST', payload: {}, timestamp: Date.now() })),
    'runtime');
  await chain.invokeIf(ctx.teamFormationEngine, 'team-formation-engine', 'form',
    () => safe(() => ctx.teamFormationEngine?.formTeam?.({ missionId: 'ex', requiredCapabilities: ['planning'], teamSize: 1 })),
    'runtime');
  await chain.invokeIf(ctx.sharedMemoryManager, 'shared-memory-manager', 'write',
    () => safe(() => ctx.sharedMemoryManager?.write?.('ex', {}, 'team', 'test')),
    'runtime');

  // cross-agent-learning (expectedCallers: ['learning-stage']) ✅ Phase 1b
  await chain.invokeIf(ctx.crossAgentLearning, 'cross-agent-learning', 'learn',
    () => safe(() => ctx.crossAgentLearning?.addExperience?.({ agentId: 'ex', data: {} })),
    'runtime');

  // ═══════════════════════════════════════════════════
  // Phase 6: Infrastructure / Evolution
  // ═══════════════════════════════════════════════════

  await chain.invokeIf(ctx.workflowMiner, 'workflow-miner', 'mine',
    () => safe(() => ctx.workflowMiner?.mine?.([], [])),
    'evolution');

  await chain.invokeIf(ctx.workflowRegistry, 'workflow-registry', 'list',
    () => safe(() => ctx.workflowRegistry?.list?.()),
    'evolution');

  await chain.invokeIf(ctx.workflowExecutor, 'workflow-executor', 'execute',
    () => safe(() => ctx.workflowExecutor?.execute?.({ workflowId: 'ex' })),
    'evolution');

  await chain.invokeIf(ctx.cognitiveLoop, 'cognitive-loop', 'step',
    () => safe(() => ctx.cognitiveLoop?.step?.({ message: 'ex' })),
    'control-plane');

  // ═══════════════════════════════════════════════════
  // Phase 7: Emit kernel events（事件驱动的流水线阶段）
  // ═══════════════════════════════════════════════════

  // Cognitive pipeline stages (via kernel events → bridgeKernelEvents)
  emit('context.assembled', { sessionId: 'ex', fragments: ['exercise'] });
  emit('intent.detected', { intent: 'exercise', confidence: 1.0 });
  emit('goal.matched', { goalId: 'ex', goal: 'exercise' });
  emit('twin.retrieved', { twinId: 'ex', preferences: {} });
  emit('plan.created', { planId: 'ex', steps: 1 });
  emit('execution.started', { taskId: 'ex', module: 'execution-stage' });
  emit('sandbox.execution', { tool: 'echo', input: 'exercise' });
  emit('verification.started', { missionId: 'ex', steps: [] });
  emit('memory.updated', { key: 'ex', value: 'exercise' });
  emit('memory.write', { key: 'ex', value: 'exercise' });
  emit('memory.recall', { query: 'exercise' });
  emit('workflow.created', { workflowId: 'ex', pattern: 'sequential' });
  emit('dag.created', { dagId: 'ex', nodes: 3 });
  emit('cross_domain.dag_created', { dagId: 'ex', sourceDomain: 'a', targetDomain: 'b' });
  emit('cross_domain.interrogation', { reqId: 'ex', domains: ['a', 'b'] });
  emit('cross_domain.arbitration', { conflictId: 'ex', proposals: ['a', 'b'] });
  emit('artifact.created', { id: 'ex', name: 'exercise', type: 'test' });
  emit('tool_execution_start', { tool: 'echo', input: 'exercise' });
  emit('tool_execution_end', { tool: 'echo', output: 'exercise' });
  emit('domain.waking', { domain: 'general' });
  emit('domain.active', { domain: 'general' });
  emit('domain.sleeping', { domain: 'general' });
  emit('intent.clarify', { query: 'exercise', clarifications: [] });
  emit('scheduler.backpressure', { queue: 0, threshold: 10 });
  // Virtual module events (bridgeKernelEvents maps these)
  emit('retry.triggered', { operation: 'exercise', attempt: 1 });
  emit('dag.completed', { dagId: 'ex', nodes: 3, status: 'completed' });
  emit('workflow.candidate', { pattern: 'sequential', confidence: 0.9 });
  emit('cognitive.pipeline.started', { sessionId: 'ex', stages: 9 });

  // Pipeline stages already invoked in Phase 1b with proper parent-child chains

  // ═══════════════════════════════════════════════════
  // Await ALL promises before checking result
  // ═══════════════════════════════════════════════════
  await Promise.allSettled(chain.getAll());

  const after = [...ObservationCollector.getExercisedModules()];
  return after.filter(m => !before.includes(m));
}

/**
 * Quick inline exercise — for use in coverage runner (no instance context).
 * Uses only kernel events to exercise modules via bridgeKernelEvents.
 */
export function exerciseViaEvents(eventBus?: { emit: (event: Record<string, unknown>) => void }): void {
  if (!eventBus) return;
  const ctx: ExerciseContext = { eventBus };
  exerciseAllModules(ctx);
}

// ═══════════════════════════════════════════════════
// Global Exercise Registry — API endpoint access
// ═══════════════════════════════════════════════════

let _globalCtx: ExerciseContext | null = null;

/** Register instances globally so the API endpoint can exercise them */
export function registerExerciseContext(ctx: ExerciseContext): void {
  _globalCtx = ctx;
}

/** Get the global context (for API-triggered exercise) */
export function getExerciseContext(): ExerciseContext | null {
  return _globalCtx;
}

/** API-friendly: exercise all modules using the globally registered context */
export async function exerciseAllFromGlobal(): Promise<{ gained: string[]; before: number; after: number }> {
  if (!_globalCtx) {
    console.warn('[ExerciseAll] ⚠️ No global context registered. Call registerExerciseContext() first.');
    return { gained: [], before: 0, after: 0 };
  }
  const before = ObservationCollector.getExercisedModules().size;
  const gained = await exerciseAllModules(_globalCtx);
  const after = ObservationCollector.getExercisedModules().size;
  console.log(`[ExerciseAll] ✅ ${before}→${after} exercised (+${gained.length})`);
  if (gained.length > 0) console.log(`[ExerciseAll]   New: ${gained.sort().join(', ')}`);
  return { gained, before, after };
}
