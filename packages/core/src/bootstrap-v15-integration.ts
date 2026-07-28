/**
 * MorPex v15 Integration Bootstrap
 *
 * 目标: 将所有 v12-v16 模块接入真实运行链路，解决"模块存在≠系统具备能力"问题。
 *
 * 核心变更:
 *   - ServiceContainer: 一键初始化所有服务
 *   - MorPexRuntime: 完整管线 Mission→Team→Execution→Artifact→Verification→Compliance→Approval→Experience
 *   - CompanyFacade.setRuntime(): executeGoal 委托到 MorPexRuntime
 *   - ExperienceMiner → CapabilityRegistry.updateSuccessRate(): 执行反馈闭环
 *
 * 使用方式:
 *   const { companyFacade, container } = await bootstrapV15Integration();
 *   const result = await companyFacade.executeGoal("开发空气检测设备并销售到 Amazon");
 *   console.log(result.report);
 */

import { ServiceContainer } from './runtime/ServiceContainer.js';
import { CompanyFacade } from './facade/CompanyFacade.js';
import { DepartmentManager } from './department/DepartmentManager.js';
import { RoleRegistry } from './role/RoleRegistry.js';
import { CapabilityRegistry } from './capability/CapabilityRegistry.js';

// ── Ontology 迭代4 ──
import { systemMetadataGraph } from './metadata/SystemMetadataGraph.js';
import { OntologyService } from './ontology/OntologyService.js';
import { ForcedQueryGuard } from './ontology/ForcedQueryGuard.js';
import { EvaluationEngine } from './evaluation/EvaluationEngine.js';

export interface V15IntegrationResult {
  container: ServiceContainer;
  companyFacade: CompanyFacade;
  departmentManager: DepartmentManager;

  /** 迭代4: Ontology 实例 */
  ontology: OntologyService;
  forcedQueryGuard: ForcedQueryGuard;
}

export async function bootstrapV15Integration(options?: {
  /** 外部传入的 EventStore（用于 Trace 事件写入） */
  eventStore?: import('./protocol/events/store/IEventStore.js').IEventStore;
}): Promise<V15IntegrationResult> {
  // 1. 初始化 CapabilityRegistry (内置 9 项能力)
  CapabilityRegistry.init();

  // 2. 创建 ServiceContainer (含所有服务 + MorPexRuntime)
  const container = new ServiceContainer();

  // 3. 注册 WorkflowRegistry (如果存在)
  try {
    const { WorkflowRegistry } = await import('./workflow/WorkflowProvider.js');
    container.teamOrchestrator.setWorkflowRegistry(WorkflowRegistry);
    console.log('[bootstrapV15Integration] ✅ WorkflowRegistry 已注入');
  } catch {
    console.warn('[bootstrapV15Integration] ⚠️ WorkflowRegistry 不可用');
  }

  // 4. 注册 ArtifactFacade 到 ExecutionEngine (执行成功自动创建产物)
  container.executionEngine.setArtifactFacade(container.artifactFacade);

  // 5. 创建 CompanyFacade 并注入 Runtime
  const eventBus = container.eventBus;
  const departmentManager = new DepartmentManager(eventBus);
  const roleRegistry = new RoleRegistry(eventBus);
  const companyFacade = new CompanyFacade(departmentManager, roleRegistry, 'ceo-default');
  companyFacade.setRuntime(container.runtime);
  companyFacade.setBrainFacade({
    recall: async () => [],
  });

  // ── Ontology 迭代4：注入到 MorPexRuntime ──
  const ontology = new OntologyService(systemMetadataGraph, new (await import('./ontology/ObjectTypeRegistry.js')).ObjectTypeRegistry());
  const forcedQueryGuard = new ForcedQueryGuard();

  // 创建 PiBridge 包装（带缓存）
  let piBridgeInstance: any = null;
  const piBridgeWrapper = {
    generateText: async (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => {
      if (!piBridgeInstance) {
        const { PiBridge } = await import('./adapters/pi-bridge/PiBridge.js');
        piBridgeInstance = new PiBridge('deepseek/deepseek-v4-flash');
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

  // 设置 Trace 事件钩子
  const eventStore = options?.eventStore;
  if (eventStore) {
    const { createQueryPerformedEvent } = await import('./events/ontologyEvents.js');
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

  console.log('[bootstrapV15Integration] ✅ v15 集成引导完成');
  console.log(`  ├─ Runtime: ${container.runtime.constructor.name}`);
  console.log(`  ├─ MissionController: 已接入管线`);
  console.log(`  ├─ VerificationEngine: 已接入管线`);
  console.log(`  ├─ ComplianceChecker: 已接入管线`);
  console.log(`  ├─ ApprovalGate: 已接入管线`);
  console.log(`  ├─ ExperienceMiner→CapabilityRegistry: 反馈已接通`);
  console.log(`  ├─ 🏁 Ontology: OntologyService + ForcedQueryGuard 已注入 Runtime`);
  console.log(`  └─ CompanyFacade.executeGoal(): 委托到 Runtime（含 ontology grounding）`);

  return { container, companyFacade, departmentManager, ontology, forcedQueryGuard };
}
