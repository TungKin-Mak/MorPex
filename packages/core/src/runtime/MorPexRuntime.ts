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
import type { CrossAgentLearningEngine } from '../agent/learning/CrossAgentLearningEngine.js';

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
  private learningEngine?: CrossAgentLearningEngine;

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
    learningEngine?: CrossAgentLearningEngine,
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
    this.learningEngine = learningEngine;
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
      // 从执行输出中提取文本内容（支持对象和字符串两种格式）
      const outputText = typeof execResult.output === 'string'
        ? execResult.output
        : execResult.output && typeof execResult.output === 'object'
          ? (execResult.output as any).text || (execResult.output as any).document || JSON.stringify(execResult.output, null, 2)
          : String(execResult.output || '');

      // 创建文档类型产物（包含完整文本）
      const docArtifact = this.artifactFacade.create(
        'output',
        'document',
        context.executionId,
        {
          goal: context.goal.objective,
          output: outputText,
          text: outputText,
        },
      );
      context.artifacts.push(docArtifact.id);

      // 创建代码类型产物（如果输出包含代码）
      const hasCode = outputText.includes('```') || /function|class|const |import |export /i.test(outputText);
      let codeArtifact: any = null;
      if (hasCode) {
        codeArtifact = this.artifactFacade.create(
          'source',
          'code',
          context.executionId,
          {
            goal: context.goal.objective,
            output: outputText,
            text: outputText,
            language: 'auto',
          },
        );
        context.artifacts.push(codeArtifact.id);
      }

      // ── Phase 4: Verification + Compliance + Approval ──
      const allArtifacts: Artifact[] = context.artifacts.map(id => ({
        id, type: 'document', sourceTask: context.executionId, version: 1,
        status: 'CREATED' as any, metadata: { output: outputText },
        createdAt: Date.now(), name: id, lineage: [], updatedAt: Date.now(),
      }));
      const verResult = await this.verificationEngine.verify(allArtifacts);
      const complianceResult = await this.complianceChecker.check(
        context.workflow.name,
        { title: context.goal.objective, category: context.goal.domain },
      );
      const approvalRequest = this.approvalGate.requestApproval(
        docArtifact.id,
        docArtifact.name,
        complianceResult,
        context.risk,
      );
      if (approvalRequest.decision === undefined) {
        this.missionController.addBlock(
          context.mission.missionId,
          'HUMAN_WAITING',
          `等待审批: ${docArtifact.name}`,
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
        artifactQuality: docArtifact ? 0.9 : 0.0,
      });

      // ── Phase 9: Self Evolution Analysis ──
      if (execResult.ok) {
        try {
          const evolutionResult = await this.evolutionLoop.evolve({
            taskSuccessRate: 1.0,
            avgLatency: execResult.duration,
            failurePatterns: [],
            artifactQuality: docArtifact ? 0.9 : 0.0,
          });
          console.log(`[MorPexRuntime] 🔄 进化分析: ${evolutionResult.proposals.length} 个提案`);
        } catch (_err) {
          // 进化分析失败不影响主流程
        }
      }

      const returnedArtifacts = [docArtifact];
      if (hasCode && codeArtifact) returnedArtifacts.push(codeArtifact);

      return {
        ok: true,
        context,
        executionResult: execResult,
        artifacts: returnedArtifacts,
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

  /**
   * learnFromVerification — 将 TaskVerifier 的验证结果注入学习系统
   *
   * 使系统能从验证失败中学习，避免重复错误。
   * 由 benchmark 或外部验证者调用。
   *
   * @param taskId      - 任务 ID
   * @param taskTitle   - 任务标题
   * @param checkpoints - 验证检查点结果（含 description, passed, score, matched, missing）
   * @returns 是否成功存储学习经验
   */
  learnFromVerification(
    taskId: string,
    taskTitle: string,
    checkpoints: Array<{
      description: string;
      passed: boolean;
      score: number;
      matched: string[];
      missing: string[];
    }>,
  ): boolean {
    if (!this.learningEngine) {
      console.log('[MorPexRuntime] ⚠️ 学习引擎未配置，跳过验证学习');
      return false;
    }

    try {
      const experiences = this.learningEngine.learnFromVerification(taskId, taskTitle, checkpoints);
      console.log(`[MorPexRuntime] ✅ 验证学习完成: ${experiences.length} 条经验存储`);

      // 同时将验证失败信息注入自我改进循环
      const failedCheckpoints = checkpoints
        .filter(cp => !cp.passed)
        .map(cp => cp.description);
      const passRate = checkpoints.length > 0
        ? checkpoints.filter(cp => cp.passed).length / checkpoints.length
        : 0;

      if (failedCheckpoints.length > 0) {
        this.evolutionLoop.evolve({
          taskSuccessRate: 1.0,
          avgLatency: 0,
          failurePatterns: failedCheckpoints,
          artifactQuality: passRate,
          verificationPassRate: passRate,
          failedCheckpoints,
        }).catch(() => {});
      }

      return true;
    } catch (err) {
      console.warn('[MorPexRuntime] ⚠️ 验证学习失败:', (err as Error).message);
      return false;
    }
  }
}
