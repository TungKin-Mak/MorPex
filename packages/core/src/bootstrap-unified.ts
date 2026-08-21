/**
 * MorPex Unified Bootstrap — 唯一入口
 *
 * ═══ v16 Unified（取代 v12-v16 所有旧 bootstrap）═══
 *
 * 合并所有版本能力：
 *   v12 组织层: DepartmentManager / LeadAgent / GroupChat / ManagementHub
 *   v13 大脑层: ReflectionEngine / LearningLoop / HierarchicalPlanner / ToolFactory
 *   v14 目标层: GoalIntelligence / ArtifactFacade / VerificationEngine / ExperienceMiner
 *   v15 团队层: DynamicTeamOrchestrator / WorkflowRegistry / Compliance / SelfImprovement
 *   v16 总控层: MissionController / CapabilityRegistry / ExecutionSimulator / ApprovalGate
 *   Ontology: OntologyService / ForcedQueryGuard / Projectors / EvaluationEngine
 *
 * 使用方式：
 *   import { bootstrapUnified } from './core/src/bootstrap-unified.js';
 *   const { companyFacade, container } = await bootstrapUnified();
 *   const result = await companyFacade.executeGoal("开发空气检测设备并销售到 Amazon");
 *
 * 设计原则：
 *   - ServiceContainer 创建所有运行时服务 + MorPexRuntime
 *   - CompanyFacade 构造时强制要求 Runtime + ControlPlane（非可选注入）
 *   - 旧 bootstrap（v12-v16）已删除（Wave 9），唯一入口 bootstrapUnified
 */

import { ServiceContainer } from './execution/runtime/ServiceContainer.js';
import { EventType } from './infrastructure/protocol/events/EventType.js';
import { registerCoreEventContracts } from './infrastructure/common/contracts/eventContractCatalog.js';
import { PluginSystem } from './infrastructure/common/PluginSystem.js';
import { ExecutionIdentity } from './infrastructure/common/ExecutionIdentity.js';
import { CompanyFacade } from './facade/CompanyFacade.js';
import { GoalIntelligenceFacade } from './cognition/planning/goal-intelligence/GoalIntelligenceFacade.js';
import { DepartmentManager } from './governance/control-plane/DepartmentManager.js';
import { SpaceService } from './governance/control-plane/SpaceService.js';
import { AgentMailbox, setMailboxInstance } from './execution/AgentMailbox.js';
import { TaskStateProjector } from './execution/TaskStateProjector.js';
import { restoreDecisions } from './execution/DecisionStore.js';
import { RoleRegistry } from './governance/control-plane/RoleRegistry.js';
import { CapabilityRegistry } from './governance/capability/CapabilityRegistry.js';
import { systemMetadataGraph } from './knowledge/graph/SystemMetadataGraph.js';

// ── Ontology 迭代4 ──
import { OntologyService } from './knowledge/ontology/OntologyService.js';
import { ForcedQueryGuard } from './gate/ForcedQueryGuard.js';
import { ObjectTypeRegistry } from './knowledge/ontology/ObjectTypeRegistry.js';
import {
  MissionProjector,
  ArtifactProjector,
} from './knowledge/ontology/projectors/index.js';
import { createQueryPerformedEvent } from './gate/ontologyEvents.js';
import { FeedbackService } from './knowledge/ontology/FeedbackService.js';

// ── Ontology Gate for Primitives ──
import { initializeOntologyGate, setPiBridge as setKqpBridge } from './infrastructure/tools/primitives/KnowledgeQueryPrimitive.js';
import { initializeOntologyGateForArtifact, setPiBridge as setAgpBridge } from './infrastructure/tools/primitives/ArtifactGenerationPrimitive.js';
import { KnowledgeGapListener } from './evolution/KnowledgeGapListener.js';
import { DomainPrimitiveRegistry } from './infrastructure/tools/DomainPrimitiveRegistry.js';
import {
  KnowledgeQueryPrimitive,
  FileOperationPrimitive,
  ArtifactGenerationPrimitive,
  ShellExecutionPrimitive,
  APICallPrimitive,
} from './infrastructure/tools/primitives/index.js';

// ── v16 模块 ──
import { ReflectionEngine } from './cognition/index.js';
import { LearningLoop } from './cognition/learning/LearningLoop.js';
import { WorkflowRegistry as WorkflowPluginRegistry } from './workflow/WorkflowProvider.js';

import type { IEventStore } from './infrastructure/protocol/events/store/IEventStore.js';
import { buildExtractPrompt, validatePrimitiveParams } from './infrastructure/tools/paramCompleter.js';

export interface UnifiedBootstrapResult {
  container: ServiceContainer;
  companyFacade: CompanyFacade;
  departmentManager: DepartmentManager;
  /** P1 部门 Space 化：组织空间服务（总部 + 部门，懒加载扫描 WorkflowProvider） */
  spaceService: SpaceService;
  /** P2 跨部门/工位真交流：AgentMailbox（LLM 扮演目标角色回复 + 落盘 + 事件） */
  mailbox: AgentMailbox;
  /** P-A 任务状态投影：执行事件 → data/tasks/<missionId>.json（切视图/重启可恢复工作台） */
  taskStateProjector: TaskStateProjector;
  controlPlane: import('./governance/control-plane/ControlPlane.js').ControlPlane;

  // ── Ontology ──
  ontology: OntologyService;
  forcedQueryGuard: ForcedQueryGuard;
  objectTypeRegistry: ObjectTypeRegistry;
  missionProjector: MissionProjector;
  artifactProjector: ArtifactProjector;
  feedbackService: FeedbackService;
}

