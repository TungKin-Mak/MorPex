import { EventBus } from '../common/EventBus.js';
import { PipelineOrchestrator } from './PipelineOrchestrator.js';
import { MissionController } from '../mission-control/MissionController.js';
import { UnifiedExecutionEngine } from '../execution/UnifiedExecutionEngine.js';
import type { ExecutionRequest } from '../execution/UnifiedExecutionEngine.js';
import { ArtifactFacade } from '../artifact/ArtifactFacade.js';
import { VerificationEngine } from '../verification/VerificationEngine.js';
import { ComplianceChecker } from '../verification/ComplianceChecker.js';
import { ApprovalGate } from '../verification/ApprovalGate.js';
import { ExperienceMiner } from '../experience/ExperienceMiner.js';
import { ExecutionSimulator } from '../simulation/ExecutionSimulator.js';
import { DynamicTeamOrchestrator } from '../organization/DynamicTeamOrchestrator.js';
import type { ExecutionContext } from './ExecutionContext.js';
import type { Artifact } from '../contracts/artifact.js';
import { SafetyMonitor } from '../brain/SafetyMonitor.js';
import { SelfImprovementLoop } from '../brain/SelfImprovementLoop.js';
import { systemMetadataGraph } from '../metadata/SystemMetadataGraph.js';

export interface RunResult {
  ok: boolean;
  context: ExecutionContext;
  executionResult?: unknown;
  artifacts: unknown[];
  verification?: unknown;
  compliance?: unknown;
  approval?: unknown;
  experience?: unknown;
  errors: string[];
}

export class MorPexRuntime {
  private eventBus: EventBus;
  private pipeline: PipelineOrchestrator;
  private missionController: MissionController;
  private executionEngine: UnifiedExecutionEngine;
  private artifactFacade: ArtifactFacade;
  private verificationEngine: VerificationEngine;
  private complianceChecker: ComplianceChecker;
  private approvalGate: ApprovalGate;
  private experienceMiner: ExperienceMiner;
  private simulator: ExecutionSimulator;
  private safetyMonitor: SafetyMonitor;
  private evolutionLoop: SelfImprovementLoop;

  constructor(
    eventBus: EventBus,
    missionController: MissionController,
    executionEngine: UnifiedExecutionEngine,
    artifactFacade: ArtifactFacade,
    verificationEngine: VerificationEngine,
    complianceChecker: ComplianceChecker,
    approvalGate: ApprovalGate,
    experienceMiner: ExperienceMiner,
    simulator: ExecutionSimulator,
    teamOrchestrator: DynamicTeamOrchestrator,
  ) {
    this.eventBus = eventBus;
    this.missionController = missionController;
    this.executionEngine = executionEngine;
    this.artifactFacade = artifactFacade;
    this.verificationEngine = verificationEngine;
    this.complianceChecker = complianceChecker;
    this.approvalGate = approvalGate;
    this.experienceMiner = experienceMiner;
    this.simulator = simulator;
    this.safetyMonitor = new SafetyMonitor();
    this.evolutionLoop = new SelfImprovementLoop(this.safetyMonitor);
    this.pipeline = new PipelineOrchestrator(eventBus, missionController, teamOrchestrator);
  }

