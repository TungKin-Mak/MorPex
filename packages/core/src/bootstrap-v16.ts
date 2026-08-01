/**
 * @deprecated 请使用 bootstrapUnified() from bootstrap-unified.js
 * v16 Bootstrap — v15 + MissionControl + CapabilityRegistry + Simulation + ApprovalGate
 * 
 * 此文件保留向后兼容，但不再作为新入口使用。
 *
 * v16 新增:
 *   - mission-control/MissionController (项目总控)
 *   - capability/CapabilityRegistry + CapabilityDiscoverer (能力目录)
 *   - simulation/ExecutionSimulator (执行计划模拟)
 *   - verification/ApprovalGate (合规→审批门)
 *   - artifact/ArtifactFacade 全生命周期升级
 *   - SelfImprovementLoop + Simulator 集成
 *   - DynamicTeamOrchestrator 能力优先编排
 */

import { EventBus } from './common/EventBus.js';
import type { MorPexEvent } from './common/types.js';
import { DepartmentManager } from './department/DepartmentManager.js';
import { LeadAgentOrchestrator } from './department/LeadAgentOrchestrator.js';
import { RoleRegistry } from './role/RoleRegistry.js';
import { CompanyFacade } from './facade/CompanyFacade.js';
import { OrganizationContextLite } from './organization/OrganizationContextLite.js';
import { ManagementHub } from './organization/ManagementHub.js';
import { GroupChatManager } from './interaction/GroupChatManager.js';
import { UnifiedExecutionEngine } from './execution/UnifiedExecutionEngine.js';
import { DeliveryPlanner } from './planner/DeliveryPlanner.js';
import { SubAgentFork } from './execution/SubAgentFork.js';
import { BrainFacade } from './cognition/BrainFacade.js';
import { DepartmentMemoryAdapter } from './department/DepartmentMemoryAdapter.js';
import { SOPEngine } from './evolution/SOPEngine.js';
import { DepartmentKPITracker } from './department/DepartmentKPITracker.js';
import { ReflectionEngine } from './cognition/ReflectionEngine.js';
import { MetaLearner } from './cognition/MetaLearner.js';
import { HierarchicalPlanner } from './planner/HierarchicalPlanner.js';
import { ToolFactory } from './tools/ToolFactory.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { GovernanceDashboard } from './governance/GovernanceDashboard.js';
import { ToolQualityTracker } from './common/ToolQualityTracker.js';
import { GoalIntelligenceFacade } from './goal-intelligence/GoalIntelligenceFacade.js';
import { ArtifactFacade } from './artifact/ArtifactFacade.js';
import { VerificationEngine } from './verification/VerificationEngine.js';
import { ExperienceMiner } from './experience/ExperienceMiner.js';
import { DynamicTeamOrchestrator } from './organization/DynamicTeamOrchestrator.js';
import { WorkflowRegistry as WorkflowPluginRegistry } from './workflow/WorkflowProvider.js';
import { ComplianceChecker } from './verification/ComplianceChecker.js';
import { RuntimeManager } from './governance/RuntimeManager.js';
import { CostController } from './governance/CostController.js';
import { AlertEngine } from './governance/AlertEngine.js';
import { SelfImprovementLoop } from './cognition/SelfImprovementLoop.js';
import { CapabilityRegistry } from './capability/CapabilityRegistry.js';
import { MissionController } from './mission-control/MissionController.js';
import { ExecutionSimulator } from './simulation/ExecutionSimulator.js';
import { ApprovalGate } from './verification/ApprovalGate.js';

// ── Ontology 迭代1/2 ──
import { OntologyService } from './ontology/OntologyService.js';
import { ForcedQueryGuard } from './ontology/ForcedQueryGuard.js';
import { ObjectTypeRegistry } from './ontology/ObjectTypeRegistry.js';
import { systemMetadataGraph } from './metadata/SystemMetadataGraph.js';
import {
  MissionProjector,
  ArtifactProjector,
} from './ontology/projectors/index.js';
import { createQueryPerformedEvent } from './events/ontologyEvents.js';
import type { IEventStore } from './protocol/events/store/IEventStore.js';
import { FeedbackAwareLearner } from './cognition/FeedbackAwareLearner.js';

