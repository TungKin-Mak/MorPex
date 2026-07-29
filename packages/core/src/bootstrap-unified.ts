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

// ── v16 模块 ──
import { SelfImprovementLoop } from './brain/SelfImprovementLoop.js';
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

  // 3. 注册 WorkflowRegistry（含内置工作流插件）
  try {
    container.teamOrchestrator.setWorkflowRegistry(WorkflowPluginRegistry);
    // 注册内置工作流
    const { ecommerceWorkflowProvider, xjmcuWorkflowProvider } = await import('../../workflows/ecommerce/workflow-provider.js');
    WorkflowPluginRegistry.register(ecommerceWorkflowProvider);
    WorkflowPluginRegistry.register(xjmcuWorkflowProvider);
    console.log('[bootstrapUnified] ✅ WorkflowRegistry 已注入（含电商+MCU 工作流）');
  } catch {
    console.warn('[bootstrapUnified] ⚠️ WorkflowRegistry 不可用');
  }

  // 4. 注册 ArtifactFacade 到 ExecutionEngine（向后兼容）
  container.executionEngine.setArtifactFacade(container.artifactFacade);

  // 5. 创建 CompanyFacade（强制要求 Runtime + ControlPlane）
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

  // ── Ontology 迭代4 ──
  const objectTypeRegistry = new ObjectTypeRegistry();
  const ontology = new OntologyService(systemMetadataGraph, objectTypeRegistry);
  const forcedQueryGuard = new ForcedQueryGuard();

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

  // ── 事件监听（增量投影） ──
  eventBus.on('mission.created', async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); } catch {}
    }
  });
  eventBus.on('mission.updated', async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.missionId) {
      try { await missionProjector.projectOne(p.id ?? p.missionId); } catch {}
    }
  });
  eventBus.on('artifact.created', async (event: any) => {
    const p = event.payload;
    if (p?.id || p?.artifactId) {
      try { await artifactProjector.projectOne(p.id ?? p.artifactId); } catch {}
    }
  });
  eventBus.on('artifact.updated', async (event: any) => {
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

  return {
    container,
    companyFacade,
    departmentManager,
    controlPlane: container.controlPlane,
    ontology,
    forcedQueryGuard,
    objectTypeRegistry,
    missionProjector,
    artifactProjector,
    feedbackService,
    feedbackAwareLearner,
  };
}
