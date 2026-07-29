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

// ── Ontology 迭代4：收敛 ──
import type { OntologyService } from '../ontology/OntologyService.js';
import type { ForcedQueryGuard } from '../ontology/ForcedQueryGuard.js';
import type { EvaluationEngine } from '../evaluation/EvaluationEngine.js';

export interface RunResult {
  ok: boolean;
  context: ExecutionContext;
  executionResult?: unknown;
  artifacts: unknown[];
  verification?: unknown;
  compliance?: unknown;
  approval?: unknown;
  experience?: unknown;
  /** 迭代4: Ontology 合规评估结果 */
  ontologyEval?: unknown;
  errors: string[];
}

export interface RunOptions {
  /** ⭐ P0: 模拟失败是否硬中止（默认 true） */
  simulationHardFail?: boolean;
  /** ⭐ P0: Ontology grounding 失败是否硬中止（默认 false） */
  ontologyHardFail?: boolean;
  /** ⭐ P0: 审批是否 await 人工决策（默认 false） */
  awaitApproval?: boolean;
  /** 审批超时（毫秒，默认 30 分钟） */
  approvalTimeoutMs?: number;
  /** 部门 ID（可选） */
  departmentId?: string;
  /** 执行模式 */
  mode?: 'auto' | 'mission' | 'dag' | 'fabric';
  /** 自定义扩展属性 */
  [key: string]: unknown;
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

  // ── Ontology 迭代4 ──
  private ontology: OntologyService | null = null;
  private forcedQueryGuard: ForcedQueryGuard | null = null;
  private piBridge: { generateText: (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }> } | null = null;
  private evaluationEngine: EvaluationEngine | null = null;

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

  /** setOntology — 注入 OntologyService（迭代4） */
  setOntology(o: OntologyService): void { this.ontology = o; }
  /** setForcedQueryGuard — 注入 ForcedQueryGuard（迭代4） */
  setForcedQueryGuard(g: ForcedQueryGuard): void { this.forcedQueryGuard = g; }
  /** setPiBridge — 注入 PiBridge（迭代4） */
  setPiBridge(b: { generateText: (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }> }): void { this.piBridge = b; }
  /** setEvaluationEngine — 注入 EvaluationEngine（迭代4） */
  setEvaluationEngine(e: EvaluationEngine): void { this.evaluationEngine = e; }

  async run(goal: string, options?: RunOptions): Promise<RunResult> {
    const errors: string[] = [];
    let context!: ExecutionContext;

    const simHardFail = options?.simulationHardFail ?? true;
    const ontoHardFail = options?.ontologyHardFail ?? false;
    const awaitApproval = options?.awaitApproval ?? false;

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
        if (simHardFail) {
          return {
            ok: false,
            context,
            errors: simResult.blockingIssues,
            artifacts: [],
          };
        }
        console.warn(`[MorPexRuntime] ⚠️ 模拟不可行但继续执行 (soft mode): ${simResult.blockingIssues.join('; ')}`);
      }

      // ── Phase 1.7: Ontology Grounded Reasoning（迭代4）──
      let ontologyProposal: any = null;
      if (this.ontology && this.forcedQueryGuard && this.piBridge) {
        try {
          const { runOntologyGroundedReasoning } = await import('../ontology/runOntologyGroundedReasoning.js');
          const result = await runOntologyGroundedReasoning({
            goal: context.goal.objective,
            missionId: context.mission.missionId,
            ontology: this.ontology,
            guard: this.forcedQueryGuard,
            piBridge: this.piBridge,
            extraContext: `MorPexRuntime 主执行路径 grounded reasoning。`,
            scenario: 'runtime-exec',
          });
          ontologyProposal = result.proposal;
          console.log(`[MorPexRuntime] 🏁 Ontology grounding 完成, 引用 ${result.proposal.referenced_object_ids.length} 个 ID`);

          // 空事实或引用无效 → 硬门禁：标记 human_review
          const needsReview = !result.hasUsefulFacts || !result.queryTrace.referenceCheck.valid;
          if (needsReview) {
            ontologyProposal.needs_human_review = true;
            if (!result.hasUsefulFacts) {
              console.warn(`[MorPexRuntime] ⚠️ Ontology grounding 无有效事实，标记审查`);
            }
            if (!result.queryTrace.referenceCheck.valid) {
              console.warn(`[MorPexRuntime] ⚠️ 引用校验失败: ${result.queryTrace.referenceCheck.missing.join(', ')}`);
            }
            if (ontoHardFail) {
              return {
                ok: false,
                context,
                errors: [`Ontology grounding 失败: ${!result.hasUsefulFacts ? '无有效事实' : '引用校验失败'}`],
                artifacts: [],
              };
            }
          }
        } catch (err) {
          const errMsg = `Ontology grounding 失败: ${(err as Error).message}`;
          console.error(`[MorPexRuntime] ❌ ${errMsg}`);
          this.missionController.addBlock(
            context.mission.missionId,
            'QUALITY_FAILED',
            errMsg,
          );
          if (ontoHardFail) {
            return { ok: false, context, errors: [errMsg], artifacts: [] };
          }
        }
      }

