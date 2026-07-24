import { EventBus } from '../common/EventBus.js';
import { MissionController } from '../mission-control/MissionController.js';
import { DynamicTeamOrchestrator } from '../organization/DynamicTeamOrchestrator.js';
import { UnifiedExecutionEngine } from '../execution/UnifiedExecutionEngine.js';
import { ArtifactFacade } from '../artifact/ArtifactFacade.js';
import { VerificationEngine } from '../verification/VerificationEngine.js';
import { ComplianceChecker } from '../verification/ComplianceChecker.js';
import { ApprovalGate } from '../verification/ApprovalGate.js';
import { ExperienceMiner } from '../experience/ExperienceMiner.js';
import { ExecutionSimulator } from '../simulation/ExecutionSimulator.js';
import { MorPexRuntime } from './MorPexRuntime.js';

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

  constructor() {
    this.eventBus = new EventBus();
    this.missionController = new MissionController(this.eventBus);
    this.teamOrchestrator = new DynamicTeamOrchestrator();
    this.executionEngine = new UnifiedExecutionEngine(this.eventBus);
    this.artifactFacade = new ArtifactFacade(this.eventBus);
    this.verificationEngine = new VerificationEngine();
    this.complianceChecker = new ComplianceChecker();
    this.approvalGate = new ApprovalGate(this.eventBus);
    this.experienceMiner = new ExperienceMiner();
    this.simulator = new ExecutionSimulator();
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
}
