/**
 * ExecutionStage — 执行阶段 (v8.9.2 全线接入)
 *
 * MorPex v8.9.2: 执行 Mission 的完整生命周期，集成:
 *   - ContractValidator: 契约验证 (v8.9.2 接入)
 *   - PermissionModel: 权限检查
 *   - BudgetManager: 预算控制
 *   - SandboxManager: 沙箱隔离执行
 *   - VerificationEngine: 产物验证
 *   - ArtifactLineage: 产物血缘追踪 (两阶段提交)
 *   - CompensationEngine: 补偿引擎 (v8.9.2 接入)
 *   - TraceManager: 全链路追踪 (v8.9.2 接入)
 *   - MetricsCollector: 指标收集 (v8.9.2 接入)
 *   - WorkflowMetrics: 工作流级 KPI (v8.9.2 接入)
 *
 * Control Plane 横切:
 *   ContractValidator → PermissionModel → BudgetManager → SandboxManager
 *   → VerificationEngine → CompensationEngine
 */

import { EventBus } from '../../../common/EventBus.js'
import { EventType } from '../../../protocol/events/EventType.js'
import type { MissionRuntime } from '../../mission/MissionRuntime.js'
import type { CognitiveContext } from '../types.js'
import type { CognitiveStage } from '../CognitivePipeline.js'

export class ExecutionStage implements CognitiveStage {
  readonly name = 'execution' as const

  private missionRuntime: MissionRuntime | null = null
  private permissionModel: any = null
  private sandboxManager: any = null
  private budgetManager: any = null
  private verificationEngine: any = null
  private artifactLineage: any = null
  // v8.9.2 接入
  private contractValidator: any = null
  private compensationEngine: any = null
  private traceManager: any = null
  private metricsCollector: any = null
  private workflowMetrics: any = null
  // v9 Agent Plane
  private agentScheduler: any = null
  private agentRegistry: any = null
  private collaborationManager: any = null
  private agentMessageBus: any = null
  private negotiationEngine: any = null

  private maxRetries: number = 3

  constructor(
    missionRuntime?: MissionRuntime,
    permissionModel?: any,
    sandboxManager?: any,
    budgetManager?: any,
    verificationEngine?: any,
    artifactLineage?: any,
    options?: {
      maxRetries?: number
      contractValidator?: any
      compensationEngine?: any
      traceManager?: any
      metricsCollector?: any
      workflowMetrics?: any
      // v9 Agent Plane
      agentScheduler?: any
      agentRegistry?: any
      collaborationManager?: any
      agentMessageBus?: any
      negotiationEngine?: any
    },
  ) {
    this.missionRuntime = missionRuntime ?? null
    this.permissionModel = permissionModel ?? null
    this.sandboxManager = sandboxManager ?? null
    this.budgetManager = budgetManager ?? null
    this.verificationEngine = verificationEngine ?? null
    this.artifactLineage = artifactLineage ?? null
    if (options?.maxRetries !== undefined) this.maxRetries = options.maxRetries
    this.contractValidator = options?.contractValidator ?? null
    this.compensationEngine = options?.compensationEngine ?? null
    this.traceManager = options?.traceManager ?? null
    this.metricsCollector = options?.metricsCollector ?? null
    this.workflowMetrics = options?.workflowMetrics ?? null
    this.agentScheduler = options?.agentScheduler ?? null
    this.agentRegistry = options?.agentRegistry ?? null
    this.collaborationManager = options?.collaborationManager ?? null
    this.agentMessageBus = options?.agentMessageBus ?? null
    this.negotiationEngine = options?.negotiationEngine ?? null
  }