export async function bootstrapUnified(options?: {
  /** 外部传入的 EventStore（用于 Trace 事件写入） */
  eventStore?: IEventStore;
  /** CEO ID（可选，默认 'ceo-default'） */
  ceoId?: string;
}): Promise<UnifiedBootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';
  const eventStore = options?.eventStore;
  const __bt = Date.now();

  // 1. 初始化 CapabilityRegistry（内置能力）
  CapabilityRegistry.init();

  // 2. 创建 ServiceContainer（含所有服务 + MorPexRuntime + ControlPlane）
  const container = new ServiceContainer();

  // ⬅️ 尽早等待 EventStore 就绪，避免后续注册/写入竞态
  await container.ready;

  // ═══ 事件契约目录（参考 deepseek-harness Event Map）：注册后 emit 路径即开始开发模式载荷校验 ═══
  registerCoreEventContracts(container.eventBus);

  // ═══ 去黑盒化：接入统一记录器（L0/L1/L2 三层；ServiceContainer 已接，此处对
  //     外部传入的独立 EventStore 刷新配置，保证外部注入场景也留痕）═══
  const { getSharedDeblackboxRecorder } = await import('./infrastructure/observability/deblackbox/DeblackboxRecorder.js');
  getSharedDeblackboxRecorder().configure({ eventStore: eventStore ?? container.eventStore });

  // ═══ 去黑盒化（数据生命周期）：启动 L2 详情 TTL 清理任务（unref 定时器，不拖住进程退出）═══
  try {
    const { RecordCleaner } = await import('./infrastructure/observability/deblackbox/RecordCleaner.js');
    const recorder = getSharedDeblackboxRecorder();
    const cleaner = new RecordCleaner(recorder.getRecordPolicy(), recorder.getDetailStore());
    cleaner.schedule(24 * 60 * 60 * 1000);
    console.log('[bootstrapUnified] ✅ 去黑盒 L2 详情 TTL 清理任务已启动（24h 周期，unref）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ 去黑盒 TTL 清理任务启动失败（不阻断）:', (err as Error).message);
  }


  // 3. 注册 WorkflowRegistry + 加载 Workflow 插件（理想架构第 9 层）
  try {
    container.teamOrchestrator.setWorkflowRegistry(WorkflowPluginRegistry);
    // 旧接口兼容：注册 4 个插件的 WorkflowProvider
    const { ecommerceWorkflowProvider } = await import('../../workflows/ecommerce/workflow-provider.js');
    const { hardwareWorkflowProvider } = await import('../../workflows/hardware/workflow-provider.js');
    const { softwareWorkflowProvider } = await import('../../workflows/software/workflow-provider.js');
    const { xjmcuWorkflowProvider } = await import('../../workflows/xjmcu/workflow-provider.js');
    WorkflowPluginRegistry.register(ecommerceWorkflowProvider);
    WorkflowPluginRegistry.register(hardwareWorkflowProvider);
    WorkflowPluginRegistry.register(softwareWorkflowProvider);
    WorkflowPluginRegistry.register(xjmcuWorkflowProvider);
    console.log('[bootstrapUnified] ✅ WorkflowRegistry 已注入 4 个插件');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ Workflow 插件加载失败:', (err as Error).message);
  }

  // 3.1 注册 Workflow 插件的 ActionPrimitive（理想架构第 9 层 → 第 6 层注册中心)
  // ═══ G2：接入 PluginSystem（幽灵模块处置）──顺序捕获各领域新增原语 → 注册插件到单例 → startAll ═══
  try {
    const { bootstrapEcommerceWorkflow } = await import('../../workflows/ecommerce/src/bootstrap.js');
    const { bootstrapHardwareWorkflow } = await import('../../workflows/hardware/src/bootstrap.js');
    const { bootstrapSoftwareWorkflow } = await import('../../workflows/software/src/bootstrap.js');
    const { bootstrapXJMcuWorkflow } = await import('../../workflows/xjmcu/src/bootstrap.js');

    const domains = [
      { name: 'ecommerce', bootstrap: bootstrapEcommerceWorkflow },
      { name: 'hardware', bootstrap: bootstrapHardwareWorkflow },
      { name: 'software', bootstrap: bootstrapSoftwareWorkflow },
      { name: 'xjmcu', bootstrap: bootstrapXJMcuWorkflow },
    ] as Array<{ name: string; bootstrap: (d?: string) => Promise<void> }>;

    const pluginSystem = PluginSystem.getInstance(container.eventBus, new ExecutionIdentity());
    const domainDisposers = new Map<string, () => boolean>();

    for (const d of domains) {
      const before = new Set(DomainPrimitiveRegistry.listNames());
      await d.bootstrap(d.name);
      const added = DomainPrimitiveRegistry.listNames().filter((n) => !before.has(n));
      // 可逆效果：stop() 时精确回滚该领域在本次启动中注册的原语（呼应 harness reversible-effects）
      domainDisposers.set(d.name, () => {
        let all = true;
        for (const n of added) {
          all = DomainPrimitiveRegistry.unregister(n) && all;
        }
        return all;
      });
      pluginSystem.register({
        name: `workflow:${d.name}`,
        version: '1.0.0',
        dependencies: [],
        initialize: async () => {}, // 原语已在上方顺序注册完成，此处仅生命周期占位
        start: async () => {},
        stop: async () => {
          const ok = domainDisposers.get(d.name)?.() ?? true;
          console.log(`[PluginSystem] ♻️ workflow:${d.name} 已停止（回卷 ${added.length} 个领域原语）ok=${ok}`);
        },
      });
    }

    await pluginSystem.startAll();
    console.log(`[bootstrapUnified] ✅ 4 个 Workflow 插件接入 PluginSystem（生命周期受管，原语共 ${DomainPrimitiveRegistry.list().length} 个）`);
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ Workflow 插件 ActionPrimitive 注册失败:', (err as Error).message);
  }

  // 4. （已移除）ArtifactFacade → ExecutionEngine 注入：产物创建统一由 MorPexRuntime 处理，Engine 不再消费

  // 5. 创建 CompanyFacade（构造时强制要求 Runtime + ControlPlane）
  const eventBus = container.eventBus;
  const departmentManager = new DepartmentManager(eventBus);
  // ═══ P1 部门 Space 化：组织空间服务（懒加载；首次 getTree/routeGoal 时扫描 WorkflowProvider 生成部门 Space）═══
  const spaceService = new SpaceService(eventBus);
  // ═══ P2 跨部门/工位真交流：AgentMailbox（LLM 扮演目标角色回复；step-agent 经 mail 工具调用）═══
  const mailbox = new AgentMailbox();
  // ═══ P-A 任务状态投影：订阅执行事件 → data/tasks/<missionId>.json（真相源，切视图/重启可恢复）═══
  const taskStateProjector = new TaskStateProjector();
  taskStateProjector.attach(eventBus);
  taskStateProjector.restore();
  // ═══ P-B 未决决策持久化：重放 data/decisions.jsonl（后端重启后 plan/ask/approval 待决可恢复）═══
  restoreDecisions();
  mailbox.setEventBus(eventBus);
  mailbox.setSpaceService(spaceService);
  // LLM 扮演：复用 piBridgeWrapper 的流式文本生成（懒加载进程级单例；未装好时 mail 工具不暴露）
  mailbox.setLLM(async (system, prompt) => {
    const { getSharedPiBridge } = await import('./infrastructure/adapters/pi-bridge/PiBridge.js');
    const bridge = getSharedPiBridge();
    if (!bridge) return '';
    try { await bridge.init(); } catch { /* init 失败走模板消耗 */ }
    const full = await bridge.generateChatStream({ system, prompt }, () => { /* 角色扮演不流式 */ });
    return typeof full === 'string' ? full : String(full ?? '');
  });
  setMailboxInstance(mailbox);
  const roleRegistry = new RoleRegistry(eventBus);
  const companyFacade = new CompanyFacade(
    departmentManager,
    roleRegistry,
    container.runtime,
    container.controlPlane,
    ceoId,
  );

  // 功能③：注入上下文组装引擎（装配统一在 MorPexRuntime orchestrate 后执行，读真实 Mission 数据；引擎缺省零风险）
  try {
    const { ContextAssemblyEngine } = await import('./knowledge/context/ContextAssemblyEngine.js');
    await import('./knowledge/context/providers/realProviders.js');
    const assemblyEngine = new ContextAssemblyEngine(undefined, undefined, undefined, undefined, undefined, {
      enableVersioning: true,
      enableEnrichment: true,
      maxFragments: 50,
      fragmentTimeoutMs: 3000,
      schemaVersion: '1.0',
      focusMode: true, // 功能③：聚焦模式——只装当前任务材料
      maxTokens: 8000,
      enableTelemetry: true, // ═══ 会话 16c（3+4）：装配成本监控
      eventBus: container.eventBus, // ═══ 会话 16c：context.assembly.telemetry 事件出口
      // ═══ 会话 16d/16e（P2 经验注入 + 3-3 进化策略落地）：装配时注入相似任务经验 + 已应用策略 ═══
      experienceInjector: {
        inject: async (goal: string, domain?: string) => {
          const { ExperienceInjectionService } = await import('./evolution/ExperienceInjectionService.js');
          const svc = new ExperienceInjectionService({ getEvents: () => container.experienceMiner.getEvents() });
          const mined = svc.inject(goal, domain);
          // 会话 16e：已应用策略（EvolutionApplyLoop 半自动落地）——直接影响装配提示
          const applied = container.promptStrategyRegistry.all()
            .map(s => `[已应用策略 v${s.version}] ${s.hint}`)
            .join('\n');
          const parts = [mined, applied].filter(Boolean);
          return parts.length > 0 ? parts.join('\n') : null;
        },
      },
    });
    // ═══ 功能③ 遗留项：装配快照持久化接线（惰性 provider）═══
    // 此前引擎构造未传 persistence → assemble() 的 this.persistence 恒空 → ContextPersistence
    // （装配快照，与近期摘要 reader 数据源① 同库）在生产路径从未落库 → 双源召回退化为单源（EventStore）。
    // 修复：setPersistenceProvider 惰性解析 container.getContextPersistence()（共享 EventStore SQLite db），
    // assemble 运行时才取——EventStore 初始化时序无关。
    assemblyEngine.setPersistenceProvider(() => container.getContextPersistence());
    // 装配统一入口：MorPexRuntime orchestrate 后（Mission 已创建，missionId 真实）
    // Provider 注册在 ontology 创建后（见下方 Ontology 迭代4 区块）
    container.setContextAssemblyEngine(assemblyEngine);

    // ═══ 功能③ 遗留项：近期摘要消费端接线 ═══
    // 设计哲学：工作上下文 = 系统约束 + Goal/Plan/Task + ontologyRefs + ≤N 条近期摘要。
    // 数据源① ContextPersistence 装配快照（惰性 SQLite，focusedSummary 即摘要）
    // 数据源② EventStore 权威快照（context.snapshot：goal + result + score 合成摘要；taskRef 去重优先）
    // reader 在调用时（assemble 运行时）才解析存储——EventStore 未就绪/失败 → 另一源兜底，不阻断装配。
    // ═══ 会话 16g（装配性能优化）：单查聚合（listRecentArchived）替代 N+1（listTaskRefs+逐 ref loadByTaskRef）
    //     + TTL 缓存（跨任务摘要变化不频繁，30s 内不重扫）——实测装配 37-82s 主因在此。
    try {
      const { listRecentArchived } = await import('./knowledge/context/ContextArchive.js');
      const { defaultRiskGrader } = await import('./knowledge/context/ContextAssemblyEngine.js');
      // 近期摘要 TTL 缓存（30s）：装配高频调用但摘要低频变化 → 缓存命中免 EventStore/SQLite 全扫
      let recentCache: { at: number; data: Array<{ taskRef: string; summary: string; archivedAt: number; source: 'event-store' | 'persistence' }> } | null = null;
      const RECENT_TTL_MS = 30_000;
      assemblyEngine.setRecentSummaryReader({
        loadRecent: async (limit: number) => {
          // 缓存命中（TTL 内）→ 直接返回
          if (recentCache && Date.now() - recentCache.at < RECENT_TTL_MS) {
            return recentCache.data.slice(0, limit);
          }

          const out: Array<{
            taskRef: string; summary: string; keyRefs?: string[]; archivedAt: number; source: 'event-store' | 'persistence';
          }> = [];

          // 数据源①：ContextPersistence 装配快照（最近 N 条，SQLite LIMIT 高效查询）
          // ⚠️ 会话 16h（4GB 根因修复）：必须截断为短摘要——注入完整 focusedSummary 会导致
          //    递归膨胀（上任务的 focusedSummary 已含它的近期摘要 → 每代≈5×前代，实测单条快照 391MB）
          try {
            const persistence = container.getContextPersistence();
            if (persistence) {
              for (const snap of persistence.loadRecent(limit)) {
                const session = (snap.layers?.session ?? {}) as Record<string, unknown>;
                out.push({
                  taskRef: (session.taskRef as string) ?? snap.missionId,
                  // 短摘要：仅取 focusedSummary 开头（约 120 字符），不再注入完整文本
                  summary: `[装配快照] ${(snap.focusedSummary ?? `任务 ${snap.missionId}`).slice(0, 120)}`,
                  archivedAt: snap.assembledAt,
                  source: 'persistence',
                });
              }
            }
          } catch (err) {
            console.warn(`[bootstrapUnified] ⚠️ 近期摘要·装配快照源读取失败（非阻断）: ${(err as Error).message}`);
          }

          // 数据源②：EventStore 权威快照（单查聚合，taskRef 去重取最新，前 limit）
          try {
            const es = container.eventStore;
            if (es) {
              await (es as unknown as { init?: () => Promise<void> }).init?.();
              for (const snap of await listRecentArchived(es, limit)) {
                const scoreText = typeof snap.score === 'number' ? `，质量分 ${snap.score}` : '';
                out.push({
                  taskRef: snap.taskRef,
                  summary: `${snap.goal ?? ''}（${snap.result === 'success' ? '成功' : '失败'}${scoreText}）`,
                  archivedAt: snap.archivedAt,
                  source: 'event-store',
                });
              }
            }
          } catch (err) {
            console.warn(`[bootstrapUnified] ⚠️ 近期摘要·EventStore 源读取失败（非阻断）: ${(err as Error).message}`);
          }

          // 合并：taskRef 去重（EventStore 权威优先），按 archivedAt 倒序，取前 limit
          const seen = new Map<string, (typeof out)[number]>();
          for (const s of out) {
            const existing = seen.get(s.taskRef);
            if (!existing || (existing.source === 'persistence' && s.source === 'event-store')) {
              seen.set(s.taskRef, s);
            }
          }
          const merged = [...seen.values()]
            .sort((a, b) => b.archivedAt - a.archivedAt)
            .slice(0, limit);
          recentCache = { at: Date.now(), data: merged };
          return merged;
        },
      });
      assemblyEngine.setRiskGrader(defaultRiskGrader);

      // ═══ 会话 16i（RAG-lazy 装配）：相关性检索器接线 ═══
      // 源：ContextPersistence 装配快照 + EventStore 权威快照（loadRecentTasks）/ ExperienceMiner 事件 / 策略库。
      // 情境层用语义 Top-K 摘要 + 指针，替代"最近 N 条全量注入"（省 token + 语义相关保质量）。
      try {
        const { ContextRetriever } = await import('./knowledge/context/retrieval/ContextRetriever.js');
        const { ContextDistiller } = await import('./knowledge/context/retrieval/ContextDistiller.js');
        const retriever = new ContextRetriever({
          loadRecentTasks: async (limit: number) => {
            const out: Array<{ taskRef: string; goal?: string; result?: 'success' | 'failure'; summary?: string; archivedAt?: number }> = [];
            // 源① ContextPersistence 装配快照（有 focusedSummary 摘要）
            try {
              const persistence = container.getContextPersistence();
              if (persistence) {
                for (const snap of persistence.loadRecent(limit)) {
                  const session = (snap.layers?.session ?? {}) as Record<string, unknown>;
                  out.push({
                    taskRef: (session.taskRef as string) ?? snap.missionId,
                    summary: snap.focusedSummary,
                    archivedAt: snap.assembledAt,
                  });
                }
              }
            } catch { /* 单源失败不阻断 */ }
            // 源② EventStore 权威快照（goal + result）
            try {
              const es = container.eventStore;
              if (es) {
                await (es as unknown as { init?: () => Promise<void> }).init?.();
                for (const snap of await listRecentArchived(es, limit)) {
                  out.push({
                    taskRef: snap.taskRef,
                    goal: snap.goal,
                    result: snap.result,
                    archivedAt: snap.archivedAt,
                  });
                }
              }
            } catch { /* 单源失败不阻断 */ }
            return out;
          },
          getEvents: () => container.experienceMiner.getEvents(),
          getStrategies: () => container.promptStrategyRegistry.all(),
          // ═══ 会话 16k·4（Dense+Sparse+Cross-Encoder 流水线）：embeddingconfig.yaml 配置驱动 ═══
          // 可用（enabled+apiKey）→ 注入 similarityScorer（bge-m3 向量）+ reranker（bge-reranker 精排）；
          // 不可用 → 仅 Sparse(BM25) + 领域/新鲜度（SparseRetriever 内置，恒可用）。
          ...(await buildRetrievalComponents()),
        }, new ContextDistiller());
        assemblyEngine.setRetriever({
          retrieveRelevant: (goal: string, domain?: string, topK?: number) => retriever.retrieveRelevant(goal, domain, topK),
        });
        console.log('[bootstrapUnified] ✅ 相关性检索器已注入（RAG-lazy：情境层语义 Top-K + 指针 + embedding）');
      } catch (err) {
        console.warn('[bootstrapUnified] ⚠️ 相关性检索器注入失败（回退最近 N 全量）:', (err as Error).message);
      }

      console.log('[bootstrapUnified] ✅ 近期摘要读取器 + 风险分级 + 检索器已注入（双源 + 单查聚合 + 30s TTL 缓存）');
    } catch (err) {
      console.warn('[bootstrapUnified] ⚠️ 近期摘要读取器注入失败（非阻断）:', (err as Error).message);
    }

    console.log('[bootstrapUnified] ✅ ContextAssemblyEngine 已注入（聚焦模式 + 持久化 provider + 近期摘要/风险分级 + embedding 检索）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ ContextAssemblyEngine 注入失败（非阻断）:', (err as Error).message);
  }

  // ⬅️ 产物/图状态恢复：**懒加载**（17i.21）——启动不载入全部产物/图（O(1)，不随数据量增长）。
  //     ArtifactFacade / SystemMetadataGraph 在首次被读取时自动从 data/*.snapshot.json 合并加载；
  //     快照缺失/损坏时回退事件重放（restoreFromEvents 仍保留）。变更照常写 EventStore + 防抖落盘快照。
  //     ⚠️ 已移除：急切 restoreFromSnapshot/restoreFromEvents + Ontology projectAll（前者 O(N) 违背 O(1)，
  //     后者冗余——产物本就是 graph 的 'artifact' 实体，Ontology 查询直接读 graph.getEntities）。
  console.log('[bootstrapUnified] ⚡ 产物/图采用懒加载（启动 O(1)）');

  // ── Ontology 迭代4 ──
  const objectTypeRegistry = new ObjectTypeRegistry();
  const ontology = new OntologyService(systemMetadataGraph, objectTypeRegistry);
  // OntologyService 构造函数已调用 refreshCache()，加载了重建后的数据
  const forcedQueryGuard = new ForcedQueryGuard();

  // 功能③：注册真实数据 Provider（goal_graph 读真实 Goal / mission_state 读真实 Mission / 其余 4 种读真实数据，挂 taskRef）
  try {
    const { GoalGraphProvider, MissionStateProvider, ArtifactLineageProvider, DecisionHistoryProvider, UserProfileProvider, AgentStatusProvider } = await import('./knowledge/context/providers/realProviders.js');
    container.registerRealProviders(
      new GoalGraphProvider(ontology),
      new MissionStateProvider(container.missionController),
      new ArtifactLineageProvider(container.artifactFacade),
      new DecisionHistoryProvider(container.eventStore ?? null),
      new UserProfileProvider(ontology),
      new AgentStatusProvider(),
    );
    console.log('[bootstrapUnified] ✅ 真实上下文 Provider 已注册（goal_graph/mission_state/artifact_lineage/decision_history/user_profile/agent_status）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ 真实 Provider 注册失败（非阻断）:', (err as Error).message);
  }

  // ★★★ 注入 Ontology Gate 到通用原语 ★★★
  initializeOntologyGate(forcedQueryGuard, ontology, eventStore, eventBus);
  initializeOntologyGateForArtifact(forcedQueryGuard, ontology, eventStore, eventBus);
  console.log('[bootstrapUnified] ✅ Ontology Gate 已注入到 KnowledgeQueryPrimitive & ArtifactGenerationPrimitive');

  // ── 公司知识记忆（统一记忆层：cognee 引擎 + 确认队列 + 强制门禁）──
  try {
    const { createMemoryApi, createEngine } = await import('./infrastructure/adapters/memory/index.js');
    const { initializeCompanyMemory } = await import('./knowledge/memory/CompanyKnowledge.js');
    const { createMemoryActivationSource } = await import('./knowledge/memory/MemoryApiBus.js');
    const memoryEngine = createEngine();
    const memoryApi = createMemoryApi({ engine: memoryEngine });
    initializeCompanyMemory(memoryApi);
    // Studio 观测：记忆 API 挂到容器（类型安全字段，供 StudioServer 显式访问）
    container.companyMemoryApi = memoryApi as unknown as import('../../memory/src/api/MemoryApi.js').MemoryApi;
    // 记忆收敛：学习闭环（BrainFacade.learn）落库走统一层
    // （brainFacade 在后续装配段才创建，此处访问恒为 undefined——原 `?.` 从不执行，删除死代码）
    // ── L7 深水区：MemoryActivationEngine working 数据源统一到 MemoryAPI（装配层注入）──
    const { MemoryActivationEngine } = await import('./knowledge/memory/MemoryActivationEngine.js');
    const { setGlobalActivationEngine } = await import('./knowledge/memory/activationRegistry.js');
    const activationEngine = new MemoryActivationEngine();
    activationEngine.setSource(createMemoryActivationSource(memoryApi, memoryEngine));
    void activationEngine.refresh().then((r) => {
      console.log(`[bootstrapUnified] ✅ MemoryActivationEngine 已装配（source=MemoryAPI，首拉 ${r.loaded} 条，可用=${r.available}）`);
    });
    setGlobalActivationEngine(activationEngine);
    console.log('[bootstrapUnified] ✅ 公司知识记忆已接入（MemoryAPI + cognee 引擎，Ontology Gate 第5工具）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ 公司知识记忆接入失败（不阻断，QueryMiss 兜底）:', (err as Error).message);
  }

  // PiBridge 包装（带缓存 + 懒初始化）
  let piBridgeInstance: any = null;
  const piBridgeWrapper = {
    generateText: async (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => {
      if (!piBridgeInstance) {
        // ═══ 会话 16l（P0-2 连接复用）：复用进程级共享单例（此前每次 bootstrap 都 new + init）
        const { getSharedPiBridge } = await import('./infrastructure/adapters/pi-bridge/PiBridge.js');
        piBridgeInstance = getSharedPiBridge();
        await piBridgeInstance.init();
      }
      return piBridgeInstance.generateText({
        system: params.system,
        prompt: params.prompt,
        temperature: params.temperature,
        // ⚠️ 会话 10（GLM-only 修复）：此前 `?? 2000` 上限被 GLM 思考模式吃满 → content 空 →
        //    参数补全/提取返回空 → 原语缺参失败。与 PiBridge cfg 默认一致 32000（思考留足余量）。
        maxTokens: params.maxTokens ?? 32000,
      });
    },
    // ═══ 17i.32：流式闲聊生成 ═══
    generateChatStream: async (params: { system: string; prompt: string }, onDelta: (d: string) => void) => {
      if (!piBridgeInstance) {
        const { getSharedPiBridge } = await import('./infrastructure/adapters/pi-bridge/PiBridge.js');
        piBridgeInstance = getSharedPiBridge();
        await piBridgeInstance.init();
      }
      return piBridgeInstance.generateChatStream(params, onDelta);
    },
  };

  // 注入到 MorPexRuntime
  container.setOntology(ontology, forcedQueryGuard, piBridgeWrapper);

  // ═══ 意图分流接线：闲聊直答走引擎级 IntentClassifier（bootstrap 注入 LLM）═══
  const llmText = (system: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) =>
    piBridgeWrapper.generateText({ system, prompt, ...(opts ?? {}) }).then((r) => r.text);
  companyFacade.setLLMProvider(llmText);
  // ═══ 17i.32：闲聊流式生成 → 逐 token 转发 chat.stream.delta → SSE → 前端打字机 ═══
  companyFacade.setChatStreamer(async (system, prompt, _onDelta) => {
    const full = await piBridgeWrapper.generateChatStream({ system, prompt }, (delta) => {
      eventBus.emit({
        id: `evt_chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'chat.stream.delta',
        timestamp: Date.now(),
        executionId: 'chat',
        source: 'company-facade',
        payload: { delta },
      });
    });
    return full;
  });
  companyFacade.setGoalIntelligenceFacade(GoalIntelligenceFacade);
  GoalIntelligenceFacade.setLLM(llmText);

  // ── 架构全功能实现：接通第 6 层（Tools & Primitives）+ 第 10 层 connector ──
  // 1) 注入真实 piBridge → 原语路径的 Ontology Gate 两阶段推理不再空转
  setKqpBridge(piBridgeWrapper.generateText.bind(piBridgeWrapper));
  setAgpBridge(piBridgeWrapper.generateText.bind(piBridgeWrapper));

  // 2) 装配 ConnectorRegistry（第 10 层基础设施）：FileSystem + Shell 真实 connector
  const { resolve, join } = await import('path');
  const { ConnectorRegistry, FileSystemConnector, ShellConnector } = await import('@morpex/connectors');
  const connectorRegistry = new ConnectorRegistry();
  await connectorRegistry.register(new FileSystemConnector(resolve('data')));
  await connectorRegistry.register(new ShellConnector());
  // 默认放行规则（全功能实现：让 connector 可被原语执行；高风险动作仍需 ApprovalGate）
  connectorRegistry.addPermissionRule({ connectorPattern: 'filesystem', actionPattern: 'fs.*', allowedRoles: ['*'], destructive: false, requiresApproval: false });
  connectorRegistry.addPermissionRule({ connectorPattern: 'shell', actionPattern: 'shell.*', allowedRoles: ['*'], destructive: false, requiresApproval: false });
  console.log(`[bootstrapUnified] ✅ ConnectorRegistry 已装配（${[...connectorRegistry.list()].length} 个 connector + 默认权限规则）`);

  // 3) FileOperationPrimitive → ConnectorRegistry (fs.*，部门隔离：data/deliverables-<deptId>/)
  FileOperationPrimitive.setConnectorExecutor(async (action: string, params: Record<string, unknown>) => {
    const deptId = String(params.departmentId ?? params.deptId ?? 'global');
    const writePath = action === 'fs.write' ? join('data', `deliverables-${deptId}`, String(params.path ?? 'deliverable.txt')) : String(params.path ?? '');
    return connectorRegistry.execute({ action, params: { ...params, path: writePath }, executionId: 'layer6', timeout: 15000 });
  });

  // 4) ShellExecutionPrimitive → ConnectorRegistry (shell.exec)
  ShellExecutionPrimitive.setShellExecutor(async (p) =>
    connectorRegistry.execute({
      action: 'shell.exec',
      params: { command: p.command, args: p.args ?? [], cwd: p.cwd, timeout: p.timeout },
      executionId: 'shell',
      timeout: p.timeout ?? 30000,
    }),
  );

  // 5) APICallPrimitive → 内置 fetch HTTP 执行器（Node20 全局 fetch；无第三方 HTTP connector）
  APICallPrimitive.setHttpExecutor(async (p) => {
    try {
      const res = await fetch(p.url, {
        method: p.method,
        headers: p.headers,
        body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
        signal: p.timeout ? AbortSignal.timeout(p.timeout) : undefined,
      });
      return { success: res.ok, data: { status: res.status, body: await res.text() }, duration: 0 };
    } catch (err) {
      return { success: false, error: (err as Error).message, duration: 0 };
    }
  });

  // 6) 注入 LLM 生成器 + 文件写入器（文件经 FileOperationPrimitive 落盘）
  const fileOpPrimitive = new FileOperationPrimitive();
  ArtifactGenerationPrimitive.setLLMCaller((prompt: string) =>
    piBridgeWrapper.generateText({ prompt }).then((r) => r.text),
  );
  ArtifactGenerationPrimitive.setFileWriter(async (path: string, content: string, deptId: string, gateContext?) =>
    fileOpPrimitive.execute({ operation: 'write', path, content }, { departmentId: deptId, gateContext }),
  );

  // 7) 注册 5 个通用基础原语到 DomainPrimitiveRegistry（第 6 层注册中心）
  DomainPrimitiveRegistry.registerMultiple([
    new KnowledgeQueryPrimitive(),
    new FileOperationPrimitive(),
    new ArtifactGenerationPrimitive(),
    new ShellExecutionPrimitive(),
    new APICallPrimitive(),
  ]);

  // 8) NL→结构化参数提取器：简单任务路由到原语时，用 LLM 按 inputSchema 提取参数
  container.executionEngine.setParamExtractor(async (goal: string, primitiveName: string, inputSchema: Record<string, unknown>) => {
    try {
      const schemaJson = JSON.stringify(inputSchema ?? {}).slice(0, 800);
      // ═══ 参数补全层（50 任务实测：LLM 提取常缺必填字段 → 二次提取补全）═══
      // 会话 10（GLM-only）：思考模式鲁棒提取——先剥 ```json 代码块，再取首个 {...} 平衡括号，
      // 修复转义后 JSON.parse；仍失败 → 回退 {}（不抛，外层兜底）。
      const robustJsonExtract = (text: string): Record<string, unknown> => {
        if (!text) return {};
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const candidate = fence ? fence[1] : text;
        const match = candidate.match(/\{[\s\S]*\}/);
        if (!match) return {};
        try {
          const parsed = JSON.parse(match[0]);
          return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
        } catch {
          // 修复常见转义问题（\' → '，多余逗号）后重试
          try {
            const repaired = match[0].replace(/\\'/g, "'").replace(/,\s*}/g, '}');
            const parsed = JSON.parse(repaired);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
          } catch {
            return {};
          }
        }
      };
      const extract = async (missing?: string[]) => {
        const prompt = buildExtractPrompt(goal, primitiveName, schemaJson, missing);
        const res = await piBridgeWrapper.generateText({ prompt, temperature: 0 });
        return robustJsonExtract(res.text ?? '');
      };
      let params = await extract();
      const missing = validatePrimitiveParams(inputSchema ?? {}, params);
      if (missing.length > 0) {
        console.log(`[bootstrap] 🔄 参数补全层：${primitiveName} 缺必填字段 ${missing.join(', ')}，二次 LLM 补全`);
        const completed = await extract(missing);
        params = { ...params, ...completed };
      }
      return params;
    } catch { /* 提取失败回退 goal 透传 */ }
    return {};
  });
  console.log(`[bootstrapUnified] ✅ 第 6 层已接通：5 个通用原语注册 + 真实 PiBridge + ConnectorRegistry/fs/LLM 注入（注册中心共 ${DomainPrimitiveRegistry.list().length} 个原语）`);

  // 设置 Trace 事件钩子
  if (eventStore) {
    forcedQueryGuard.setOnTrace(async (executionId, trace, missionId) => {
      await eventStore.append(
        createQueryPerformedEvent(
          executionId,
          trace.toolCalls.map(({ name, args, at }: { name: string; args: unknown; at: number }) => ({ name, args, at })),
          Array.from(trace.retrievedObjectIds as Set<string>),
          missionId,
        ),
      );
    });
  }

  // ── 创建投影器 ──
  const missionProjector = new MissionProjector(ontology, {
    getAll: async () => {
      return container.missionController.getAllMissions().map(m => ({
        id: m.missionId,
        title: m.objective,
        status: m.status,
        phase: m.phase,
        goal: m.objective,
        departmentId: (m.currentTeams?.[0] as string) || '',
      }));
    },
    getById: async (id: string): Promise<Record<string, unknown> | null> => {
      const m = container.missionController.getMission(id);
      if (!m) return null;
      return {
        id: m.missionId,
        title: m.objective,
        status: m.status,
        phase: m.phase,
        goal: m.objective,
      };
    },
  });

  const artifactProjector = new ArtifactProjector(ontology, {
    getAll: async () => {
      return container.artifactFacade.getAll().map(a => ({
        id: a.id,
        title: a.name,
        status: a.status,
        missionId: a.sourceTask,
        type: a.type,
        version: a.version,
      }));
    },
    getById: async (id: string): Promise<Record<string, unknown> | null> => {
      const a = container.artifactFacade.get(id);
      if (!a) return null;
      return {
        id: a.id,
        title: a.name,
        status: a.status,
        missionId: a.sourceTask,
        type: a.type,
        version: a.version,
      };
    },
  });

  // ═══ 17i.21：移除启动急切 Ontology 投影（O(N)）——产物/实体本就是 graph 的 artifact/mission 实体，
  //     Ontology 查询直接读 graph.getEntities()，无需额外投影对象。项目器保留供按需调用。═══

  // ── 迭代3: FeedbackService ──
  const feedbackService = new FeedbackService(ontology);

  // ── vNext+: KnowledgeGapListener（QueryMiss → Feedback → Evolution 闭环）──
  const knowledgeGapListener = new KnowledgeGapListener({
    eventBus,
    feedbackService,
  });
  knowledgeGapListener.attach();
  console.log('[bootstrapUnified] ✅ KnowledgeGapListener 已挂载（QueryMiss → Feedback → Evolution）');

  // ── 架构全功能实现：接通第 4 层 Brain（ReflectionEngine + LearningLoop 单一学习入口）──
  const reflectionEngine = new ReflectionEngine(eventBus);
  reflectionEngine.setLLMCaller({
    generateText: async (opts: { prompt: string; maxTokens?: number; temperature?: number }) =>
      piBridgeWrapper.generateText({ prompt: opts.prompt, maxTokens: opts.maxTokens, temperature: opts.temperature ?? 0.3 }),
  });
  const learningLoop = new LearningLoop(eventBus);
  const brainSubscribe = (type: string, result: 'success' | 'failure') => {
    eventBus.on(type, (event: any) => {
      const p = event?.payload ?? {};
      const executionId = p.executionId ?? p.id ?? 'exec';
      const goal = p.goal ?? p.missionId ?? '';
      const taskRecord = {
        taskId: executionId,
        goal: typeof goal === 'string' ? goal : JSON.stringify(goal),
        result,
        duration: p.duration ?? 0,
        departmentId: p.departmentId,
      };
      void reflectionEngine.reflect({ recentTasks: [taskRecord] }).catch(() => {});
      void learningLoop.learnFromTask(taskRecord).catch(() => {});
    });
  };
  brainSubscribe(EventType.EXECUTION_COMPLETED, 'success');
  brainSubscribe(EventType.EXECUTION_FAILED, 'failure');
  brainSubscribe(EventType.MISSION_COMPLETED, 'success');
  brainSubscribe(EventType.MISSION_FAILED, 'failure');
  console.log('[bootstrapUnified] ✅ Brain 已接通：ReflectionEngine + LearningLoop 订阅执行/任务事件');

  // L4 全功能实现：BrainFacade 统一入口接入（executeGoal 完成后触发 learn 学习闭环）
  try {
    const { BrainFacade } = await import('./cognition/BrainFacade.js');
    const { getGlobalActivationEngine } = await import('./knowledge/memory/activationRegistry.js');
    const brainFacade = new BrainFacade(eventBus);
    // ═══ S22 审计修复：注入 reflectionEngine/learningLoop（此前字段 null，聚合门面空转）═══
    brainFacade.setReflectionEngine(reflectionEngine);
    brainFacade.setLearningLoop(learningLoop);
    // P1 收敛：learningEngine 键归 CrossAgentLearningEngine（ServiceContainer L208），
    // LearningLoop 仅挂 BrainFacade 专用键 brainLearningLoop，避免覆盖冲突
    // S20 完整重包：聚合记忆激活引擎（S18 装配产物经 activationRegistry 全局注册表读回，避免容器中转/跨作用域问题）
    const globalActivationEngine = getGlobalActivationEngine();
    if (globalActivationEngine) {
      // ⚠️ 接口契约桥接：MemoryActivationEngineLike.activate 接受 Record，真实引擎要求 ActivationContext（参数逆变）——
      // 属真实接口不匹配（Like 过宽）；类型适配 + 注释，接口对齐（Like 改用 ActivationContext）留后续。
      brainFacade.setMemoryActivationEngine?.(globalActivationEngine as unknown as import('./cognition/BrainFacade.js').MemoryActivationEngineLike);
    }
    companyFacade.setBrainFacade(brainFacade);
    // ═══ 治理接线：团队查询暴露（审计发现 TeamOrchestrator listTeams/getTeam 零消费）═══
    companyFacade.setTeamOrchestrator({
      listTeams: () => container.teamOrchestrator.listTeams(),
      getTeam: (id: string) => container.teamOrchestrator.getTeam(id),
    });
    // ═══ S22 审计修复：装配 CrossDepartmentKnowledgeSynthesizer（此前完全未接线）═══
    await import('./cognition/CrossDepartmentKnowledgeSynthesizer.js');
    console.log('[bootstrapUnified] ✅ L4 BrainFacade 统一入口已接入（executeGoal → brain.learn）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ BrainFacade 接入失败（不阻断）:', (err as Error).message);
  }

  // ── 架构全功能实现：接通 L7 Memory / L8 Evolution / L10 Observability ──
  // L7: MemoryWiki（SQLite 统一后端）—— P1 收敛：container.memoryWiki 死赋值已移除
  // 记忆统一走 MemoryAPI（bootstrap L185-207 已装配：cognee + 确认队列 + ForceRetrieve），
  // MemoryWiki 由 @morpex/memory 内部承载；需要直连 wiki 的消费点经 adapters/memory 桥。

  // L8: Evolution（ActiveEvolutionTrigger 构造即订阅 mission.completed/evaluation.scored；FailureAnalyzer 供批分析）
  const { ActiveEvolutionTrigger, FailureAnalyzer, EvolutionSandbox } = await import('./evolution/index.js');
  const activeEvolutionTrigger = new ActiveEvolutionTrigger(eventBus);
  // ═══ S22 审计修复：注入 SelfImprovementLoop → 激活 autoEvolve（此前永不触发）═══
  const { SelfImprovementLoop } = await import('./evolution/SelfImprovementLoop.js');
  const selfImprovementLoop = new SelfImprovementLoop();
  activeEvolutionTrigger.setSelfImprovementLoop(selfImprovementLoop);
  console.log('[bootstrapUnified] ✅ SelfImprovementLoop 已注入 ActiveEvolutionTrigger（autoEvolve 激活）');
  const _failureAnalyzer = new FailureAnalyzer();
  // vNext+ L8：演化安全沙箱（沙箱试跑 + 版本化 + 人工审批 + 回滚入口）
  const evolutionSandbox = new EvolutionSandbox({ eventStore: container.eventStore ?? undefined });
  activeEvolutionTrigger.setEvolutionSandbox(evolutionSandbox);
  console.log('[bootstrapUnified] ✅ L8 Evolution 已接通：ActiveEvolutionTrigger + EvolutionSandbox（沙箱/版本化/回滚）+ FailureAnalyzer');

  // L10: Observability（GovernanceDashboard 全量指标 + CostController 成本 + AlertEngine 告警）
  const { GovernanceDashboard, CostController, AlertEngine } = await import('./governance/index.js');
  const governanceDashboard = new GovernanceDashboard(eventBus);
  CostController.getInstance().init(eventBus);
  const _alertEngine = new AlertEngine(eventBus);
  // Studio 观测：治理面板挂到容器（类型安全字段，供 StudioServer 显式访问）
  container.governanceDashboard = governanceDashboard;
  console.log('[bootstrapUnified] ✅ L10 Observability 已接通：GovernanceDashboard + CostController + AlertEngine');

  // ── 架构全功能实现：接通 L3 Planning（DeliveryPlanner → MissionRuntime 规划阶段）──
  try {
    const { DeliveryPlanner, DeliveryPlannerAdapter } = await import('./cognition/planning/index.js');
    const { HierarchicalPlanner } = await import('./cognition/planning/HierarchicalPlanner.js');
    const { CrossDepartmentArbitrationEngine } = await import('./cognition/planning/CrossDepartmentArbitrationEngine.js');
    const deliveryPlanner = new DeliveryPlanner(eventBus);
    deliveryPlanner.setPiBridge(piBridgeWrapper);
    deliveryPlanner.setOntology(ontology);
    deliveryPlanner.setForcedQueryGuard(forcedQueryGuard);
    const hierarchicalPlanner = new HierarchicalPlanner(eventBus);
    hierarchicalPlanner.setPiBridge(piBridgeWrapper);
    const arbitration = new CrossDepartmentArbitrationEngine(eventBus);
    const missionPlanner = new DeliveryPlannerAdapter(deliveryPlanner, { hierarchicalPlanner, arbitration });
    container.missionRuntime.setPlanner(missionPlanner);
    // 统一规划：规划前置到 MorPexRuntime orchestrate 后（同一实例，MissionRuntime FSM 复用已有 plan 防重复）
    container.runtime.setPlanner(missionPlanner);
    console.log('[bootstrapUnified] ✅ L3 Planning 已接通：DeliveryPlanner + HierarchicalPlanner(HTN replan) + CrossDepartmentArbitration');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ L3 Planning 接入失败（不阻断）:', (err as Error).message);
  }

  // ── 事件监听（增量投影） ──
  eventBus.on(EventType.MISSION_CREATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); }
      catch (err) { console.warn(`[bootstrapUnified] ⚠️ MISSION_CREATED 增量投影失败 (id=${p.id ?? p.missionId}):`, (err as Error).message); }
    }
  });
  eventBus.on(EventType.MISSION_UPDATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); }
      catch (err) { console.warn(`[bootstrapUnified] ⚠️ MISSION_UPDATED 增量投影失败 (id=${p.id ?? p.missionId}):`, (err as Error).message); }
    }
  });
  eventBus.on(EventType.ARTIFACT_CREATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); }
      catch (err) { console.warn(`[bootstrapUnified] ⚠️ ARTIFACT_CREATED 增量投影失败 (id=${p.id ?? p.artifactId}):`, (err as Error).message); }
    }
  });
  eventBus.on(EventType.ARTIFACT_UPDATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); }
      catch (err) { console.warn(`[bootstrapUnified] ⚠️ ARTIFACT_UPDATED 增量投影失败 (id=${p.id ?? p.artifactId}):`, (err as Error).message); }
    }
  });

  console.log('[bootstrapUnified] ✅ v16 Unified Bootstrap 完成');
  console.log(`  ├─ Runtime: ${container.runtime.constructor.name}`);
  console.log(`  ├─ CompanyFacade: Runtime + ControlPlane 强制注入`);
  console.log(`  ├─ MissionController: 已接入管线`);
  console.log(`  ├─ CapabilityRegistry: ${CapabilityRegistry.getAll().length} 项能力`);
  console.log(`  ├─ VerificationEngine + ComplianceChecker + ApprovalGate: 已接入`);
  console.log(`  ├─ ExperienceMiner → CapabilityRegistry: 反馈已接通`);
  console.log(`  ├─ 🏁 Ontology: OntologyService + ForcedQueryGuard + Projectors`);
  console.log(`  └─ companyFacade.executeGoal(): 必经 ControlPlane → Runtime 完整管线`);
  console.log(`[bootstrapUnified] ⏱ 启动完成（${((Date.now() - __bt) / 1000).toFixed(1)}s）`);

  return {
    container,
    companyFacade,
    departmentManager,
    spaceService,
    mailbox,
    taskStateProjector,
    controlPlane: container.controlPlane,
    // ── Ontology ──
    ontology,
    forcedQueryGuard,
    objectTypeRegistry,
    missionProjector,
    artifactProjector,
    feedbackService,
  };
}

