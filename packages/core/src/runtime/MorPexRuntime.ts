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
      const verArtifact: Artifact = { id: artifact.id, type: artifact.type as any, sourceTask: artifact.sourceTask, version: artifact.version, status: artifact.status as any, metadata: artifact.metadata, createdAt: artifact.createdAt };
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
