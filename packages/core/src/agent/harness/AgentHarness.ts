import type { MemoryRecord, ArtifactRef, HarnessEventCallback } from './types.js';
import type { HarnessContext, IntentContext, ExecutionState } from './HarnessContext.js';
import { ContextBuilder } from './ContextBuilder.js';
import type { MemoryActivationEngine } from '../../memory/MemoryActivationEngine.js';

/** Phase 11: 资源提供者接口 — 工具通过 Harness 访问资源，不再直接注入 */
export interface HarnessResourceProviders {
  getArtifactRegistry?: () => any;
  getKnowledgeGraph?: () => any;
  getMemoryRetriever?: () => any;
}

/**
 * AgentHarness — Agent Operating Environment
 *
 * 提供完整的 Agent 执行上下文，包含 7 个上下文维度：
 * Intent, Plan, Memory, Artifact, ExecutionState, Permission, Experience
 */
export class AgentHarness {
  private _context: HarnessContext | null = null;
  private _initialized = false;
  private _eventCallbacks: HarnessEventCallback[] = [];
  private _memoryEngine: MemoryActivationEngine | null = null;
  private _providers: HarnessResourceProviders = {};

  /** Phase 13: Attach MemoryActivationEngine */
  attachMemoryEngine(engine: MemoryActivationEngine): void {
    this._memoryEngine = engine;
  }

  /** Phase 11: Attach resource providers for harness-mediated access */
  attachProviders(providers: HarnessResourceProviders): void {
    this._providers = { ...this._providers, ...providers };
  }

  onEvent(cb: HarnessEventCallback): () => void {
    this._eventCallbacks.push(cb);
    return () => { this._eventCallbacks = this._eventCallbacks.filter(c => c !== cb); };
  }

  private emit(event: string, data: any): void {
    for (const cb of this._eventCallbacks) cb(event, data);
  }

  /** 使用 builder 构建 context 后初始化 Harness */
  async initialize(context: HarnessContext): Promise<void> {
    this._context = context;
    this._initialized = true;
    this.emit('harness.ready', { context: this._context });
  }

  /** 快捷初始化：使用 builder 构造 */
  static async create(buildFn: (builder: ContextBuilder) => ContextBuilder): Promise<AgentHarness> {
    const builder = buildFn(new ContextBuilder());
    const context = builder.build();
    const harness = new AgentHarness();
    await harness.initialize(context);
    return harness;
  }

  get isInitialized(): boolean { return this._initialized; }

  getContext(): HarnessContext {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    return this._context;
  }

  /** 更新意图 */
  updateIntent(update: Partial<IntentContext>): void {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    this._context.intent = { ...this._context.intent, ...update };
    this._context.updatedAt = Date.now();
    this._bumpVersion();
    this.emit('harness.context-updated', { type: 'intent', data: update });
  }

  /** 更新执行状态 */
  updateExecutionState(update: Partial<ExecutionState>): void {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    this._context.executionState = { ...this._context.executionState, ...update };
    this._context.updatedAt = Date.now();
    this._bumpVersion();
    this.emit('harness.executing', { state: this._context.executionState });
  }

  /** 附加产物 */
  attachArtifact(artifact: ArtifactRef): void {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    this._context.artifact.availableArtifacts.push(artifact);
    this._context.updatedAt = Date.now();
    this.emit('harness.context-updated', { type: 'artifact', data: artifact });
  }

  /** 注入记忆 */
  injectMemory(memory: MemoryRecord): void {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    this._context.memory.relevantMemories.push(memory);
    this._context.updatedAt = Date.now();
    this.emit('harness.context-updated', { type: 'memory', data: memory });
  }

  /** 检查权限：限制列表中的动作被拒绝，其他允许 */
  checkPermission(action: string): boolean {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    const ctx = this._context.permission;
    if (ctx.restrictions.some(r => action.includes(r))) return false;
    return ctx.granted;
  }

  /** 获取 Agent runtime 上下文 */
  getAgentRuntime(goal?: string): Record<string, any> {
    if (!this._context) throw new Error('[AgentHarness] Not initialized');
    const ctx = this._context;

    // Phase 13: Auto-activate memories if engine is attached
    let activatedMemories: string[] | undefined;
    let activationScore: number | undefined;
    if (this._memoryEngine && (goal || ctx.intent.goal)) {
      const result = this._memoryEngine.activate({
        executionStatus: ctx.executionState.status,
        goal: goal || ctx.intent.goal,
        currentStep: ctx.executionState.step,
        totalSteps: 1,
        completedSteps: [],
        errors: [],
        tags: [],
      });
      activatedMemories = result.memories.map(m => m.content);
      activationScore = result.activationScore;
      ctx.memory.contextBias = result.contextBias;
    }

    return {
      goal: ctx.intent.goal,
      constraints: ctx.intent.constraints,
      planId: ctx.plan.planId,
      currentPhase: ctx.plan.currentPhase,
      progress: ctx.plan.progress,
      memories: [...ctx.memory.relevantMemories.map(m => m.content), ...(activatedMemories || [])],
      contextBias: ctx.memory.contextBias,
      activationScore,
      artifacts: ctx.artifact.availableArtifacts.map(a => ({ id: a.id, name: a.name, uri: a.uri })),
      executionStatus: ctx.executionState.status,
      step: ctx.executionState.step,
      attempt: ctx.executionState.attempt,
      permissions: ctx.permission.requiredPermissions,
      patterns: ctx.experience.patterns,
      recommendations: ctx.experience.recommendations,
    };
  }

