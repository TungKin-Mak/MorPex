/**
 * MorPex Unified Bootstrap — 唯一入口
 *
 * ═══ v16 Unified（取代 v12-v16 所有旧 bootstrap）═══
 *
 * 合并所有版本能力：
 *   v12 组织层: DepartmentManager / LeadAgent / GroupChat / ManagementHub
 *   v13 大脑层: ReflectionEngine / MetaLearner / HierarchicalPlanner / ToolFactory
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
 *   - 所有旧 bootstrap（v12-v16）标记 @deprecated
 */

import { ServiceContainer } from './runtime/ServiceContainer.js';
import { EventType } from './protocol/events/EventType.js';
import { CompanyFacade } from './facade/CompanyFacade.js';
import { DepartmentManager } from './department/DepartmentManager.js';
import { RoleRegistry } from './role/RoleRegistry.js';
import { CapabilityRegistry } from './capability/CapabilityRegistry.js';
import { systemMetadataGraph } from './metadata/SystemMetadataGraph.js';

// ── Ontology 迭代4 ──
import { OntologyService } from './ontology/OntologyService.js';
import { ForcedQueryGuard } from './ontology/ForcedQueryGuard.js';
import { ObjectTypeRegistry } from './ontology/ObjectTypeRegistry.js';
import {
  MissionProjector,
  ArtifactProjector,
} from './ontology/projectors/index.js';
import { createQueryPerformedEvent } from './events/ontologyEvents.js';
import { EvaluationEngine } from './evaluation/EvaluationEngine.js';
import { FeedbackService } from './ontology/FeedbackService.js';
import { FeedbackAwareLearner } from './cognition/FeedbackAwareLearner.js';

// ── Ontology Gate for Primitives ──
import { initializeOntologyGate, setPiBridge as setKqpBridge } from './tools/primitives/KnowledgeQueryPrimitive.js';
import { initializeOntologyGateForArtifact, setPiBridge as setAgpBridge } from './tools/primitives/ArtifactGenerationPrimitive.js';
import { KnowledgeGapListener } from './evolution/KnowledgeGapListener.js';
import { DomainPrimitiveRegistry } from './tools/DomainPrimitiveRegistry.js';
import {
  KnowledgeQueryPrimitive,
  FileOperationPrimitive,
  ArtifactGenerationPrimitive,
  ShellExecutionPrimitive,
  APICallPrimitive,
} from './tools/primitives/index.js';

// ── v16 模块 ──
import { SelfImprovementLoop } from './brain/SelfImprovementLoop.js';
import { ReflectionEngine } from './cognition/index.js';
import { MetaLearner } from './cognition/index.js';
import { ExecutionSimulator } from './simulation/ExecutionSimulator.js';
import { ApprovalGate } from './verification/ApprovalGate.js';
import { MissionController } from './mission-control/MissionController.js';
import { WorkflowRegistry as WorkflowPluginRegistry } from './workflow/WorkflowProvider.js';

import type { IEventStore } from './protocol/events/store/IEventStore.js';

export interface UnifiedBootstrapResult {
  container: ServiceContainer;
  companyFacade: CompanyFacade;
  departmentManager: DepartmentManager;
  controlPlane: import('./control-plane/ControlPlane.js').ControlPlane;

  // ── v12 兼容字段（StudioServer 需要） ──
  managementHub: import('./organization/ManagementHub.js').ManagementHub;
  groupChatManager: import('./interaction/GroupChatManager.js').GroupChatManager;
  leadAgentOrchestrator: import('./department/LeadAgentOrchestrator.js').LeadAgentOrchestrator;

  // ── Ontology ──
  ontology: OntologyService;
  forcedQueryGuard: ForcedQueryGuard;
  objectTypeRegistry: ObjectTypeRegistry;
  missionProjector: MissionProjector;
  artifactProjector: ArtifactProjector;
  feedbackService: FeedbackService;
  feedbackAwareLearner: FeedbackAwareLearner;
}