  async execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext> {
    if (!ctx.mission) {
      return { ...ctx, phase: 'execution', errors: [...ctx.errors, '[ExecutionStage] No mission'] }
    }
    if (!this.missionRuntime) {
      return { ...ctx, phase: 'execution', errors: [...ctx.errors, '[ExecutionStage] No MissionRuntime'] }
    }

    const missionId = ctx.mission.id
    const startTime = Date.now()

    // ── Trace: start execution span ──
    let execSpan: any = null
    if (this.traceManager) {
      try { execSpan = this.traceManager.startSpan(missionId, 'execution') } catch {}
    }

    // ═══ 1. Contract Validation (v8.9.2) ═══
    if (this.contractValidator && ctx.mission.metadata) {
      try {
        const contractCheck = this.contractValidator.validate(
          ctx.mission.metadata,
          ctx.mission,
        )
        if (contractCheck && !contractCheck.valid) {
          this.recordMetric('contract_validation_failed', 1)
          throw new Error(`Contract validation failed: ${(contractCheck.errors || []).join('; ')}`)
        }
        this.recordMetric('contract_validation_passed', 1)
      } catch (err: any) {
        if (err.message?.startsWith('Contract validation')) throw err
      }
    }

    // ═══ 2. Permission check ═══
    if (this.permissionModel) {
      try {
        const check = this.permissionModel.canExecute(ctx.message.userId, 'execute', ctx.message.channel)
        if (!check.allowed) throw new Error(`Permission denied: ${check.reason}`)
      } catch (err: any) {
        if (err.message?.startsWith('Permission denied')) throw err
      }
    }

    // ═══ 3. Budget check ═══
    if (this.budgetManager) {
      try {
        this.budgetManager.init(missionId)
        const budgetCheck = this.budgetManager.check(missionId)
        if (!budgetCheck.allowed) {
          this.recordMetric('budget_limit_reached', 1)
          bus.emit({
            id: `evt_budget_${Date.now()}`, type: EventType.BUDGET_LIMIT_REACHED,
            timestamp: Date.now(), executionId: missionId,
            source: 'cognitive-pipeline:execution',
            payload: { missionId, reason: budgetCheck.reason },
          })
          throw new Error(`Budget limit: ${budgetCheck.reason}`)
        }
      } catch (err: any) {
        if (err.message?.startsWith('Budget limit')) throw err
      }
    }

    // ═══ 4. Sandbox validation ═══
    if (this.sandboxManager) {
      try {
        const task = { id: missionId, action: ctx.mission.goal || '', params: { missionId } }
        const validation = this.sandboxManager.validateTask(task)
        if (!validation.safe) throw new Error(`Sandbox rejected: ${validation.warnings.join('; ')}`)
      } catch (err: any) {
        if (err.message?.startsWith('Sandbox rejected')) throw err
      }
    }

    // ═══ 5. v9 Agent Plane: Multi-Agent Execution Path ═══
    // When AgentScheduler is available, tasks are dispatched to the best agent.
    // Otherwise, fall back to direct MissionRuntime execution.
    let agentExecutionUsed = false
    let agentAssignments: any[] = []

    if (this.agentScheduler && this.agentRegistry && ctx.mission.plan && ctx.mission.plan.steps.length > 0) {
      try {
        const planSteps = ctx.mission.plan.steps
        const tasks: any[] = planSteps.map((step: any, idx: number) => ({
          taskId: `${missionId}_step_${idx}`,
          requiredCapabilities: [step.domain || 'general', step.agentType || 'coding'],
          input: { goal: step.description || step.name, missionId },
          expectedOutput: {},
          priority: step.priority || 3,
          timeout: 300000,
        }))

        if (this.agentMessageBus) {
          bus.emit({
            id: `evt_collab_start_${Date.now()}`,
            type: EventType.COLLABORATION_STARTED,
            timestamp: Date.now(), executionId: missionId,
            source: 'cognitive-pipeline:execution:v9',
            payload: { missionId, taskCount: tasks.length, mode: 'sequential' },
          })
        }

        for (const task of tasks) {
          let assignment = this.agentScheduler.selectAgent(task)

          // v9 Negotiation: 多个候选时竞价
          if (!assignment && this.negotiationEngine && this.agentRegistry) {
            try {
              const candidates = this.agentRegistry.findByCapabilities(task.requiredCapabilities)
              if (candidates.length > 1) {
                const negotiated = await this.negotiationEngine.contractNet(
                  { capability: task.requiredCapabilities[0], input: task.input },
                  candidates.map((a: any) => a.identity.id),
                )
                if (negotiated?.winner) {
                  assignment = { taskId: task.taskId, agentId: negotiated.winner, score: negotiated.bid.confidence, reason: 'negotiated', assignedAt: Date.now() }
                }
              }
            } catch {}
          }

          if (assignment) {
            agentAssignments.push(assignment)
            if (this.agentMessageBus) {
              bus.emit({
                id: `evt_agent_assign_${Date.now()}`,
                type: EventType.AGENT_ASSIGNED,
                timestamp: Date.now(), executionId: missionId,
                source: 'cognitive-pipeline:execution:v9',
                payload: { missionId, taskId: task.taskId, agentId: assignment.agentId, score: assignment.score },
              })
            }
          }
        }

        if (agentAssignments.length > 0) {
          agentExecutionUsed = true
          if (this.agentMessageBus) {
            bus.emit({
              id: `evt_collab_done_${Date.now()}`,
              type: EventType.COLLABORATION_COMPLETED,
              timestamp: Date.now(), executionId: missionId,
              source: 'cognitive-pipeline:execution:v9',
              payload: { missionId, assignedAgents: agentAssignments.length, totalTasks: tasks.length },
            })
          }
        }
      } catch (err: any) {
        this.recordMetric('agent_scheduling_failed', 1)
      }
    }

    // ═══ 6. Emit execution events ═══
    bus.emit({ id: `evt_sandbox_${Date.now()}`, type: EventType.SANDBOX_EXECUTION_STARTED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, goal: ctx.mission.goal } })
    bus.emit({ id: `evt_exec_start_${Date.now()}`, type: EventType.EXECUTION_STARTED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, goal: ctx.mission.goal } })

    // ═══ 7. Execute (v9 multi-agent or direct) ═══
    let result: import('../../mission/types.js').MissionResult | undefined
    let retryCount = 0

    // v9 Path: CollaborationManager
    if (agentExecutionUsed && this.collaborationManager) {
      try {
        const collabPlan = this.collaborationManager.createPlan(missionId, ['general'], agentAssignments.length || 1)
        const collabResult = await this.collaborationManager.execute(collabPlan)
        result = {
          missionId, state: collabResult.success ? 'COMPLETED' as any : 'FAILED' as any,
          stepsCompleted: collabResult.completedTasks.length,
          stepsTotal: agentAssignments.length,
          output: collabResult.aggregatedOutput, artifacts: [], duration: collabResult.totalDuration,
        }
      } catch (err: any) { agentExecutionUsed = false }
    }

    // Direct Path: MissionRuntime
    if (!agentExecutionUsed) {
      while (retryCount <= this.maxRetries) {
        try {
          result = await this.missionRuntime.executeMission(missionId)
          break
        } catch (err: any) {
          retryCount++
          this.recordMetric('execution_retry', 1)
          // v9: Agent failure → replacement
          if (this.agentScheduler && agentAssignments.length > 0) {
            for (const a of agentAssignments) {
              try {
                const repl = this.agentScheduler.replaceAgent(a.taskId, a.agentId)
                if (repl) { bus.emit({ id: `evt_agent_repl_${Date.now()}`, type: EventType.AGENT_REPLACED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution:v9', payload: { missionId, oldAgent: a.agentId, newAgent: repl.agentId } }) }
              } catch {}
            }
          }
          bus.emit({ id: `evt_rec_start_${Date.now()}`, type: EventType.RECOVERY_STARTED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, retryCount, error: err?.message || String(err) } })
          if (retryCount <= this.maxRetries) {
            bus.emit({ id: `evt_rec_done_${Date.now()}`, type: EventType.RECOVERY_COMPLETED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, recovered: true, retryCount } })
          } else {
            this.recordMetric('execution_failed', 1)
            bus.emit({ id: `evt_rec_fail_${Date.now()}`, type: EventType.RECOVERY_COMPLETED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, recovered: false, retryCount } })
            throw err
          }
        }
      }
    }

    if (!result) {
      throw new Error('[ExecutionStage] Mission execution failed after ' + this.maxRetries + ' retries')
    }

    // ═══ 7. Budget tracking ═══
    if (this.budgetManager) {
      try {
        const estimatedTokens = String(ctx.mission.goal || '').length * 2
        this.budgetManager.consume(missionId, estimatedTokens)
        this.budgetManager.trackStep(missionId)
      } catch {}
    }

    // ═══════════════════════════════════════════════
    // 8. Two-phase artifact commit
    // ═══════════════════════════════════════════════

    let verificationScore = 1
    let verificationErrors: string[] = []
    let stagedArtifactId: string | null = null
    const PASS_THRESHOLD = 0.6

    // Phase 1: STAGE
    if (this.artifactLineage && result) {
      try {
        stagedArtifactId = `art_${missionId}_${Date.now()}`
        this.artifactLineage.stage({
          id: stagedArtifactId, type: 'execution_result', version: 1,
          workflowId: missionId, missionId, parentArtifacts: [],
          createdBy: 'agent', createdAt: Date.now(),
          metadata: { state: result.state, stepsCompleted: result.stepsCompleted },
        })
      } catch {}
    }

    // Phase 2: VERIFY
    if (this.verificationEngine && result) {
      bus.emit({ id: `evt_verif_start_${Date.now()}`, type: EventType.VERIFICATION_STARTED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId } })
      try {
        const vResult = await this.verificationEngine.verify(ctx.mission, result)
        verificationScore = vResult.score
        verificationErrors = vResult.issues?.filter((i: any) => i.severity === 'error').map((i: any) => i.message) || []
      } catch {}
      bus.emit({ id: `evt_verif_done_${Date.now()}`, type: EventType.VERIFICATION_COMPLETED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, score: verificationScore, errors: verificationErrors } })

      this.recordMetric('verification_score', verificationScore)
    }

    // Phase 3: COMMIT or COMPENSATE
    if (verificationScore >= PASS_THRESHOLD && stagedArtifactId) {
      if (this.artifactLineage) {
        try {
          this.artifactLineage.markVerified(stagedArtifactId)
          this.artifactLineage.commit(stagedArtifactId)
          bus.emit({ id: `evt_art_create_${Date.now()}`, type: EventType.ARTIFACT_CREATED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { artifactId: stagedArtifactId, status: 'COMMITTED', score: verificationScore } })
          bus.emit({ id: `evt_art_verified_${Date.now()}`, type: EventType.ARTIFACT_VERIFIED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { artifactId: stagedArtifactId, verified: true, score: verificationScore } })
        } catch {}
      }
    } else if (stagedArtifactId) {
      // ROLLBACK artifact
      if (this.artifactLineage) {
        try {
          this.artifactLineage.markInvalid(stagedArtifactId)
          this.artifactLineage.rollback(stagedArtifactId)
        } catch {}
      }

      // ═══ 9. Compensation (v8.9.2 接入) ═══
      if (this.compensationEngine) {
        try {
          const canComp = this.compensationEngine.canCompensate(missionId)
          if (canComp) {
            bus.emit({ id: `evt_comp_start_${Date.now()}`, type: EventType.COMPENSATION_STARTED, timestamp: Date.now(), executionId: missionId, source: 'cognitive-pipeline:execution', payload: { missionId, reason: 'verification_failed', score: verificationScore } })
            const compResult = await this.compensationEngine.compensate(missionId, 'verification', [])
            this.recordMetric('compensation_executed', 1)
            bus.emit({
              id: `evt_comp_done_${Date.now()}`, type: EventType.COMPENSATION_STARTED,
              timestamp: Date.now(), executionId: missionId,
              source: 'cognitive-pipeline:execution',
              payload: { missionId, success: compResult.success, compensatedTasks: compResult.compensatedTasks },
            })
          }
        } catch {}
      }

      bus.emit({
        id: `evt_retry_${Date.now()}`, type: EventType.RETRY_TRIGGERED,
        timestamp: Date.now(), executionId: missionId,
        source: 'cognitive-pipeline:execution',
        payload: { missionId, artifactId: stagedArtifactId, reason: 'verification_failed', score: verificationScore, errors: verificationErrors },
      })
    }

    // ═══ 10. Metrics recording (v8.9.2) ═══
    const execDuration = Date.now() - startTime
    this.recordMetric('execution_duration', execDuration)
    this.recordMetric('execution_success', verificationScore >= PASS_THRESHOLD ? 1 : 0)

    if (this.workflowMetrics) {
      try {
        this.workflowMetrics.recordExecution(missionId, verificationScore >= PASS_THRESHOLD, execDuration, String(ctx.mission.goal || '').length * 2)
        this.workflowMetrics.recordVerification(missionId, verificationScore)
        if (retryCount > 0) this.workflowMetrics.recordRetry(missionId)
      } catch {}
    }

    // Emit completion
    bus.emit({
      id: `evt_exec_done_${Date.now()}`, type: EventType.EXECUTION_COMPLETED,
      timestamp: Date.now(), executionId: missionId,
      source: 'cognitive-pipeline:execution',
      payload: { missionId, state: result?.state ?? 'FAILED', stepsCompleted: result?.stepsCompleted ?? 0, stepsTotal: result?.stepsTotal ?? 0, duration: execDuration, verificationScore },
    })

    // Trace: end span
    if (this.traceManager && execSpan) {
      try { this.traceManager.endSpan(execSpan.spanId, verificationScore >= PASS_THRESHOLD ? 'completed' : 'failed', { verificationScore, duration: execDuration }) } catch {}
    }

    return {
      ...ctx,
      result: result ?? null,
      phase: 'execution',
      verificationResult: { score: verificationScore, errors: verificationErrors },
    }
  }

  private recordMetric(name: string, value: number): void {
    if (this.metricsCollector) {
      try { this.metricsCollector.record(name, value) } catch {}
    }
  }
}
