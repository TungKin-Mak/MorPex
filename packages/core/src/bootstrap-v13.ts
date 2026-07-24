/**
 * MorPex v13 Bootstrap — v12 + Brain/Planner/Tools/Action 增强
 *
 * v13 新增:
 *   - brain/ReflectionEngine + MetaLearner
 *   - planner/HierarchicalPlanner
 *   - tools/ToolFactory + ToolRegistry + primitives
 *   - 归档 negotiation/router/observability Lite 到内核
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

// v13 新模块
import { ReflectionEngine } from './brain/ReflectionEngine.js';
import { MetaLearner } from './brain/MetaLearner.js';
import { HierarchicalPlanner } from './planner/HierarchicalPlanner.js';
import { ToolFactory } from './tools/ToolFactory.js';
import { ToolRegistry } from './tools/ToolRegistry.js';

import { GovernanceDashboard } from './governance/GovernanceDashboard.js';
import { ToolQualityTracker } from './common/ToolQualityTracker.js';

export interface V13BootstrapResult {
  // v12 已有
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

  // v13 新增
  reflectionEngine: ReflectionEngine;
  metaLearner: MetaLearner;
  hierarchicalPlanner: HierarchicalPlanner;
  toolFactory: ToolFactory;
  governanceDashboard: GovernanceDashboard;
  toolQualityTracker: ToolQualityTracker;
}

export async function bootstrapV13(
  eventBus: EventBus,
  options?: { ceoId?: string },
): Promise<V13BootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';

  // ── 1. 组织层 ──
  const departmentManager = new DepartmentManager(eventBus);
  const roleRegistry = new RoleRegistry(eventBus);
  const orgContext = OrganizationContextLite.getInstance();

  // ── 2. 群聊层 ──
  const groupChatManager = new GroupChatManager(eventBus);

  // ── 3. 执行层 ──
  const leadAgentOrchestrator = new LeadAgentOrchestrator(eventBus, departmentManager, roleRegistry);
  const unifiedExecutionEngine = new UnifiedExecutionEngine(eventBus);
  const deliveryPlanner = new DeliveryPlanner(eventBus);
  const subAgentFork = new SubAgentFork(eventBus);

  // ── 4. 部门记忆分区 ──
  const departmentMemoryAdapter = new DepartmentMemoryAdapter();
  const brainFacade = new BrainFacade(eventBus);
  brainFacade.setMemoryWiki(departmentMemoryAdapter.createWikiWrapper());

  // ── 5. SOP + KPI ──
  const sopEngine = new SOPEngine(eventBus);
  const kpiTracker = new DepartmentKPITracker(eventBus);
  brainFacade.setSOPEngine(sopEngine);

  // ════════════════════════════════════════════════════════
  // v13 新模块初始化
  // ════════════════════════════════════════════════════════

  // 5.5. 大脑增强: ReflectionEngine + MetaLearner
  const reflectionEngine = new ReflectionEngine(eventBus);
  const metaLearner = new MetaLearner(eventBus);
  brainFacade.setReflectionEngine(reflectionEngine);
  brainFacade.setMetaLearner(metaLearner);

  // 6. 规划增强: HierarchicalPlanner
  const hierarchicalPlanner = new HierarchicalPlanner(eventBus);
  hierarchicalPlanner.setBrainFacade(brainFacade);
  deliveryPlanner.setHierarchicalPlanner(hierarchicalPlanner);

  // 7. 动态工具工厂
  ToolRegistry.init(eventBus);
  const toolFactory = new ToolFactory(eventBus);

  // 8. 治理看板 (VCOS 100 — Observability & Governance)
  const governanceDashboard = new GovernanceDashboard(eventBus);

  // 9. 工具质量追踪 (VCOS 100 — Tools & Environment)
  const toolQualityTracker = new ToolQualityTracker();
  toolQualityTracker.connectToRegistry(eventBus);

  // ── 10. CEO 门面 ──
  const companyFacade = new CompanyFacade(departmentManager, roleRegistry, ceoId);

  // ── 10. 管理群 ──
  const managementHub = new ManagementHub(eventBus, departmentManager, leadAgentOrchestrator, groupChatManager, ceoId);

  // ── 11. 依赖注入 ──
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

  // ── 12. 事件监听 ──
  eventBus.on('brain.learn.request', (event: any) => {
    const exp = event.payload;
    if (exp) {
      brainFacade.learn(exp).catch(err =>
        console.warn('[bootstrapV13] BrainFacade 备份学习失败:', err),
      );
    }
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
    if (dept) {
      kpiTracker.registerDepartment(dept.id, dept.name);
    }
  });

  console.log('[bootstrapV13] ✅ v13 全模块已集成 (Brain+Planner+Tools+Governance)');
  console.log(`  ├─ v12 基础: DepartmentManager + LeadAgent + GroupChat`);
  console.log(`  ├─ v13 大脑: ReflectionEngine + MetaLearner`);
  console.log(`  ├─ v13 规划: HierarchicalPlanner (HTN)`);
  console.log(`  ├─ v13 工具: ToolFactory + ToolRegistry + primitives`);
  console.log(`  └─ v13 治理: GovernanceDashboard (健康+成本+合规) ✅ VCOS 100`);

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
  };
}
