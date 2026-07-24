/**
 * MorPex v12 Bootstrap — 组织层 + 交付层 + 大脑统一引导
 *
 * Phase 4.5 / 架构打磨
 *
 * 将 Phase 0-4 的所有新模块注入运行时，并完成依赖注入。
 * 包括：
 *   - Phase 0: DepartmentManager / RoleRegistry / CompanyFacade / OrganizationContext
 *   - Phase 1: LeadAgentOrchestrator / GroupChatManager / ManagementHub
 *   - Phase 2: UnifiedExecutionEngine / DeliveryPlanner / SubAgentFork
 *   - Phase 4.5: BrainFacade（统一 PersonalBrain + MemoryWiki + LearningLoop + EvolutionEngine）
 *
 * 使用方式：
 *   import { bootstrapV12 } from './core/src/bootstrap-v12.js';
 *   const v12 = await bootstrapV12(eventBus);
 *   // v12.companyFacade.createDepartment("编程部");
 *   // v12.managementHub.handleCommand("@编程部 优化登录");
 *   // v12.brainFacade.remember({ content: "...", source: "user", importance: 3 });
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

export interface V12BootstrapResult {
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
}

/**
 * bootstrapV12 — 创建并注入所有 Phase 0-4 模块
 *
 * 步骤：
 *   1. 创建所有新模块实例
 *   2. 完成依赖注入
 *   3. 初始化管理群
 *   4. 连接学习回路（执行结果 → BrainFacade.learn()）
 *   5. 返回所有实例供路由层使用
 *
 * @param eventBus - 现有的 EventBus 实例
 * @param options - 可选配置
 * @returns 所有新模块的引用
 */
export async function bootstrapV12(
  eventBus: EventBus,
  options?: { ceoId?: string },
): Promise<V12BootstrapResult> {
  const ceoId = options?.ceoId ?? 'ceo-default';

  // ── 1. 组织层 ──
  const departmentManager = new DepartmentManager(eventBus);
  const roleRegistry = new RoleRegistry(eventBus);
  const orgContext = OrganizationContextLite.getInstance();

  // ── 2. 群聊层 ──
  const groupChatManager = new GroupChatManager(eventBus);

  // ── 3. 执行层 ──
  const leadAgentOrchestrator = new LeadAgentOrchestrator(
    eventBus,
    departmentManager,
    roleRegistry,
  );
  const unifiedExecutionEngine = new UnifiedExecutionEngine(eventBus);
  const deliveryPlanner = new DeliveryPlanner(eventBus);
  const subAgentFork = new SubAgentFork(eventBus);

  // ── 4. 部门记忆分区适配器 ──
  // 在 MemoryWiki 之上加 departmentId 隔离层
  const departmentMemoryAdapter = new DepartmentMemoryAdapter(
    // 如果有全局 MemoryWiki 实例，可注入:
    // globalMemoryWiki
  );

  // ── 5. 大脑门面 ──
  const brainFacade = new BrainFacade(eventBus);
  // 注入部门分区记忆（自动按 departmentId 隔离）
  brainFacade.setMemoryWiki(departmentMemoryAdapter.createWikiWrapper());

  // ── 5.5. SOP 引擎 + KPI 追踪（Phase 5 / VCOS P1） ──
  const sopEngine = new SOPEngine(eventBus);
  const kpiTracker = new DepartmentKPITracker(eventBus);
  // SOPEngine 注入 BrainFacade：成功经验 → 自动提取 SOP
  brainFacade.setSOPEngine(sopEngine);

  // ── 6. CEO 门面 ──
  const companyFacade = new CompanyFacade(
    departmentManager,
    roleRegistry,
    ceoId,
  );

  // ── 7. 管理群（CEO 控制台） ──
  const managementHub = new ManagementHub(
    eventBus,
    departmentManager,
    leadAgentOrchestrator,
    groupChatManager,
    ceoId,
  );

  // ── 8. 注入执行引擎到 SubAgentFork ──
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

  // ── 8.5. 注入 BrainFacade + SOPEngine → DeliveryPlanner（P2: 规划←经验闭环） ──
  deliveryPlanner.setSOPEngine(sopEngine);
  deliveryPlanner.setBrainFacade(brainFacade);

  // ── 9. 初始化管理群 ──
  await managementHub.initialize();

  // ── 10. 注入 BrainFacade 到 LeadAgentOrchestrator + CompanyFacade ──
  // 学习回路已在 LeadAgentOrchestrator.orchestrateTask() 内部闭合
  // 成功/失败时自动调用 brainFacade.learn()
  leadAgentOrchestrator.setBrainFacade(brainFacade);
  companyFacade.setBrainFacade(brainFacade);

  // ── 11. BrainFacade 也监听全局事件作为备份学习路径 ──
  // 如果其他模块直接发射 department.task.* 事件（不经 LeadAgentOrchestrator），
  // BrainFacade 也能捕获并学习
  eventBus.on('brain.learn.request', (event: any) => {
    const exp = event.payload;
    if (exp) {
      brainFacade.learn(exp).catch(err =>
        console.warn('[bootstrapV12] BrainFacade 备份学习失败:', err),
      );
    }
  });

  // ── 10. KPI 自动追踪 ──
  // 任务完成时自动更新部门 KPI
  eventBus.on('department.task.completed', (event: any) => {
    const p = event.payload;
    if (!p?.departmentId) return;
    // 自动递增 tasks_completed
    kpiTracker.incrementMetric(p.departmentId, 'tasks_completed');
    // 如果 KPI 未注册，自动注册
    if (!kpiTracker.getHealth(p.departmentId)) {
      kpiTracker.registerDepartment(p.departmentId, p.departmentName ?? p.departmentId);
    }
  });

  // 监听部门创建 → 自动注册 KPI
  eventBus.on('department.created', (event: any) => {
    const dept = event.payload?.department;
    if (dept) {
      kpiTracker.registerDepartment(dept.id, dept.name);
    }
  });

  console.log('[bootstrapV12] ✅ 组织层 + 交付层 + 大脑 + SOP + KPI 已集成');
  console.log(`  ├─ 部门: DepartmentManager + LeadAgentOrchestrator`);
  console.log(`  ├─ 角色: RoleRegistry`);
  console.log(`  ├─ 群聊: GroupChatManager + ManagementHub`);
  console.log(`  ├─ 执行: UnifiedExecutionEngine + DeliveryPlanner`);
  console.log(`  ├─ 子Agent: SubAgentFork`);
  console.log(`  └─ 大脑: BrainFacade (学习回路 + SOP 自动提取)`);
  console.log(`  ├─ SOP: SOPEngine (经验→标准流程)`);
  console.log(`  └─ KPI: DepartmentKPITracker (部门绩效)`);

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
  };
}