export interface V16BootstrapResult {
  eventBus: EventBus;
  departmentManager: DepartmentManager;
  roleRegistry: RoleRegistry;
  companyFacade: CompanyFacade;
  leadAgentOrchestrator: LeadAgentOrchestrator;
  groupChatManager: GroupChatManager;
  managementHub: ManagementHub;
  unifiedExecutionEngine: UnifiedExecutionEngine;
  deliveryPlanner: DeliveryPlanner;
  subAgentFork: SubAgentFork;
  orgContext: OrganizationContextLite;
  brainFacade: BrainFacade;
  sopEngine: SOPEngine;
  kpiTracker: DepartmentKPITracker;
  reflectionEngine: ReflectionEngine;
  metaLearner: MetaLearner;
  hierarchicalPlanner: HierarchicalPlanner;
  toolFactory: ToolFactory;
  governanceDashboard: GovernanceDashboard;
  toolQualityTracker: ToolQualityTracker;
  goalIntelligenceFacade: GoalIntelligenceFacade;
  artifactFacade: ArtifactFacade;
  verificationEngine: VerificationEngine;
  experienceMiner: ExperienceMiner;
  dynamicTeamOrchestrator: DynamicTeamOrchestrator;
  complianceChecker: ComplianceChecker;
  runtimeManager: RuntimeManager;
  costController: CostController;
  alertEngine: AlertEngine;
  selfImprovementLoop: SelfImprovementLoop;
  capabilityRegistry: typeof CapabilityRegistry;
  missionController: MissionController;
  executionSimulator: ExecutionSimulator;
  approvalGate: ApprovalGate;

  // ── Ontology 迭代1 ──
  ontology: OntologyService;
  forcedQueryGuard: ForcedQueryGuard;

  // ── Ontology 迭代2 ──
  objectTypeRegistry: ObjectTypeRegistry;
  missionProjector: MissionProjector;
  artifactProjector: ArtifactProjector;

  // ── Ontology 迭代3 ──
  feedbackService: import('./ontology/FeedbackService.js').FeedbackService;

  // ── Ontology 迭代4 ──
  feedbackAwareLearner: FeedbackAwareLearner;
}

