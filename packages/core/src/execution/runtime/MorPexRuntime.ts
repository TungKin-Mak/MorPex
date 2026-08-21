import { EventBus } from '../../infrastructure/common/EventBus.js';
import { PipelineOrchestrator } from './PipelineOrchestrator.js';
import { MissionController } from './mission/MissionController.js';
import { UnifiedExecutionEngine } from '../../execution/UnifiedExecutionEngine.js';
import type { ExecutionRequest } from '../../execution/UnifiedExecutionEngine.js';
import { ArtifactFacade } from '../../knowledge/artifact/ArtifactFacade.js';
import { VerificationEngine } from '../../evaluation/verification/VerificationEngine.js';
import { ComplianceChecker } from '../../governance/ComplianceChecker.js';
import { getSharedDeblackboxRecorder } from '../../infrastructure/observability/deblackbox/DeblackboxRecorder.js';
import { ApprovalGate } from '../../governance/ApprovalGate.js';
import { ExperienceMiner } from '../../evolution/ExperienceMiner.js';
import { ExecutionSimulator } from './simulation/ExecutionSimulator.js';
import { DynamicTeamOrchestrator } from '../../execution/DynamicTeamOrchestrator.js';
import type { ExecutionContext } from './ExecutionContext.js';
import type { ArtifactNode as Artifact } from '../../infrastructure/protocol/contracts/artifact-lifecycle.js';
import { SafetyMonitor } from '../../cognition/index.js';
import { SelfImprovementLoop } from '../../evolution/index.js';
import { systemMetadataGraph } from '../../knowledge/graph/SystemMetadataGraph.js';
import type { CrossAgentLearningEngine } from '../../cognition/learning/agent/CrossAgentLearningEngine.js';
import type { IEventStore } from '../../infrastructure/protocol/events/store/IEventStore.js';

