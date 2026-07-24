import { EventBus } from '../common/EventBus.js';
import { MissionController } from '../mission-control/MissionController.js';
import { DynamicTeamOrchestrator } from '../organization/DynamicTeamOrchestrator.js';
import { UnifiedExecutionEngine } from '../execution/UnifiedExecutionEngine.js';
import type { MissionRuntimeLike, DAGRuntimeLike, ExecutionFabricLike } from '../execution/UnifiedExecutionEngine.js';
import { ArtifactFacade } from '../artifact/ArtifactFacade.js';
import { VerificationEngine } from '../verification/VerificationEngine.js';
import { ComplianceChecker } from '../verification/ComplianceChecker.js';
import { ApprovalGate } from '../verification/ApprovalGate.js';
import { ExperienceMiner } from '../experience/ExperienceMiner.js';
import { ExecutionSimulator } from '../simulation/ExecutionSimulator.js';
import { MorPexRuntime } from './MorPexRuntime.js';
import { MissionRuntime } from './mission/MissionRuntime.js';
import { DAGRuntime } from './dag/DAGRuntime.js';
import { PersistentMissionStore } from './PersistentMissionStore.js';
import { PersistentArtifactStore } from './PersistentArtifactStore.js';

/**
 * ServiceContainer — 依赖注入容器
 * v15 Integration: 一键初始化所有运行时服务，确保模块间正确连接
 */
export class ServiceContainer {
  readonly eventBus: EventBus;
  readonly missionController: MissionController;
  readonly teamOrchestrator: DynamicTeamOrchestrator;
  readonly executionEngine: UnifiedExecutionEngine;
  readonly artifactFacade: ArtifactFacade;
  readonly verificationEngine: VerificationEngine;
  readonly complianceChecker: ComplianceChecker;
  readonly approvalGate: ApprovalGate;
  readonly experienceMiner: ExperienceMiner;
  readonly simulator: ExecutionSimulator;
  readonly runtime: MorPexRuntime;
  readonly missionStore: PersistentMissionStore;
  readonly artifactStore: PersistentArtifactStore;

  constructor() {
    this.eventBus = new EventBus();
    this.missionController = new MissionController(this.eventBus);
    this.missionController.setPersistentStore({ save: (m: any) => this.missionStore.save(m) });
    this.teamOrchestrator = new DynamicTeamOrchestrator();
    this.executionEngine = new UnifiedExecutionEngine(this.eventBus);
    this.executionEngine.setMissionRuntime(this.createMissionRuntime());
    this.executionEngine.setDAGRuntime(this.createDAGRuntime());
    this.executionEngine.setExecutionFabric(this.createExecutionFabric());
    this.artifactFacade = new ArtifactFacade(this.eventBus);
    this.artifactFacade.setPersistentStore({ save: (a: any) => this.artifactStore.save(a), transition: (id: string, to: any) => this.artifactStore.transition(id, to as string) });
    this.executionEngine.setArtifactFacade(this.artifactFacade);
    this.verificationEngine = new VerificationEngine();
    this.complianceChecker = new ComplianceChecker();
    this.approvalGate = new ApprovalGate(this.eventBus);
    this.experienceMiner = new ExperienceMiner();
    this.simulator = new ExecutionSimulator();
    this.missionStore = new PersistentMissionStore();
    this.artifactStore = new PersistentArtifactStore();
    this.missionStore.init().catch(() => {});
    this.artifactStore.init().catch(() => {});
    this.runtime = new MorPexRuntime(
      this.eventBus,
      this.missionController,
      this.executionEngine,
      this.artifactFacade,
      this.verificationEngine,
      this.complianceChecker,
      this.approvalGate,
      this.experienceMiner,
      this.simulator,
      this.teamOrchestrator,
    );
  }

  private createMissionRuntime(): MissionRuntimeLike {
    const mr = new MissionRuntime(this.eventBus);
    return {
      name: 'MissionRuntime',
      start: async (goal: string, context?: Record<string, unknown>) => {
        const mission = await mr.createMissionFromGoal(goal, context?.departmentId as string || 'default', context?.executionId as string || `exec_${Date.now()}`);
        return { executionId: mission.id };
      },
      getStatus: (id: string) => mr.getMission(id),
      cancel: (id: string) => mr.cancelMission(id),
    };
  }

  private createDAGRuntime(): DAGRuntimeLike {
    return {
      name: 'DAGRuntime',
      execute: async (goal: string, _tasks: unknown[], _context?: Record<string, unknown>) => {
        console.log('[ServiceContainer] DAGRuntime.execute:', goal.substring(0, 60));
        return { executionId: `dag_${Date.now()}` };
      },
      getStatus: () => ({}),
      cancel: async () => {},
    };
  }

  private createExecutionFabric(): ExecutionFabricLike {
    return {
      name: 'ExecutionFabric',
      execute: async (_capability: string, action: string, params: Record<string, unknown>) => {
        console.log('[ServiceContainer] ExecutionFabric 模拟:', action);
        return { success: true, data: { action, params }, duration: 0 };
      },
      getFabricStatus: () => ({ status: 'mock', uptime: 0 }),
    };
  }
}