export async function bootstrapV16(
  eventBus: EventBus,
  options?: { ceoId?: string; eventStore?: IEventStore },
): Promise<V16BootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';
  const eventStore = options?.eventStore;

  // ── 基础设施 ──
  const departmentManager = new DepartmentManager(eventBus);
  const roleRegistry = new RoleRegistry(eventBus);
  const orgContext = OrganizationContextLite.getInstance();
  const groupChatManager = new GroupChatManager(eventBus);
  const leadAgentOrchestrator = new LeadAgentOrchestrator(eventBus, departmentManager, roleRegistry);
  const unifiedExecutionEngine = new UnifiedExecutionEngine(eventBus);
  const deliveryPlanner = new DeliveryPlanner(eventBus);
  const subAgentFork = new SubAgentFork(eventBus);
  const departmentMemoryAdapter = new DepartmentMemoryAdapter();
  const brainFacade = new BrainFacade(eventBus);
  brainFacade.setMemoryWiki(departmentMemoryAdapter.createWikiWrapper());
  const sopEngine = new SOPEngine(eventBus);
  const kpiTracker = new DepartmentKPITracker(eventBus);
  brainFacade.setSOPEngine(sopEngine);

  // ── v13 ──
  const reflectionEngine = new ReflectionEngine(eventBus);
  const metaLearner = new MetaLearner(eventBus);
  brainFacade.setReflectionEngine(reflectionEngine);
  brainFacade.setMetaLearner(metaLearner);
  const hierarchicalPlanner = new HierarchicalPlanner(eventBus);
  hierarchicalPlanner.setBrainFacade(brainFacade);
  deliveryPlanner.setHierarchicalPlanner(hierarchicalPlanner);
  ToolRegistry.init(eventBus);
  const toolFactory = new ToolFactory(eventBus);
  const governanceDashboard = new GovernanceDashboard(eventBus);
  const toolQualityTracker = new ToolQualityTracker();
  toolQualityTracker.connectToRegistry(eventBus);

  // ── v14 ──
  const goalIntelligenceFacade = new GoalIntelligenceFacade();
  const artifactFacade = new ArtifactFacade(eventBus);
  unifiedExecutionEngine.setArtifactFacade(artifactFacade as any);
  const verificationEngine = new VerificationEngine();
  const experienceMiner = new ExperienceMiner();

  // ── v15 ──
  const dynamicTeamOrchestrator = new DynamicTeamOrchestrator();
  dynamicTeamOrchestrator.setWorkflowRegistry(WorkflowPluginRegistry);
  const complianceChecker = new ComplianceChecker();
  RuntimeManager.getInstance().init(eventBus);
  CostController.getInstance().init(eventBus);
  AlertEngine.getInstance().init(eventBus);
  const selfImprovementLoop = new SelfImprovementLoop();

  // ════════════════════════════════════════════════════════
  // v16 新模块
  // ════════════════════════════════════════════════════════

  // Capability Registry
  CapabilityRegistry.init();

  // Mission Control
  const missionController = new MissionController(eventBus);

  // Simulation
  const executionSimulator = new ExecutionSimulator();

  // Approval Gate
  const approvalGate = new ApprovalGate(eventBus);

  // Wire SelfImprovementLoop with Simulation
  selfImprovementLoop.setSimulator({
    simulate: async (proposal, currentMetrics) => {
      const result = executionSimulator.simulate({
        plan: { steps: [{ name: proposal.title, estimatedDuration: 86400000, capabilities: ['execute'] }] },
        capabilities: CapabilityRegistry.getAll(),
        constraints: {},
      });
      return {
        estimatedImprovement: result.feasible ? 0.15 : 0,
        riskLevel: result.riskLevel,
        sideEffects: result.warnings,
        confidence: result.feasible ? 0.7 : 0.3,
      };
    },
  });

  // ── Ontology 迭代1/2/3 ──
  const objectTypeRegistry = new ObjectTypeRegistry();
  const ontology = new OntologyService(systemMetadataGraph, objectTypeRegistry);
  const forcedQueryGuard = new ForcedQueryGuard();

  // FeedbackService（迭代3）
  const { FeedbackService } = await import('./ontology/FeedbackService.js');
  const feedbackService = new FeedbackService(ontology);

  // FeedbackAwareLearner（迭代4 — 进化信号分析，注入 EventStore）
  const feedbackAwareLearner = new FeedbackAwareLearner(eventStore ?? undefined);

  // PiBridge 单例（迭代4 — 避免每次 grounded 调用新建+init）
  let piBridgeInstance: any = null;
  const piBridgeForOntology = {
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

  // ── CEO 门面 ──
  const companyFacade = new CompanyFacade(departmentManager, roleRegistry, ceoId);
  companyFacade.setGoalIntelligenceFacade(goalIntelligenceFacade as any);
  companyFacade.setFeedbackService(feedbackService);
  companyFacade.setOntology(ontology, forcedQueryGuard, piBridgeForOntology);
  const managementHub = new ManagementHub(eventBus, departmentManager, leadAgentOrchestrator, groupChatManager, ceoId);

  // ── Ontology 注入 ──
  deliveryPlanner.setOntology(ontology);
  deliveryPlanner.setForcedQueryGuard(forcedQueryGuard);
  hierarchicalPlanner.setOntology(ontology);
  hierarchicalPlanner.setForcedQueryGuard(forcedQueryGuard);
  hierarchicalPlanner.setOntologyGroundingEnabled(true);

  // 设置 Trace 事件钩子（注入的 EventStore，非 globalThis）
  if (eventStore) {
    forcedQueryGuard.setOnTrace(async (executionId, trace, missionId) => {
      await eventStore.append(
        createQueryPerformedEvent(
          executionId,
          trace.toolCalls.map(({ name, args, at }) => ({ name, args, at })),
          Array.from(trace.retrievedObjectIds),
          missionId,
        ),
      );
    });
  }

  // 创建投影器（数据源: MissionController + ArtifactFacade，非 Graph 自投影）
  const missionProjector = new MissionProjector(ontology, {
    getAll: async () => {
      return missionController.getAllMissions().map(m => ({
        id: m.missionId,
        title: m.objective,
        status: m.status,
        phase: m.phase,
        goal: m.objective,
        departmentId: m.currentTeams[0],
      }));
    },
    getById: async (id: string): Promise<Record<string, unknown> | null> => {
      const m = missionController.getMission(id);
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
      return artifactFacade.getAll().map(a => ({
        id: a.id,
        title: a.name,
        status: a.status,
        missionId: a.sourceTask,
        type: a.type,
        version: a.version,
      }));
    },
    getById: async (id: string): Promise<Record<string, unknown> | null> => {
      const a = artifactFacade.get(id);
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

  // 启动时执行投影
  try {
    const mCount = await missionProjector.projectAll();
    const aCount = await artifactProjector.projectAll();
    console.log(`[bootstrapV16] 📊 Ontology 投影完成: ${mCount} Mission, ${aCount} Artifact`);
  } catch (err) {
    console.warn(`[bootstrapV16] ⚠️ Ontology 投影失败:`, (err as Error).message);
  }

  // ── 依赖注入（含 Ontology 迭代3 grounded reasoning）──
  subAgentFork.setExecutionEngine({
    execute: async (capability: string, params: Record<string, unknown>, context?: Record<string, unknown>) => {
      // 迭代3：对关键执行进行 ontology grounding
      // P2.7: 跳过简单/只读能力，减少不必要的两阶段 LLM 调用
      const skipCaps = new Set(['read', 'write', 'list', 'search', 'format', 'translate', 'echo']);
      const shouldSkip = skipCaps.has(capability.toLowerCase()) || context?.skipOntologyGrounding === true;
      if (!shouldSkip && context?.enableOntologyGrounding !== false && ontology && forcedQueryGuard) {
        try {
          const { runOntologyGroundedReasoning } = await import('./ontology/runOntologyGroundedReasoning.js');
          const result = await runOntologyGroundedReasoning({
            goal: capability,
            missionId: context?.missionId as string | undefined,
            ontology,
            guard: forcedQueryGuard,
            piBridge: piBridgeForOntology,
            extraContext: `SubAgent 执行前 ontology grounding。`,
            eventStore,
            scenario: 'subagent-exec',
          });
          // 将 grounding 结果注入 context
          (params as Record<string, unknown>).__ontologyTrace = result.queryTrace;
        } catch (err) {
          console.warn(`[SubAgentFork] ⚠️ Ontology grounding 失败，继续执行:`, (err as Error).message);
        }
      }

      const result = await unifiedExecutionEngine.execute({
        goal: capability, mode: 'auto',
        context: { ...params, ...context },
        departmentId: (context?.departmentId as string) || undefined,
      });
      return result.output ?? result;
    },
  });

  deliveryPlanner.setSOPEngine(sopEngine);
  deliveryPlanner.setBrainFacade(brainFacade);

  // 注入 PiBridge 到 DeliveryPlanner 和 HierarchicalPlanner（用于 ontology 强制查询的 LLM 调用）
  deliveryPlanner.setPiBridge(piBridgeForOntology);
  hierarchicalPlanner.setPiBridge(piBridgeForOntology);
  await managementHub.initialize();
  leadAgentOrchestrator.setBrainFacade(brainFacade);
  companyFacade.setBrainFacade(brainFacade);

  // ── 事件监听 ──
  eventBus.on('brain.learn.request', (event: MorPexEvent) => {
    const exp = event.payload;
    if (exp) brainFacade.learn(exp).catch((err: Error) => console.warn("[bootstrapV16] brainFacade.learn failed:", err.message));
  });
  eventBus.on('department.task.completed', (event: MorPexEvent) => {
    const p = event.payload;
    if (!p?.departmentId) return;
    kpiTracker.incrementMetric(p.departmentId, 'tasks_completed');
    if (!kpiTracker.getHealth(p.departmentId)) {
      kpiTracker.registerDepartment(p.departmentId, p.departmentName ?? p.departmentId);
    }
  });
  eventBus.on('department.created', (event: MorPexEvent) => {
    const dept = event.payload?.department;
    if (dept) kpiTracker.registerDepartment(dept.id, dept.name);
  });

  // ── Ontology 增量投影（运行时保持 Ontology 新鲜）──
  eventBus.on('mission.created', async (event: MorPexEvent) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); } catch {}
    }
  });
  eventBus.on('mission.updated', async (event: MorPexEvent) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); } catch {}
    }
  });
  eventBus.on('artifact.created', async (event: MorPexEvent) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); } catch {}
    }
  });
  eventBus.on('artifact.updated', async (event: MorPexEvent) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); } catch {}
    }
  });

  // ── 迭代4: Feedback → SelfImprovementLoop 闭环 ──
  // 每次 brain.learn.request 事件触发时检查是否有新反馈需要注入进化
  let lastFeedbackEvolve = 0;
  eventBus.on('brain.learn.request', async () => {
    const now = Date.now();
    if (now - lastFeedbackEvolve < 300_000) return; // 每 5 分钟最多一次
    lastFeedbackEvolve = now;
    try {
      const testCases = await feedbackService.listTestCases(30);
      if (testCases.length > 0) {
        const { fed } = await feedbackAwareLearner.feedToEvolution(selfImprovementLoop, testCases);
        if (fed > 0) {
          console.log(`[bootstrap] 🔄 已反馈 ${fed} 条进化提案到 SelfImprovementLoop`);
        }
      }
    } catch (err) {
      console.warn('[bootstrap] ⚠️ 反馈进化失败:', (err as Error).message);
    }
  });

  console.log('[bootstrapV16] ✅ v16 全模块已集成');
  console.log(`  ├─ v12 组织: DepartmentManager + LeadAgent + GroupChat`);
  console.log(`  ├─ v13 大脑: ReflectionEngine + MetaLearner`);
  console.log(`  ├─ v13 规划: HierarchicalPlanner + DeliveryPlanner`);
  console.log(`  ├─ v14 目标: GoalIntelligence`);
  console.log(`  ├─ v14 产物: ArtifactFacade (生命周期升级 🆕)`);
  console.log(`  ├─ v14 验证: VerificationEngine`);
  console.log(`  ├─ v15 团队: DynamicTeamOrchestrator (能力优先 🆕)`);
  console.log(`  ├─ v15 工作流: WorkflowPluginRegistry`);
  console.log(`  ├─ v15 合规: ComplianceChecker`);
  console.log(`  ├─ v15 治理: RuntimeGov + CostCtrl + AlertEngine`);
  console.log(`  ├─ v15 改进: SelfImprovementLoop (集成 Simulator 🆕)`);
  console.log(`  ├─ v16 能力: CapabilityRegistry + Discoverer 🆕`);
  console.log(`  ├─ v16 总控: MissionController 🆕`);
  console.log(`  ├─ v16 模拟: ExecutionSimulator 🆕`);
  console.log(`  ├─ v16 审批: ApprovalGate 🆕`);
  console.log(`  ├─ 🏁 迭代1 Ontology: OntologyService + ForcedQueryGuard + planWithOntology 🆕`);
  console.log(`  ├─ 🏁 迭代2 实体: ObjectTypeRegistry + Mission/Artifact Projector 🆕`);
  console.log(`  ├─ 🏁 迭代2 评估: EvaluationEngine ontologyCompliance + referenceValidity 🆕`);
  console.log(`  └─ 🏁 迭代2 Trace: OntologyQueryPerformed → EventStore 🆕`);

  return {
    eventBus, departmentManager, roleRegistry, companyFacade,
    leadAgentOrchestrator, groupChatManager, managementHub,
    unifiedExecutionEngine, deliveryPlanner, subAgentFork, orgContext,
    brainFacade, sopEngine, kpiTracker,
    reflectionEngine, metaLearner, hierarchicalPlanner, toolFactory,
    governanceDashboard, toolQualityTracker,
    goalIntelligenceFacade, artifactFacade, verificationEngine, experienceMiner,
    dynamicTeamOrchestrator, complianceChecker,
    runtimeManager: RuntimeManager.getInstance(),
    costController: CostController.getInstance(),
    alertEngine: AlertEngine.getInstance(),
    selfImprovementLoop,
    capabilityRegistry: CapabilityRegistry,
    missionController, executionSimulator, approvalGate,

    ontology,
    forcedQueryGuard,
    objectTypeRegistry,
    missionProjector,
    artifactProjector,

    feedbackService,
    feedbackAwareLearner,
  };
}