      // ── Phase 2: Execution（统一执行引擎）──
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

      // ── Phase 3: Artifact Creation（仅由 Runtime 创建，Engine 不再创建）──
      const outputText = typeof execResult.output === 'string'
        ? execResult.output
        : execResult.output && typeof execResult.output === 'object'
          ? (execResult.output as any).text || (execResult.output as any).document || JSON.stringify(execResult.output, null, 2)
          : String(execResult.output || '');

      const docArtifact = this.artifactFacade.create(
        'output',
        'document',
        context.executionId,
        { goal: context.goal.objective, output: outputText, text: outputText },
      );
      context.artifacts.push(docArtifact.id);

      const hasCode = outputText.includes('```') || /function|class|const |import |export /i.test(outputText);
      let codeArtifact: any = null;
      if (hasCode) {
        codeArtifact = this.artifactFacade.create(
          'source', 'code', context.executionId,
          { goal: context.goal.objective, output: outputText, text: outputText, language: 'auto' },
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
        // ⭐ P1-2: 主路径强制 Approval 阻塞
        // HIGH/CRITICAL 风险或设置了 awaitApproval 时阻塞等待
        const riskStr = String(context.risk || '').toUpperCase();
        const isHighRisk = riskStr === 'HIGH' || riskStr === 'CRITICAL';
        if (awaitApproval || isHighRisk) {
          const timeoutMs = options?.approvalTimeoutMs ?? 1_800_000; // 默认 30 分钟
          console.log(`[MorPexRuntime] ⏸️ 等待人工审批: ${docArtifact.name} (timeout=${timeoutMs}ms)`);
          const decided = await this.approvalGate.waitForDecision(approvalRequest.id, timeoutMs);
          if (decided.decision !== 'APPROVED') {
            return {
              ok: false,
              context,
              executionResult: execResult,
              artifacts: [docArtifact, codeArtifact].filter(Boolean),
              verification: verResult,
              compliance: complianceResult,
              approval: decided,
              errors: [`审批未通过: ${decided.decision ?? '超时'}`],
            };
          }
          console.log(`[MorPexRuntime] ✅ 审批通过: ${docArtifact.name}`);
        }
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
          console.warn('[MorPexRuntime] ⚠️ 进化分析失败:', (_err as Error).message);
        }
      }

      // ── Phase 9.5: Evaluation with Ontology Compliance（迭代4）──
      let ontologyEval: any = null;
      if (this.evaluationEngine && this.forcedQueryGuard) {
        try {
          ontologyEval = this.evaluationEngine.evaluate({
            plan: { steps: context.capabilities.length, capabilities: context.capabilities.map(c => c.name) },
            executionResult: { ok: execResult.ok, duration: execResult.duration, errors: [] },
            ontologyCompliance: {
              guard: this.forcedQueryGuard,
              executionId: context.executionId,
              referencedIds: ontologyProposal?.referenced_object_ids ?? [],
            },
          });
          if (ontologyEval.needsHumanReview) {
            console.warn(`[MorPexRuntime] ⚠️ Evaluation 标记 needsHumanReview`);
            this.missionController.addBlock(
              context.mission.missionId,
              'HUMAN_WAITING',
              `Ontology 合规检查不通过: 查询分=${ontologyEval.ontologyCompliance?.queryScore ?? '?'}, 引用分=${ontologyEval.ontologyCompliance?.referenceScore ?? '?'}`,
            );
          }
        } catch (err) {
          console.warn('[MorPexRuntime] ⚠️ Ontology evaluation 失败:', (err as Error).message);
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
        ontologyEval,
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
        }).catch((err: Error) => {
          console.warn('[MorPexRuntime] ⚠️ 进化分析失败:', err.message);
        });
      }

      return true;
    } catch (err) {
      console.warn('[MorPexRuntime] ⚠️ 验证学习失败:', (err as Error).message);
      return false;
    }
  }
}