/**
 * buildEmbeddingScorer — 会话 16k：从 embeddingconfig.yaml 构建相似度评分器（非硬编码）。
 *
 * enabled=true 且 apiKey 可用 → 返回 EmbeddingProvider 向量余弦评分器（可异步）；否则 undefined（关键词回退）。
 * goal 向量按 goal 文本缓存（一次检索只 embedding 一次 goal）。
 */
/**
 * buildRetrievalComponents — 会话 16k·4：从 embeddingconfig.yaml 构建检索组件（非硬编码）。
 *
 * 返回 { similarityScorer?, reranker? }：
 *   - enabled + apiKey 可用 → Dense(bge-m3 向量余弦) + Cross-Encoder(bge-reranker 重排)
 *   - 否则 → undefined（ContextRetriever 回退 Sparse BM25 + 领域/新鲜度）
 * goal 向量按 goal 文本缓存；候选向量 Map 缓存（≤200 清空）。
 */
async function buildRetrievalComponents(): Promise<{
  similarityScorer?: (goal: string, candidate: string) => Promise<number>;
  reranker?: (query: string, docs: string[]) => Promise<Array<{ index: number; score: number }>>;
}> {
  const out: { similarityScorer?: (goal: string, candidate: string) => Promise<number>; reranker?: (query: string, docs: string[]) => Promise<Array<{ index: number; score: number }>> } = {};
  try {
    const { loadEmbeddingConfig } = await import('./infrastructure/adapters/pi-bridge/yamlConfig.js');
    const cfg = loadEmbeddingConfig();
    if (!cfg?.enabled || !cfg?.retrievalEnabled) return out;
    const { EmbeddingProvider } = await import('./infrastructure/adapters/embedding/EmbeddingProvider.js');
    const provider = new EmbeddingProvider(cfg);
    if (!provider.ready) {
      console.warn('[bootstrapUnified] ⚠️ embedding 未就绪（缺 apiKey）→ 仅 Sparse(BM25) 检索');
      return out;
    }
    // ── Dense：bi-encoder 余弦（goal 向量 + 候选向量缓存）──
    let goalVecCache: { goal: string; vec: number[] } | null = null;
    const candVecCache = new Map<string, number[]>();
    const MAX_CAND_CACHE = 200;
    const minScore = cfg.minScore ?? 0.3;
    out.similarityScorer = async (goal: string, candidate: string): Promise<number> => {
      if (!goalVecCache || goalVecCache.goal !== goal) {
        goalVecCache = { goal, vec: await provider.embedOne(goal) };
      }
      let cv = candVecCache.get(candidate);
      if (!cv) {
        cv = await provider.embedOne(candidate);
        if (candVecCache.size >= MAX_CAND_CACHE) candVecCache.clear();
        candVecCache.set(candidate, cv);
      }
      const sim = provider.cosine(goalVecCache.vec, cv);
      return Number.isFinite(sim) && sim >= minScore ? sim : 0;
    };
    // ── Cross-Encoder：bge-reranker 重排（Dense+Sparse RRF 后精排 Top-N）──
    if (cfg.rerankerEnabled && cfg.apiKey && cfg.baseUrl && cfg.rerankerModel) {
      try {
        const { Reranker } = await import('./knowledge/context/retrieval/Reranker.js');
        const reranker = new Reranker({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.rerankerModel, topN: cfg.rerankerTopN ?? 12 });
        out.reranker = async (query: string, docs: string[]): Promise<Array<{ index: number; score: number }>> => reranker.rerank(query, docs);
        console.log(`[bootstrapUnified] ✅ Cross-Encoder 重排已启用: model=${cfg.rerankerModel}`);
      } catch (err) {
        console.warn(`[bootstrapUnified] ⚠️ 重排器构建失败（跳过重排）: ${(err as Error).message}`);
      }
    }
    console.log(`[bootstrapUnified] ✅ Dense 检索已启用: model=${provider.model}（minScore=${minScore}）`);
    return out;
  } catch (err) {
    console.warn(`[bootstrapUnified] ⚠️ 检索组件构建失败（回退 Sparse BM25）: ${(err as Error).message}`);
    return out;
  }
}
