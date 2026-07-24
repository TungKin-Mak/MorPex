/**
 * MorPex v15 Bootstrap — v14 + DynamicTeam + WorkflowPlugin + Compliance + SelfImprovement
 *
 * v15 新增:
 *   - organization/DynamicTeamOrchestrator (动态团队编排)
 *   - workflow/WorkflowRegistry (工作流插件系统)
 *   - verification/ComplianceChecker (合规检查)
 *   - governance/RuntimeManager + CostController + AlertEngine (运行时治理)
 *   - brain/SelfImprovementLoop (自我改进循环)
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

// v13
import { ReflectionEngine } from './brain/ReflectionEngine.js';
import { MetaLearner } from './brain/MetaLearner.js';
import { HierarchicalPlanner } from './planner/HierarchicalPlanner.js';
import { ToolFactory } from './tools/ToolFactory.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { GovernanceDashboard } from './governance/GovernanceDashboard.js';
import { ToolQualityTracker } from './common/ToolQualityTracker.js';

// v14
import { GoalIntelligenceFacade } from './goal-intelligence/GoalIntelligenceFacade.js';
import { ArtifactFacade } from './artifact/ArtifactFacade.js';
import { VerificationEngine } from './verification/VerificationEngine.js';
import { ExperienceMiner } from './experience/ExperienceMiner.js';

// v15
import { DynamicTeamOrchestrator } from './organization/DynamicTeamOrchestrator.js';
import { WorkflowRegistry } from './workflow/WorkflowProvider.js';
import { ComplianceChecker } from './verification/ComplianceChecker.js';
import { RuntimeManager } from './governance/RuntimeManager.js';
import { CostController } from './governance/CostController.js';
import { AlertEngine } from './governance/AlertEngine.js';
import { SelfImprovementLoop } from './brain/SelfImprovementLoop.js';

export interface V15BootstrapResult {
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
  // v15
  dynamicTeamOrchestrator: DynamicTeamOrchestrator;
  complianceChecker: ComplianceChecker;
  runtimeManager: RuntimeManager;
  costController: CostController;
  alertEngine: AlertEngine;
  selfImprovementLoop: SelfImprovementLoop;
}

export async function bootstrapV15(
  eventBus: EventBus,
  options?: { ceoId?: string },
): Promise<V15BootstrapResult> {
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
  unifiedExecutionEngine.setArtifactFacade(artifactFacade);
  const verificationEngine = new VerificationEngine();
  const experienceMiner = new ExperienceMiner();

  // ════════════════════════════════════════════════════════
  // v15 新模块
  // ════════════════════════════════════════════════════════

  // 4. Dynamic Team Orchestrator
  const dynamicTeamOrchestrator = new DynamicTeamOrchestrator();

  // 5. Compliance Checker
  const complianceChecker = new ComplianceChecker();

  // 6. Runtime Governance
  const runtimeManager = new RuntimeManager();
  const costController = new CostController();
  const alertEngine = new AlertEngine(eventBus);

  // 7. Self-Improvement Loop
  const selfImprovementLoop = new SelfImprovementLoop();

  // 8. CEO 门面
  const companyFacade = new CompanyFacade(departmentManager, roleRegistry, ceoId);
  companyFacade.setGoalIntelligenceFacade(goalIntelligenceFacade as any);
  companyFacade.setBrainFacade(brainFacade);

  // 9. 管理群
  const managementHub = new ManagementHub(eventBus, departmentManager, leadAgentOrchestrator, groupChatManager, ceoId);

  // 10. 依赖注入
  subAgentFork.setExecutionEngine({
    execute: async (capability: string, params: Record<string, unknown>, context?: Record<string, unknown>) => {
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
  await managementHub.initialize();
  leadAgentOrchestrator.setBrainFacade(brainFacade);

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

  console.log('[bootstrapV15] ✅ v15 全模块已集成');
  console.log(`  ├─ v12 基础: DepartmentManager + LeadAgent + GroupChat`);
  console.log(`  ├─ v13 大脑+规划+工具: ReflectionEngine + HTN + ToolFactory`);
  console.log(`  ├─ v14 目标+产物+验证: GoalIntelligence + Artifact + Verification`);
  console.log(`  ├─ v15 动态团队: DynamicTeamOrchestrator 🆕`);
  console.log(`  ├─ v15 工作流插件: WorkflowRegistry 🆕`);
  console.log(`  ├─ v15 合规: ComplianceChecker 🆕`);
  console.log(`  ├─ v15 治理: RuntimeManager + CostController + AlertEngine 🆕`);
  console.log(`  └─ v15 自我改进: SelfImprovementLoop 🆕`);

  return {
    eventBus, departmentManager, roleRegistry, companyFacade,
    leadAgentOrchestrator, groupChatManager, managementHub,
    unifiedExecutionEngine, deliveryPlanner, subAgentFork, orgContext,
    brainFacade, sopEngine, kpiTracker,
    reflectionEngine, metaLearner, hierarchicalPlanner, toolFactory,
    governanceDashboard, toolQualityTracker,
    goalIntelligenceFacade, artifactFacade, verificationEngine, experienceMiner,
    dynamicTeamOrchestrator, complianceChecker,
    runtimeManager, costController, alertEngine, selfImprovementLoop,
  };
}