// ── Ontology 迭代4：收敛 ──
import type { OntologyService } from '../../knowledge/ontology/OntologyService.js';
import type { ForcedQueryGuard } from '../../gate/ForcedQueryGuard.js';
import type { EvaluationEngine } from '../../evaluation/EvaluationEngine.js';

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
  /** P1 部门 Space：部门经理 persona（执行路径编排器注入；可选） */
  managerPersona?: string;
  /** P1 部门 Space：工位能力提示（可选） */
  capabilities?: string[];
  /** 功能③：聚焦上下文（CompanyFacade 装配产出，注入执行路径；可选） */
  assembledContext?: string;
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
  /** 功能③：EventStore 引用（可选，历史抽离完整快照持久化用；未注入时降级为仅事件广播） */
  private eventStore: IEventStore | null = null;
  /** 功能③：上下文装配引擎（orchestrate 后装配，读真实 Mission 数据；缺省 null 兼容） */
  private contextAssemblyEngine: import('../../knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine | null = null;
  /** 统一规划器（Mission 编排内先规划再执行——所有引擎共享；缺省 null 兼容） */
  private planner: import('./mission/MissionRuntime.js').MissionPlanner | null = null;

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
    // Wave 5 注：直连 SIL 为冗余只读分析（只产提案、无生产变更，SIL 不自动审批/晋升）；
    // 权威演化路径 = ActiveEvolutionTrigger（事件驱动，SIL 由 bootstrap 注入）。
    this.learningEngine = learningEngine;
    this.pipeline = new PipelineOrchestrator(eventBus, missionController, teamOrchestrator);
  }

  /** setOntology — 注入 OntologyService（迭代4） */
  setOntology(o: OntologyService): void { this.ontology = o; }

  /** setEventStore — 注入 EventStore（功能③ 历史抽离：完整快照入权威存储，按 taskRef 召回） */
  setEventStore(es: IEventStore): void { this.eventStore = es; }

  /** setContextAssemblyEngine — 注入上下文装配引擎（功能③ 聚焦装配，orchestrate 后调用） */
  setContextAssemblyEngine(engine: import('../../knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine | null): void {
    this.contextAssemblyEngine = engine;
  }

  /** setPlanner — 注入统一规划器（Mission 编排内先规划；与 MissionRuntime 同一实例，防重复规划） */
  setPlanner(planner: import('./mission/MissionRuntime.js').MissionPlanner | null): void {
    this.planner = planner;
  }
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

      // S34 可观测：主执行管线启动事件（L5 驱动器，供 /audit 验证主链路是否运行）
      // ⚠️ 必须在 orchestrate 之后（拿到 context.executionId，与组件事件同一 id，锚定才有效）
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'runtime.started',
        timestamp: Date.now(),
        executionId: context.executionId,
        source: 'morpex-runtime',
        payload: { goal: goal.substring(0, 80), mode: 'auto' },
      });

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
        // ═══ 恢复回路接线：soft 模式决定继续 → 自动解除资源阻塞，恢复 Mission ACTIVE ═══
        // （此前 Mission 保持 BLOCKED 无恢复入口；autoRecover 对非人工阻塞自动恢复）
        const recovered = this.missionController.autoRecover(context.mission.missionId);
        if (recovered.recovered) {
          console.log(`[MorPexRuntime] 🔄 Mission 自动恢复 ACTIVE（${recovered.actions.join('; ')}）`);
        }
      }

      // ── Phase 1.7: Ontology Grounded Reasoning（迭代4）──
      let ontologyProposal: any = null;
      if (this.ontology && this.forcedQueryGuard && this.piBridge) {
        try {
          const { runOntologyGroundedReasoning } = await import('../../gate/runOntologyGroundedReasoning.js');
          // 功能③ C：聚焦上下文（CompanyFacade 装配产出）并入 extraContext；
          // 功能② 协同：active keyword 规则 description 前置注入（平台信息前置预防，比事后拦截省钱）
          let extraCtx = `MorPexRuntime 主执行路径 grounded reasoning。`;
          if (options?.assembledContext) {
            extraCtx += `\n\n【聚焦上下文】\n${options.assembledContext}`;
            // S34 可观测：context.assembled 真实 emit（此前为死事件）
            this.eventBus.emit({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'context.assembled',
              timestamp: Date.now(),
              executionId: context.executionId,
              source: 'morpex-runtime',
              payload: {
                missionId: context.mission.missionId,
                goal: goal.substring(0, 80),
                domain: context.goal.domain,
                summaryLength: options.assembledContext.length,
              },
            });
          }
          try {
            const { RuleRegistry } = await import('../../gate/rules/RuleRegistry.js');
            const activeRules = RuleRegistry.getActiveRules(context.goal.domain);
            const ruleConstraints = activeRules
              .filter((r) => r.ruleType === 'keyword' && r.description)
              .map((r) => `- ${r.description}`);
            if (ruleConstraints.length > 0) {
              extraCtx += `\n\n【规则约束（前置）】\n${ruleConstraints.join('\n')}`;
            }
          } catch {
            // 规则约束注入失败不阻断
          }
          const result = await runOntologyGroundedReasoning({
            goal: context.goal.objective,
            missionId: context.mission.missionId,
            ontology: this.ontology,
            guard: this.forcedQueryGuard,
            piBridge: this.piBridge,
            eventBus: this.eventBus, // S34 可观测：传 bus 使 ontology.grounded 事件可达观测面
            extraContext: extraCtx,
            scenario: 'runtime-exec',
            // Phase 2 F：domain 上下文传递——goal→domain 映射打通，getActiveRules(domain) 按域过滤
            domain: context.goal.domain,
            // Phase 2 E：L5 预算接线——Gate 内 LLM 调用（含规则重试）token 估算上报（可观测，不阻断）
            onTokenUsage: (tokens) => {
              this.eventBus.emit({
                id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'execution.gate.token_usage',
                timestamp: Date.now(),
                executionId: context.mission.missionId,
                source: 'gate',
                payload: { tokens, goal: context.goal.objective, domain: context.goal.domain },
              });
              // ═══ 去黑盒化（黑盒⑧）：异步 token 上报持久化双写（重启后成本可追溯）═══
              try {
                getSharedDeblackboxRecorder().record({
                  category: 'cost.llm.call',
                  source: 'gate-token-usage',
                  executionId: context.mission.missionId,
                  level: 'L1',
                  isError: false,
                  summary: {
                    tokens,
                    goal: context.goal.objective,
                    domain: context.goal.domain ?? null,
                    decision: 'token 上报持久化',
                    reasoning: '门禁 LLM 调用 token 异步上报，双写持久化（重启可追溯）',
                  },
                });
              } catch (err) {
                console.warn('[MorPexRuntime] ⚠️ token 上报持久化失败（忽略）:', err instanceof Error ? err.message : String(err));
              }
            },
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

      // ── Phase 1.6 统一规划（Mission 编排内先规划再执行——所有引擎共享，mode 收敛）──
      //    DeliveryPlannerAdapter 内部发 planner.plan.started/completed；MissionRuntime FSM 复用已有 plan 防重复
      if (this.planner && !(context.mission as { plan?: unknown }).plan) {
        try {
          // MissionState 无 goal/id 字段（字段为 objective/missionId）——构造 DeliveryPlannerAdapter 期望的 Mission 形状。
          // ⚠️ 仅提供 adapter 实际消费的字段（id/goal/departmentId）；完整 Mission 由 MissionRuntime 持有时走正规 createPlan。
          // （as unknown as Mission：形状适配，非 as never——字段名仍受 Mission 类型校验）
          const plan = await this.planner.createPlan({
            id: context.mission.missionId,
            goal: context.goal.objective,
            departmentId: context.team.departments[0],
          } as unknown as import('./mission/types.js').Mission);
          (context.mission as { plan?: unknown }).plan = plan;
          console.log(`[MorPexRuntime] 📋 统一规划完成: ${(plan as { steps?: unknown[] }).steps?.length ?? 0} 步`);
        } catch (err) {
          console.warn('[MorPexRuntime] ⚠️ 统一规划失败（非阻断，由引擎兜底）:', (err as Error).message);
        }
      }

      // ── Phase 1.7 功能③：聚焦装配（orchestrate 后统一执行——Mission 已创建，读真实数据）──
      //    goal_graph/mission_state Provider 读真实 Goal/Mission；taskRef=真实 missionId；非阻断
      let focusedContext: string | undefined;
      if (this.contextAssemblyEngine) {
        try {
          const assembled = await this.contextAssemblyEngine.assemble({
            missionId: context.mission.missionId,
            goal: context.goal.objective,
            domain: context.goal.domain ?? (context.team.departments[0] as string | undefined),
            tags: context.team.departments[0] ? [context.team.departments[0]] : undefined,
            currentTask: { taskId: context.mission.missionId },
            // AgentStatusProvider 读真实 team 概览（orchestrate 后 team 已创建）
            teamAgents: (context.team?.members ?? []).map((m) => ({
              id: m.agentId,
              role: m.role,
              status: m.status,
            })),
          });
          if (assembled.focusedSummary) {
            focusedContext = assembled.focusedSummary;
            console.log(`[MorPexRuntime] 🧩 聚焦上下文已装配 (${assembled.focusedSummary.length} 字符, mission=${context.mission.missionId})`);
            // context.assembled 真实 emit（装配统一在 orchestrate 后执行；旧 CompanyFacade 注入分支已废弃，
            // 此事件此前成为死事件——模式收敛后装配移到此处，同步复活）
            this.eventBus.emit({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'context.assembled',
              timestamp: Date.now(),
              executionId: context.executionId,
              source: 'morpex-runtime',
              payload: {
                missionId: context.mission.missionId,
                goal: goal.substring(0, 80),
                domain: context.goal.domain,
                summaryLength: assembled.focusedSummary.length,
              },
            });
          }
        } catch (err) {
          console.warn('[MorPexRuntime] ⚠️ 上下文装配失败（非阻断，继续执行）:', (err as Error).message);
        }
      }

      // ── Phase 2: Execution（统一执行引擎）──
      // ═══ 会话 15（去兜底化）：模式内部化——引擎现行单路径（简单操作类→原语快路径；其余→总大脑编排）═══
      const execRequest: ExecutionRequest = {
        goal: context.goal.objective,
        departmentId: context.team.departments[0],
        managerPersona: options?.managerPersona,
        capabilities: options?.capabilities,
        context: {
          executionId: context.executionId,
          missionId: context.mission.missionId,
          teamId: context.team.id,
          ...(focusedContext ? { assembledContext: focusedContext } : {}),
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
      const outObj = execResult.output as { text?: string; document?: string } | undefined;
      const outputText = typeof execResult.output === 'string'
        ? execResult.output
        : execResult.output && typeof execResult.output === 'object'
          ? outObj?.text || String(outObj?.document ?? '') || JSON.stringify(execResult.output, null, 2)
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
        // ArtifactNode.status = ArtifactLifecycleStatus，'CREATED' 为合法值（artifact-lifecycle.ts）
        status: 'CREATED', metadata: { output: outputText },
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

      // ── Phase 5: Experience Mining（会话 16c：步骤级失败信号 + 可学习事件）──
      const failureReport = (execResult.metrics?.failureReport as Array<{ step: string; error: string }> | undefined);
      const minedEvents = await this.experienceMiner.mineFromCompletedTask({
        goal: context.goal.objective,
        taskId: context.executionId,
        result: execResult.ok ? 'success' : 'failure',
        capabilities: context.capabilities.map(c => c.name),
        departmentId: context.team.departments[0],
        failureReport,
        stepStats: {
          totalSteps: (execResult.metrics?.stepsExecuted as number | undefined) ?? 0,
          failedSteps: failureReport?.length ?? 0,
          retryableFails: (failureReport ?? []).filter(f => !/GateContextRequiredError|需要 Gate 凭证|安全拦截|权限不足/.test(f.error)).length,
          nonRetryableFails: (failureReport ?? []).filter(f => /GateContextRequiredError|需要 Gate 凭证|安全拦截|权限不足/.test(f.error)).length,
          totalRetries: 0, // 步骤级 retries 汇总由 execution.step.result 事件承载（观测端聚合）
        },
      });

      // ═══ 学习回路接线（审计发现 learnFromOutcome 零调用）：任务完成后结果学习 ═══
      // CrossAgentLearningEngine 的 learnFromOutcome 此前无调用点——经验沉淀只走
      // experienceMiner，学习引擎的"结果学习"能力未接主线。此处补接（非阻断）。
      if (this.learningEngine) {
        try {
          const outcome = {
            success: execResult.ok,
            completedTasks: execResult.ok ? 1 : 0,
            failedTasks: execResult.ok ? 0 : 1,
          };
          this.learningEngine.learnFromOutcome(context.mission.missionId, outcome, 'mission-runtime');
        } catch (err) {
          console.warn('[MorPexRuntime] learnFromOutcome 失败（非阻断）:', (err as Error).message);
        }
      }

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
      // Wave 5 注：直连 SIL 为冗余只读分析（只产提案、无生产变更）；权威路径 = AET 事件驱动。
      if (execResult.ok) {
        try {
          const evolutionResult = await this.evolutionLoop.evolve({
            taskSuccessRate: 1.0,
            avgLatency: execResult.duration,
            failurePatterns: [],
            artifactQuality: docArtifact ? 0.9 : 0.0,
          });
          console.log(`[MorPexRuntime] 🔄 进化分析: ${evolutionResult.proposals.length} 个提案`);
          // S34 可观测：演化分析完成事件（L8 层此前静默）
          this.eventBus.emit({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'evolution.completed',
            timestamp: Date.now(),
            executionId: context.executionId,
            source: 'evolution-sandbox',
            payload: { missionId: context.mission.missionId, proposals: evolutionResult.proposals?.length ?? 0 },
          });
        } catch (_err) {
          console.warn('[MorPexRuntime] ⚠️ 进化分析失败:', (_err as Error).message);
        }
      }

      // ── Phase 9.5: Evaluation with Ontology Compliance（迭代4）──
      let ontologyEval: any = null;
      if (this.evaluationEngine && this.forcedQueryGuard) {
        try {
          ontologyEval = this.evaluationEngine.evaluate({
            // Wave 3a：携带 missionId/departmentId → L6 事件可被 L7 按部门追踪（此前事件桥是死的）
            missionId: context.mission.missionId,
            departmentId: context.team?.departments?.[0],
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
          // S34 可观测：evaluation 完成事件（L6 层此前静默，观测面无法确认其是否运行）
          this.eventBus.emit({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'evaluation.completed',
            timestamp: Date.now(),
            executionId: context.executionId,
            source: 'evaluation-engine',
            payload: {
              missionId: context.mission.missionId,
              decision: ontologyEval.decision,
              missionQuality: ontologyEval.missionQuality,
              needsHumanReview: ontologyEval.needsHumanReview,
              queryScore: ontologyEval.ontologyCompliance?.queryScore,
              referenceScore: ontologyEval.ontologyCompliance?.referenceScore,
            },
          });
        } catch (err) {
          console.warn('[MorPexRuntime] ⚠️ Ontology evaluation 失败:', (err as Error).message);
        }
      }

      const returnedArtifacts = [docArtifact];
      if (hasCode && codeArtifact) returnedArtifacts.push(codeArtifact);

      // ── Phase 9.7 功能③ D：历史抽离最小版（原则②——已完成历史进权威存储，工作上下文只留摘要） ──
      // Mission 完成 + L6 评价后：生成摘要（goal + 结果 + keyRefs + score）→ 事件入 EventStore；
      // 摘要同时存入 RunResult.experience，供下次装配作"近期摘要"片段源（Phase 1 最小版：先写入+承载）。
      // 任务身份 ID（功能③：当前以 missionId 为任务主键；goalId/planId 细粒度留后续）
      const taskRef = context.mission.missionId;
      const missionSummary = {
        taskRef,
        missionId: context.mission.missionId,
        goal: context.goal.objective.substring(0, 120),
        result: execResult.ok ? 'success' : 'failure',
        keyRefs: ontologyProposal?.referenced_object_ids?.slice(0, 10) ?? [],
        score: ontologyEval?.missionQuality ?? undefined,
        archivedAt: Date.now(),
      };
      try {
        this.eventBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'context.archived',
          timestamp: Date.now(),
          executionId: context.executionId,
          source: 'morpex-runtime',
          payload: missionSummary,
        });
      } catch (err) {
        console.warn('[MorPexRuntime] ⚠️ 历史抽离事件写入失败（非阻断）:', (err as Error).message);
      }

      // 功能③ 抽离三级·完整快照：完整 ExecutionContext 快照入 EventStore（权威存储，按 taskRef 召回精确还原）
      //   防召回时只有摘要导致信息丢失；eventStore 未注入时降级（仅事件广播，不阻断）
      if (this.eventStore) {
        try {
          await this.eventStore.append({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'context.snapshot',
            timestamp: Date.now(),
            executionId: context.executionId,
            source: 'morpex-runtime',
            payload: {
              taskRef,
              missionId: context.mission.missionId,
              goal: context.goal.objective.substring(0, 200),
              domain: context.goal.domain,
              result: execResult.ok ? 'success' : 'failure',
              workflow: context.workflow,
              budget: context.budget,
              risk: context.risk,
              artifacts: context.artifacts,
              // 功能③ 快照补全（防召回信息丢失）：团队/能力/时长/执行结果摘要——
              // 召回时除摘要外可还原"当时发生了什么"（team 构成、用了哪些能力、跑了多久）
              team: {
                departments: context.team?.departments ?? [],
                members: context.team?.members?.length ?? 0,
              },
              capabilitiesCount: context.capabilities?.length ?? 0,
              startedAt: context.startedAt,
              duration: execResult.duration,
              score: ontologyEval?.missionQuality ?? undefined,
              archivedAt: Date.now(),
            },
          });
        } catch (err) {
          console.warn('[MorPexRuntime] ⚠️ 完整快照写入 EventStore 失败（非阻断）:', (err as Error).message);
        }
      }

      // S34 可观测：主管线完成事件（success → /audit 标记 morpex-runtime ACTIVE/exercised）
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'runtime.completed',
        timestamp: Date.now(),
        executionId: context.executionId,
        source: 'morpex-runtime',
        payload: {
          ok: true,
          missionId: context.mission.missionId,
          artifacts: returnedArtifacts.length,
          duration: execResult.duration,
        },
      });

      return {
        ok: true,
        context,
        executionResult: execResult,
        artifacts: returnedArtifacts,
        // 功能③ D：历史抽离——Mission 摘要并入 experience（工作上下文只保留 {missionId, 摘要, keyRefs, score}）
        experience: { mined: true, archived: missionSummary },
        verification: verResult,
        compliance: complianceResult,
        approval: approvalRequest,
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
        // Wave 5 注：冗余只读分析，SIL 只产提案（pending），不自动审批/晋升。
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