  // ═══════════════════════════════════════════
  // Phase 11: Harness-mediated resource access
  // 工具通过以下方法访问资源，不再直接注入
  // ═══════════════════════════════════════════

  /** 通过 Harness 注册产物（替代直接调用 ArtifactRegistry） */
  async registerArtifact(params: { name: string; type: string; content: any; tags?: string[] }): Promise<{ id: string }> {
    const registry = this._providers.getArtifactRegistry?.();
    if (!registry) throw new Error('[Harness] ArtifactRegistry provider not attached');
    if (!this.checkPermission('write:artifacts')) throw new Error('[Harness] Permission denied: write:artifacts');
    const now = Date.now();
    const artifact = {
      id: `art_${now}_${Math.random().toString(36).slice(2, 10)}`,
      name: params.name, type: params.type, content: params.content,
      version: 1, status: 'draft', createdAt: now, updatedAt: now,
      metadata: { source: 'harness', tags: params.tags ?? [] },
    };
    await registry.register(artifact);
    this.attachArtifact({ id: artifact.id, name: artifact.name, type: artifact.type, version: '1', uri: `artifact://default/${artifact.type}/${artifact.id}` });
    this.emit('harness.artifact-registered', { artifact });
    return { id: artifact.id };
  }

  /** 通过 Harness 读取产物（替代直接调用 ArtifactRegistry.resolve） */
  getArtifact(uri: string): any {
    const registry = this._providers.getArtifactRegistry?.();
    if (!registry) throw new Error('[Harness] ArtifactRegistry provider not attached');
    if (!this.checkPermission('read:artifacts')) throw new Error('[Harness] Permission denied: read:artifacts');
    return registry.resolve(uri);
  }

  /** 通过 Harness 搜索记忆（替代直接调用 MemoryRetriever） */
  searchMemory(query: string, category?: string): any {
    const retriever = this._providers.getMemoryRetriever?.();
    if (!retriever) return { found: false, reason: 'retriever_not_ready' };
    this.emit('harness.memory-search', { query, category });
    switch (category) {
      case 'errors': return retriever.retrieveForError(query);
      case 'docs': return retriever.retrieveForUncertainty(query);
      default: return retriever.retrieveForTask(query);
    }
  }

  /** 通过 Harness 查询知识图谱（替代直接调用 KnowledgeGraph） */
  queryKnowledge(query: string, maxResults?: number): any[] {
    const kg = this._providers.getKnowledgeGraph?.();
    if (!kg) return [];
    this.emit('harness.knowledge-query', { query, maxResults });
    return kg.searchEntities({ text: query, limit: maxResults ?? 10 });
  }

  // ═══════════════════════════════════════════
  // Phase B: 生命周期管理
  // ═══════════════════════════════════════════

  private _contextVersion = 0;
  private _contextHistory: Array<{ version: number; timestamp: number; snapshot: Partial<HarnessContext> }> = [];
  private _disposed = false;

  /** Phase B: 获取上下文版本号（每次更新递增） */
  get contextVersion(): number { return this._contextVersion; }

  /** Phase B: 获取上下文变更历史 */
  getContextHistory(): ReadonlyArray<{ version: number; timestamp: number; snapshot: Partial<HarnessContext> }> {
    return this._contextHistory;
  }

  /** Phase B: 快照当前上下文（用于追踪/审计） */
  snapshot(): HarnessContext | null {
    if (!this._context) return null;
    this._contextVersion++;
    const snap = JSON.parse(JSON.stringify(this._context));
    this._contextHistory.push({ version: this._contextVersion, timestamp: Date.now(), snapshot: snap });
    return snap;
  }

  private _bumpVersion(): void {
    this._contextVersion++;
    if (this._context) {
      this._contextHistory.push({
        version: this._contextVersion,
        timestamp: Date.now(),
        snapshot: {
          intent: { ...this._context.intent },
          executionState: { ...this._context.executionState },
        },
      });
      // 限制历史长度
      if (this._contextHistory.length > 100) {
        this._contextHistory = this._contextHistory.slice(-50);
      }
    }
  }

  /** Phase B: 是否已释放 */
  get isDisposed(): boolean { return this._disposed; }

  /** Phase B: 释放资源 */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._context = null;
    this._initialized = false;
    this._eventCallbacks = [];
    this._providers = {};
    this._contextHistory = [];
    this._memoryEngine = null;
    this.emit('harness.disposed', {});
  }

  /** 重置（保留 provider 绑定） */
  reset(): void {
    this._context = null;
    this._initialized = false;
    this._eventCallbacks = [];
  }
}