  async run(goal: string): Promise<RunResult> {
    const errors: string[] = [];
    let context!: ExecutionContext;

    try {
      // ── Phase 1: Pipeline Orchestration (Mission → Team → Workflow) ──
      const pipelineResult = await this.pipeline.orchestrate(goal);
      context = pipelineResult.context;
      this.missionController.updateMission({
        missionId: context.mission.missionId,
        phase: 'EXECUTING',
      });

      // ── Phase 1.5: Pre-execution Simulation ──
      const simResult = this.simulator.simulate({
        plan: {
          steps: context.capabilities.map(c => ({
            name: c.name,
            estimatedDuration: c.estimatedDuration,
            capabilities: [c.name],
          })),
        },
        capabilities: context.capabilities,
        constraints: {
          budget: context.budget.allocated,
          deadline: context.goal.constraints.deadline,
        },
      });
      if (!simResult.feasible) {
        this.missionController.addBlock(
          context.mission.missionId,
          'RESOURCE_UNAVAILABLE',
          simResult.blockingIssues.join('; '),
        );
        return {
          ok: false,
          context,
          errors: simResult.blockingIssues,
          artifacts: [],
        };
      }

      // ── Phase 2: Execution ──
      const execRequest: ExecutionRequest = {
        goal: context.goal.objective,
        mode: 'auto',
        departmentId: context.team.departments[0],
        context: {
          executionId: context.executionId,
          missionId: context.mission.missionId,
          teamId: context.team.id,
        },
      };
      const execResult = await this.executionEngine.execute(execRequest);
      if (!execResult.ok) {
        this.missionController.addBlock(
          context.mission.missionId,
          'QUALITY_FAILED',
          execResult.error || 'Execution failed',
        );
        return {
          ok: false,
          context,
          executionResult: execResult,
          errors: [execResult.error || 'Execution failed'],
          artifacts: [],
        };
      }

      // ── Phase 3: Artifact Creation ──
      const artifact = this.artifactFacade.create(
        'output',
        'document',
        context.executionId,
        { goal: context.goal.objective, output: execResult.output },
      );
      context.artifacts.push(artifact.id);

      // ── Phase 4: Verification + Compliance + Approval ──
      const verArtifact: Artifact = { id: artifact.id, type: artifact.type as any, sourceTask: artifact.sourceTask, version: artifact.version, status: artifact.status as any, metadata: artifact.metadata, createdAt: artifact.createdAt, name: artifact.name, lineage: artifact.lineage, updatedAt: artifact.updatedAt };
      const verResult = await this.verificationEngine.verify([verArtifact]);
      const complianceResult = await this.complianceChecker.check(
        context.workflow.name,
        { title: context.goal.objective, category: context.goal.domain },
      );
      const approvalRequest = this.approvalGate.requestApproval(
        artifact.id,
        artifact.name,
        complianceResult,
        context.risk,
      );
      if (approvalRequest.decision === undefined) {
        this.missionController.addBlock(
          context.mission.missionId,
          'HUMAN_WAITING',
          `等待审批: ${artifact.name}`,
        );
      }

      // ── Phase 5: Experience Mining ──
      await this.experienceMiner.mineFromCompletedTask({
        goal: context.goal.objective,
        taskId: context.executionId,
        result: execResult.ok ? 'success' : 'failure',
        capabilities: context.capabilities.map(c => c.name),
        departmentId: context.team.departments[0],
      });

      // ── Phase 6: Completion ──
      this.missionController.updateMission({
        missionId: context.mission.missionId,
        phase: 'RELEASING',
        progress: 100,
        status: 'COMPLETED',
      });

      // ── Phase 7: Metadata Graph Registration ──
      systemMetadataGraph.registerEntity(context.executionId, 'mission', context.goal.objective.substring(0, 80), { ok: execResult.ok, duration: execResult.duration });

      // ── Phase 8: Safety Monitor Observation ──
      this.safetyMonitor.observe({
        taskSuccessRate: execResult.ok ? 1.0 : 0.0,
        avgLatency: execResult.duration,
        retryRate: 0,
        artifactQuality: artifact ? 0.9 : 0.0,
      });

      // ── Phase 9: Self Evolution Analysis ──
      if (execResult.ok) {
        try {
          const evolutionResult = await this.evolutionLoop.evolve({
            taskSuccessRate: 1.0,
            avgLatency: execResult.duration,
            failurePatterns: [],
            artifactQuality: artifact ? 0.9 : 0.0,
          });
          console.log(`[MorPexRuntime] 🔄 进化分析: ${evolutionResult.proposals.length} 个提案`);
        } catch (_err) {
          // 进化分析失败不影响主流程
        }
      }

      return {
        ok: true,
        context,
        executionResult: execResult,
        artifacts: [artifact],
        verification: verResult,
        compliance: complianceResult,
        approval: approvalRequest,
        experience: { mined: true },
        errors: [],
      };

    } catch (err) {
      const msg = (err as Error).message;
      errors.push(msg);
      if (context) {
        this.missionController.addBlock(
          context.mission.missionId,
          'QUALITY_FAILED',
          msg,
        );
      }
      return { ok: false, context, errors, artifacts: [] };
    }
  }
}
