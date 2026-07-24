/**
 * MorPex v14 Bootstrap — v13 + Goal Intelligence + Artifact + Verification + Experience
 *
 * v14 新增:
 *   - goal-intelligence/GoalIntelligenceFacade (目标理解)
 *   - artifact/ArtifactFacade (产物管理)
 *   - verification/VerificationEngine (质量验证)
 *   - experience/ExperienceMiner (能力库)
 *   - MissionRuntime FSM: UNDERSTANDING + ARTIFACT_GENERATING 状态
 *   - GovernanceDashboard 交付指标增强
 */

import { EventBus } from './common/EventBus.js';
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

// v13 模块
import { ReflectionEngine } from './brain/ReflectionEngine.js';
import { MetaLearner } from './brain/MetaLearner.js';
import { HierarchicalPlanner } from './planner/HierarchicalPlanner.js';
import { ToolFactory } from './tools/ToolFactory.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { GovernanceDashboard } from './governance/GovernanceDashboard.js';
import { ToolQualityTracker } from './common/ToolQualityTracker.js';

// v14 新模块
import { GoalIntelligenceFacade } from './goal-intelligence/GoalIntelligenceFacade.js';
import { ArtifactFacade } from './artifact/ArtifactFacade.js';
import { VerificationEngine } from './verification/VerificationEngine.js';
import { ExperienceMiner } from './experience/ExperienceMiner.js';

export interface V14BootstrapResult {
  // v12
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
  // v13
  reflectionEngine: ReflectionEngine;
  metaLearner: MetaLearner;
  hierarchicalPlanner: HierarchicalPlanner;
  toolFactory: ToolFactory;
  governanceDashboard: GovernanceDashboard;
  toolQualityTracker: ToolQualityTracker;
  // v14
  goalIntelligenceFacade: GoalIntelligenceFacade;
  artifactFacade: ArtifactFacade;
  verificationEngine: VerificationEngine;
  experienceMiner: ExperienceMiner;
}

export async function bootstrapV14(
  eventBus: EventBus,
  options?: { ceoId?: string },
): Promise<V14BootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';

  // ── 1. 组织层 ──
  const departmentManager = new DepartmentManager(eventBus);
  const roleRegistry = new RoleRegistry(eventBus);
  const orgContext = OrganizationContextLite.getInstance();
  const groupChatManager = new GroupChatManager(eventBus);

  // ── 2. 执行层 ──
  const leadAgentOrchestrator = new LeadAgentOrchestrator(eventBus, departmentManager, roleRegistry);
  const unifiedExecutionEngine = new UnifiedExecutionEngine(eventBus);
  const deliveryPlanner = new DeliveryPlanner(eventBus);
  const subAgentFork = new SubAgentFork(eventBus);

  // ── 3. 大脑 ──
  const departmentMemoryAdapter = new DepartmentMemoryAdapter();
  const brainFacade = new BrainFacade(eventBus);
  brainFacade.setMemoryWiki(departmentMemoryAdapter.createWikiWrapper());
  const sopEngine = new SOPEngine(eventBus);
  const kpiTracker = new DepartmentKPITracker(eventBus);
  brainFacade.setSOPEngine(sopEngine);

  // ── v13 模块 ──
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

  // ════════════════════════════════════════════════════════
  // v14 新模块
  // ════════════════════════════════════════════════════════

  // 4. Goal Intelligence
  const goalIntelligenceFacade = new GoalIntelligenceFacade();

  // 5. Artifact Plane — 注入到执行引擎
  const artifactFacade = new ArtifactFacade(eventBus);
  unifiedExecutionEngine.setArtifactFacade(artifactFacade);

  // 6. Verification Engine
  const verificationEngine = new VerificationEngine();

  // 7. Experience System
  const experienceMiner = new ExperienceMiner();

  // 8. CEO 门面 — 注入 Goal Intelligence
  const companyFacade = new CompanyFacade(departmentManager, roleRegistry, ceoId);
  companyFacade.setGoalIntelligenceFacade(goalIntelligenceFacade as any);

  // 9. 管理群
  const managementHub = new ManagementHub(eventBus, departmentManager, leadAgentOrchestrator, groupChatManager, ceoId);

  // 10. 依赖注入
  subAgentFork.setExecutionEngine({
    execute: async (capability: string, params: Record<string, unknown>, context?: Record<string, unknown>) => {
      const result = await unifiedExecutionEngine.execute({
        goal: capability,
        mode: 'auto',
        context: { ...params, ...context },
        departmentId: (context?.departmentId as string) || undefined,
      });
      return result.output ?? result;
    },
  });

  deliveryPlanner.setSOPEngine(sopEngine);
  deliveryPlanner.setBrainFacade(brainFacade);
  await managementHub.initialize();
  leadAgentOrchestrator.setBrainFacade(brainFacade);
  companyFacade.setBrainFacade(brainFacade);

  // 11. 事件监听
  eventBus.on('brain.learn.request', (event: any) => {
    const exp = event.payload;
    if (exp) brainFacade.learn(exp).catch(() => {});
  });
  eventBus.on('department.task.completed', (event: any) => {
    const p = event.payload;
    if (!p?.departmentId) return;
    kpiTracker.incrementMetric(p.departmentId, 'tasks_completed');
    if (!kpiTracker.getHealth(p.departmentId)) {
      kpiTracker.registerDepartment(p.departmentId, p.departmentName ?? p.departmentId);
    }
  });
  eventBus.on('department.created', (event: any) => {
    const dept = event.payload?.department;
    if (dept) kpiTracker.registerDepartment(dept.id, dept.name);
  });

  console.log('[bootstrapV14] ✅ v14 全模块已集成');
  console.log(`  ├─ v12 基础: DepartmentManager + LeadAgent + GroupChat`);
  console.log(`  ├─ v13 大脑: ReflectionEngine + MetaLearner`);
  console.log(`  ├─ v13 规划: HierarchicalPlanner (HTN)`);
  console.log(`  ├─ v13 工具: ToolFactory + ToolRegistry`);
  console.log(`  ├─ v13 治理: GovernanceDashboard`);
  console.log(`  ├─ v14 目标: GoalIntelligenceFacade 🆕`);
  console.log(`  ├─ v14 产物: ArtifactFacade 🆕`);
  console.log(`  ├─ v14 验证: VerificationEngine 🆕`);
  console.log(`  └─ v14 经验: ExperienceMiner 🆕`);

  return {
    eventBus,
    departmentManager,
    roleRegistry,
    companyFacade,
    leadAgentOrchestrator,
    groupChatManager,
    managementHub,
    unifiedExecutionEngine,
    deliveryPlanner,
    subAgentFork,
    orgContext,
    brainFacade,
    sopEngine,
    kpiTracker,
    reflectionEngine,
    metaLearner,
    hierarchicalPlanner,
    toolFactory,
    governanceDashboard,
    toolQualityTracker,
    goalIntelligenceFacade,
    artifactFacade,
    verificationEngine,
    experienceMiner,
  };
}