export async function bootstrapUnified(options?: {
  /** 外部传入的 EventStore（用于 Trace 事件写入） */
  eventStore?: IEventStore;
  /** CEO ID（可选，默认 'ceo-default'） */
  ceoId?: string;
}): Promise<UnifiedBootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';
  const eventStore = options?.eventStore;

  // 1. 初始化 CapabilityRegistry（内置能力）
  CapabilityRegistry.init();

  // 2. 创建 ServiceContainer（含所有服务 + MorPexRuntime + ControlPlane）
  const container = new ServiceContainer();

  // ⬅️ 尽早等待 EventStore 就绪，避免后续注册/写入竞态
  await container.ready;

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

  // 3.1 注册 Workflow 插件的 ActionPrimitive（理想架构第 9 层 → 第 6 层注册中心）
  try {
    const { bootstrapEcommerceWorkflow } = await import('../../workflows/ecommerce/src/bootstrap.js');
    const { bootstrapHardwareWorkflow } = await import('../../workflows/hardware/src/bootstrap.js');
    const { bootstrapSoftwareWorkflow } = await import('../../workflows/software/src/bootstrap.js');
    const { bootstrapXJMcuWorkflow } = await import('../../workflows/xjmcu/src/bootstrap.js');
    await Promise.all([
      bootstrapEcommerceWorkflow('ecommerce'),
      bootstrapHardwareWorkflow('hardware'),
      bootstrapSoftwareWorkflow('software'),
      bootstrapXJMcuWorkflow('xjmcu'),
    ]);
    console.log('[bootstrapUnified] ✅ 4 个 Workflow 插件的 ActionPrimitive 已注册');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ Workflow 插件 ActionPrimitive 注册失败:', (err as Error).message);
  }

  // 4. 注册 ArtifactFacade 到 ExecutionEngine（向后兼容）
  container.executionEngine.setArtifactFacade(container.artifactFacade);

  // 5. 创建 CompanyFacade（构造时强制要求 Runtime + ControlPlane）
  const eventBus = container.eventBus;
  const departmentManager = new DepartmentManager(eventBus);
  const roleRegistry = new RoleRegistry(eventBus);
  const companyFacade = new CompanyFacade(
    departmentManager,
    roleRegistry,
    container.runtime,
    container.controlPlane,
    ceoId,
  );

  // ⬅️ 从 EventStore 重建状态源（使状态可事件溯源）
  try {
    const es = (container as any)._eventStore as any;
    if (es) {
      // 重建 SystemMetadataGraph
      await systemMetadataGraph.restoreFromEvents(es);
      // 重建 ArtifactFacade
      if (typeof (container.artifactFacade as any).restoreFromEvents === 'function') {
        await (container.artifactFacade as any).restoreFromEvents(es);
      }
      // Ontology 由构造函数中的 refreshCache() 自动恢复
    }
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ 状态源重建失败:', (err as Error).message);
  }

  // ── Ontology 迭代4 ──
  const objectTypeRegistry = new ObjectTypeRegistry();
  const ontology = new OntologyService(systemMetadataGraph, objectTypeRegistry);
  // OntologyService 构造函数已调用 refreshCache()，加载了重建后的数据
  const forcedQueryGuard = new ForcedQueryGuard();

  // ★★★ 注入 Ontology Gate 到通用原语 ★★★
  initializeOntologyGate(forcedQueryGuard, ontology, eventStore, eventBus);
  initializeOntologyGateForArtifact(forcedQueryGuard, ontology, eventStore, eventBus);
  console.log('[bootstrapUnified] ✅ Ontology Gate 已注入到 KnowledgeQueryPrimitive & ArtifactGenerationPrimitive');

  // ── 公司知识记忆（统一记忆层：cognee 引擎 + 确认队列 + 强制门禁）──
  try {
    const { createMemoryApi, createEngine } = await import('./adapters/memory/index.js');
    const { initializeCompanyMemory } = await import('./memory/CompanyKnowledge.js');
    const { createMemoryApiBus, createMemoryActivationSource } = await import('./memory/MemoryApiBus.js');
    const memoryEngine = createEngine();
    const memoryApi = createMemoryApi({ engine: memoryEngine });
    initializeCompanyMemory(memoryApi);
    (container as any).companyMemoryApi = memoryApi;
    (container as any).memoryApiBus = createMemoryApiBus(memoryApi);
    // 记忆收敛：学习闭环（BrainFacade.learn）落库走统一层
    (container as any).brainFacade?.setMemoryApi?.(memoryApi);
    // ── L7 深水区：MemoryActivationEngine working 数据源统一到 MemoryAPI（装配层注入）──
    const { MemoryActivationEngine } = await import('./memory/MemoryActivationEngine.js');
    const { setGlobalActivationEngine } = await import('./memory/activationRegistry.js');
    const activationEngine = new MemoryActivationEngine();
    activationEngine.setSource(createMemoryActivationSource(memoryApi, memoryEngine));
    void activationEngine.refresh().then((r) => {
      console.log(`[bootstrapUnified] ✅ MemoryActivationEngine 已装配（source=MemoryAPI，首拉 ${r.loaded} 条，可用=${r.available}）`);
    });
    setGlobalActivationEngine(activationEngine);
    (container as any).memoryActivationEngine = activationEngine;
    console.log('[bootstrapUnified] ✅ 公司知识记忆已接入（MemoryAPI + cognee 引擎，Ontology Gate 第5工具）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ 公司知识记忆接入失败（不阻断，QueryMiss 兜底）:', (err as Error).message);
  }

  // PiBridge 包装（带缓存 + 懒初始化）
  let piBridgeInstance: any = null;
  const piBridgeWrapper = {
    generateText: async (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => {
      if (!piBridgeInstance) {
        const { PiBridge, DEFAULT_MODEL } = await import('./adapters/pi-bridge/PiBridge.js');
        piBridgeInstance = new PiBridge(DEFAULT_MODEL);
        await piBridgeInstance.init();
      }
      return piBridgeInstance.generateText({
        system: params.system,
        prompt: params.prompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens ?? 2000,
      });
    },
  };

  // 注入到 MorPexRuntime
  container.setOntology(ontology, forcedQueryGuard, piBridgeWrapper);

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
    return connectorRegistry.execute({ action, params: { ...params, path: writePath }, executionId: 'layer6', timeout: 15000 } as never);
  });

  // 4) ShellExecutionPrimitive → ConnectorRegistry (shell.exec)
  ShellExecutionPrimitive.setShellExecutor(async (p) =>
    connectorRegistry.execute({
      action: 'shell.exec',
      params: { command: p.command, args: p.args ?? [], cwd: p.cwd, timeout: p.timeout },
      executionId: 'shell',
      timeout: p.timeout ?? 30000,
    } as never),
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
    piBridgeWrapper.generateText({ prompt, maxTokens: 2000 }).then((r) => r.text),
  );
  ArtifactGenerationPrimitive.setFileWriter(async (path: string, content: string, deptId: string) =>
    fileOpPrimitive.execute({ operation: 'write', path, content }, { departmentId: deptId }),
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
      const res = await piBridgeWrapper.generateText({
        prompt: `根据原语 "${primitiveName}" 的输入 Schema，从任务描述中提取参数并只输出 JSON 对象。\n任务: ${goal}\nSchema: ${schemaJson}\n输出 JSON:`, maxTokens: 300, temperature: 0,
      });
      const match = res.text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
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

  // 初始投影
  try {
    const mCount = await missionProjector.projectAll();
    const aCount = await artifactProjector.projectAll();
    console.log(`[bootstrapUnified] 📊 Ontology 投影完成: ${mCount} Mission, ${aCount} Artifact`);
  } catch (err) {
    console.warn(`[bootstrapUnified] ⚠️ Ontology 投影失败:`, (err as Error).message);
  }

  // ── 迭代3: FeedbackService ──
  const feedbackService = new FeedbackService(ontology);

  // ── 迭代4: FeedbackAwareLearner ──
  const feedbackAwareLearner = new FeedbackAwareLearner(eventStore ?? undefined);

  // ── vNext+: KnowledgeGapListener（QueryMiss → Feedback → Evolution 闭环）──
  const knowledgeGapListener = new KnowledgeGapListener({
    eventBus,
    feedbackService,
  });
  knowledgeGapListener.attach();
  console.log('[bootstrapUnified] ✅ KnowledgeGapListener 已挂载（QueryMiss → Feedback → Evolution）');

  // ── 架构全功能实现：接通第 4 层 Brain（ReflectionEngine + MetaLearner）──
  const reflectionEngine = new ReflectionEngine(eventBus);
  reflectionEngine.setLLMCaller({
    generateText: async (opts: { prompt: string; maxTokens?: number; temperature?: number }) =>
      piBridgeWrapper.generateText({ prompt: opts.prompt, maxTokens: opts.maxTokens ?? 500, temperature: opts.temperature ?? 0.3 }),
  });
  const metaLearner = new MetaLearner(eventBus);
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
      void metaLearner.learnFromTask(taskRecord).catch(() => {});
    });
  };
  brainSubscribe(EventType.EXECUTION_COMPLETED, 'success');
  brainSubscribe(EventType.EXECUTION_FAILED, 'failure');
  brainSubscribe(EventType.MISSION_COMPLETED, 'success');
  brainSubscribe(EventType.MISSION_FAILED, 'failure');
  console.log('[bootstrapUnified] ✅ Brain 已接通：ReflectionEngine + MetaLearner 订阅执行/任务事件');

  // L4 全功能实现：BrainFacade 统一入口接入（executeGoal 完成后触发 learn 学习闭环）
  try {
    const { BrainFacade } = await import('./cognition/BrainFacade.js');
    const brainFacade = new BrainFacade(eventBus);
    // ═══ S22 审计修复：注入 reflectionEngine/metaLearner（此前字段 null，聚合门面空转）═══
    brainFacade.setReflectionEngine(reflectionEngine);
    brainFacade.setMetaLearner(metaLearner);
    // ═══ S22 审计补全：真实 LearningLoop 实现（此前 learningEngine 容器从未赋值）═══
    const { LearningLoop } = await import('./learning/LearningLoop.js');
    const learningLoop = new LearningLoop();
    brainFacade.setLearningLoop(learningLoop);
    (container as any).learningEngine = learningLoop;
    (container as any).brainLearningLoop = learningLoop;
    // S20 完整重包：聚合记忆激活引擎（S18 装配产物）
    brainFacade.setMemoryActivationEngine?.((container as any).memoryActivationEngine);
    companyFacade.setBrainFacade(brainFacade);
    (container as any).brainFacade = brainFacade;
    // ═══ S22 审计修复：装配 CrossDepartmentKnowledgeSynthesizer（此前完全未接线）═══
    const { CrossDepartmentKnowledgeSynthesizer } = await import('./brain/CrossDepartmentKnowledgeSynthesizer.js');
    (container as any).crossDeptSynthesizer = new CrossDepartmentKnowledgeSynthesizer(eventBus);
    console.log('[bootstrapUnified] ✅ L4 BrainFacade 统一入口已接入（executeGoal → brain.learn）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ BrainFacade 接入失败（不阻断）:', (err as Error).message);
  }

  // ── 架构全功能实现：接通 L7 Memory / L8 Evolution / L10 Observability ──
  // L7: MemoryWiki（SQLite 统一后端）
  try {
    const { MemoryWiki } = await import('@morpex/memory');
    const memoryWiki = new MemoryWiki({ dbPath: 'data/memory/wiki.db' });
    await memoryWiki.initialize();
    (container as any).memoryWiki = memoryWiki;
    console.log('[bootstrapUnified] ✅ L7 MemoryWiki 已初始化（SQLite-only）');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ L7 MemoryWiki 初始化失败（不阻断）:', (err as Error).message);
  }

  // L8: Evolution（ActiveEvolutionTrigger 构造即订阅 mission.completed/evaluation.scored；FailureAnalyzer 供批分析）
  const { ActiveEvolutionTrigger, FailureAnalyzer, EvolutionSandbox } = await import('./evolution/index.js');
  const activeEvolutionTrigger = new ActiveEvolutionTrigger(eventBus);
  // ═══ S22 审计修复：注入 SelfImprovementLoop → 激活 autoEvolve（此前永不触发）═══
  const { SelfImprovementLoop } = await import('./brain/SelfImprovementLoop.js');
  const selfImprovementLoop = new SelfImprovementLoop();
  activeEvolutionTrigger.setSelfImprovementLoop(selfImprovementLoop);
  (container as any).selfImprovementLoop = selfImprovementLoop;
  console.log('[bootstrapUnified] ✅ SelfImprovementLoop 已注入 ActiveEvolutionTrigger（autoEvolve 激活）');
  const failureAnalyzer = new FailureAnalyzer();
  // vNext+ L8：演化安全沙箱（沙箱试跑 + 版本化 + 人工审批 + 回滚入口）
  const evolutionSandbox = new EvolutionSandbox({ eventStore: (container as any)._eventStore ?? undefined });
  activeEvolutionTrigger.setEvolutionSandbox(evolutionSandbox);
  (container as any).activeEvolutionTrigger = activeEvolutionTrigger;
  (container as any).failureAnalyzer = failureAnalyzer;
  (container as any).evolutionSandbox = evolutionSandbox;
  console.log('[bootstrapUnified] ✅ L8 Evolution 已接通：ActiveEvolutionTrigger + EvolutionSandbox（沙箱/版本化/回滚）+ FailureAnalyzer');

  // L10: Observability（GovernanceDashboard 全量指标 + CostController 成本 + AlertEngine 告警）
  const { GovernanceDashboard, CostController, AlertEngine } = await import('./governance/index.js');
  const governanceDashboard = new GovernanceDashboard(eventBus);
  CostController.getInstance().init(eventBus);
  const alertEngine = new AlertEngine(eventBus);
  (container as any).governanceDashboard = governanceDashboard;
  (container as any).alertEngine = alertEngine;
  console.log('[bootstrapUnified] ✅ L10 Observability 已接通：GovernanceDashboard + CostController + AlertEngine');

  // ── 架构全功能实现：接通 L3 Planning（DeliveryPlanner → MissionRuntime 规划阶段）──
  try {
    const { DeliveryPlanner, DeliveryPlannerAdapter } = await import('./planner/index.js');
    const { HierarchicalPlanner } = await import('./planner/HierarchicalPlanner.js');
    const { CrossDepartmentArbitrationEngine } = await import('./planner/CrossDepartmentArbitrationEngine.js');
    const deliveryPlanner = new DeliveryPlanner(eventBus);
    deliveryPlanner.setPiBridge(piBridgeWrapper);
    deliveryPlanner.setOntology(ontology);
    deliveryPlanner.setForcedQueryGuard(forcedQueryGuard);
    const hierarchicalPlanner = new HierarchicalPlanner(eventBus);
    (hierarchicalPlanner as any).setPiBridge?.(piBridgeWrapper);
    const arbitration = new CrossDepartmentArbitrationEngine(eventBus);
    container.missionRuntime.setPlanner(new DeliveryPlannerAdapter(deliveryPlanner, { hierarchicalPlanner, arbitration }));
    // L3 非 Mission 路径接入：CompanyFacade 的 auto/dag/fabric 模式先规划再执行（失败不阻断）
    companyFacade.setDeliveryPlanner?.(deliveryPlanner);
    // S20 完整重包：BrainFacade 也聚合规划能力
    (container as any).brainFacade?.setDeliveryPlanner?.(deliveryPlanner);
    (container as any).deliveryPlanner = deliveryPlanner;
    (container as any).hierarchicalPlanner = hierarchicalPlanner;
    (container as any).arbitrationEngine = arbitration;
    console.log('[bootstrapUnified] ✅ L3 Planning 已接通：DeliveryPlanner + HierarchicalPlanner(HTN replan) + CrossDepartmentArbitration');
  } catch (err) {
    console.warn('[bootstrapUnified] ⚠️ L3 Planning 接入失败（不阻断）:', (err as Error).message);
  }

  // ── 事件监听（增量投影） ──
  eventBus.on(EventType.MISSION_CREATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); } catch {}
    }
  });
  eventBus.on(EventType.MISSION_UPDATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); } catch {}
    }
  });
  eventBus.on(EventType.ARTIFACT_CREATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); } catch {}
    }
  });
  eventBus.on(EventType.ARTIFACT_UPDATED, async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); } catch {}
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

  // ── v12 兼容字段（全功能实现修复：先构造依赖再装配 ManagementHub，避免 null orchestrator 崩溃）──
  const { ManagementHub } = await import('./organization/ManagementHub.js');
  const { GroupChatManager } = await import('./interaction/GroupChatManager.js');
  const { LeadAgentOrchestrator } = await import('./department/LeadAgentOrchestrator.js');
  const groupChatManager = new GroupChatManager(eventBus);
  const leadAgentOrchestrator = new LeadAgentOrchestrator(eventBus, departmentManager, roleRegistry);
  const managementHub = new ManagementHub(eventBus, departmentManager, leadAgentOrchestrator, groupChatManager, ceoId);

  return {
    container,
    companyFacade,
    departmentManager,
    controlPlane: container.controlPlane,
    // ── v12 兼容字段 ──
    managementHub,
    groupChatManager,
    leadAgentOrchestrator,
    // ── Ontology ──
    ontology,
    forcedQueryGuard,
    objectTypeRegistry,
    missionProjector,
    artifactProjector,
    feedbackService,
    feedbackAwareLearner,
  };
}
