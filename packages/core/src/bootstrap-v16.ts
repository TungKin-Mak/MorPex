/**
 * MorPex v16 Bootstrap — v15 + MissionControl + CapabilityRegistry + Simulation + ApprovalGate
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
import { ReflectionEngine } from './brain/ReflectionEngine.js';
import { MetaLearner } from './brain/MetaLearner.js';
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
import { SelfImprovementLoop } from './brain/SelfImprovementLoop.js';
import { CapabilityRegistry } from './capability/CapabilityRegistry.js';
import { MissionController } from './mission-control/MissionController.js';
import { ExecutionSimulator } from './simulation/ExecutionSimulator.js';
import { ApprovalGate } from './verification/ApprovalGate.js';

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
}

export async function bootstrapV16(eventBus: EventBus, options?: { ceoId?: string }): Promise<V16BootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';

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

  // ── CEO 门面 ──
  const companyFacade = new CompanyFacade(departmentManager, roleRegistry, ceoId);
  companyFacade.setGoalIntelligenceFacade(goalIntelligenceFacade as any);
  const managementHub = new ManagementHub(eventBus, departmentManager, leadAgentOrchestrator, groupChatManager, ceoId);

  // ── 依赖注入 ──
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
  companyFacade.setBrainFacade(brainFacade);

  // ── 事件监听 ──
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
  console.log(`  └─ v16 审批: ApprovalGate 🆕`);

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
  };
}
