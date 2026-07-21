/**
 * CompensationEngine — 补偿引擎（Saga 模式）
 *
 * MorPex v8.8: 任务失败时按逆序回滚已执行的操作。
 * 基于 Saga 模式：每个步骤注册对应的补偿操作，失败时自动回滚。
 */

export interface CompensationStep {
  taskId: string
  compensateAction: string
  compensateParams: Record<string, unknown>
  order: number
}

export interface SagaDefinition {
  workflowId: string
  steps: {
    taskId: string
    action: string
    compensateAction: string
    compensateParams: Record<string, unknown>
  }[]
}

export interface CompensationResult {
  success: boolean
  compensatedTasks: string[]
  failedCompensations: string[]
  duration: number
}

// ═══════════════════════════════════════════════════════════════
// CompensationEngine
// ═══════════════════════════════════════════════════════════════

export class CompensationEngine {
  /** workflowId → SagaDefinition */
  private sagas: Map<string, SagaDefinition> = new Map()

  /** history: missionId → executed task list */
  private executionHistory: Map<string, { id: string; action: string }[]> = new Map()

  private stats = {
    totalCompensations: 0,
    successfulCompensations: 0,
    failedCompensations: 0,
  }

  /**
   * registerSaga — 注册 Saga 补偿计划
   *
   * @param definition - Saga 定义
   */
  registerSaga(definition: SagaDefinition): void {
    this.sagas.set(definition.workflowId, definition)
  }

  /**
   * recordExecution — 记录已执行的任务（用于回滚）
   *
   * @param missionId - Mission ID
   * @param taskId - 已执行的任务 ID
   * @param action - 执行的操作
   */
  recordExecution(missionId: string, taskId: string, action: string): void {
    const history = this.executionHistory.get(missionId) || []
    history.push({ id: taskId, action })
    this.executionHistory.set(missionId, history)
  }

  /**
   * compensate — 执行补偿回滚
   *
   * 按执行顺序逆序回滚所有已成功的任务。
   *
   * @param missionId - Mission ID
   * @param failedTaskId - 失败的任务 ID
   * @param executedTasks - 已执行的任务列表（可选，默认使用记录的历史）
   * @returns CompensationResult
   */
  async compensate(
    missionId: string,
    failedTaskId: string,
    executedTasks?: { id: string; action: string }[],
  ): Promise<CompensationResult> {
    this.stats.totalCompensations++
    const startTime = Date.now()

    const tasks = executedTasks || this.executionHistory.get(missionId) || []
    const compensated: string[] = []
    const failed: string[] = []

    // 按逆序回滚（最后一个执行的任务先回滚）
    const reverseOrder = [...tasks].reverse()
    const failedIndex = reverseOrder.findIndex(t => t.id === failedTaskId)

    // 只回滚到失败任务之前（包括失败任务本身）
    const toCompensate = failedIndex >= 0
      ? reverseOrder.slice(failedIndex)
      : reverseOrder

    for (const task of toCompensate) {
      try {
        // 查找 Saga 中对应的补偿操作
        const saga = this.findSagaForTask(task.id)
        if (saga) {
          const step = saga.steps.find(s => s.taskId === task.id)
          if (step) {
            await this.executeCompensation(step.compensateAction, step.compensateParams)
          }
        }
        compensated.push(task.id)
      } catch (err: any) {
        failed.push(task.id)
        console.warn(`[Compensation] Failed to compensate ${task.id}: ${err?.message}`)
      }
    }

    const success = failed.length === 0
    if (success) this.stats.successfulCompensations++
    else this.stats.failedCompensations++

    return {
      success,
      compensatedTasks: compensated,
      failedCompensations: failed,
      duration: Date.now() - startTime,
    }
  }

  /**
   * canCompensate — 检查 Mission 是否可以补偿
   *
   * @param missionId - Mission ID
   * @returns 是否可以补偿
   */
  canCompensate(missionId: string): boolean {
    const history = this.executionHistory.get(missionId)
    return !!history && history.length > 0
  }

  /**
   * getSagas — 获取所有注册的 Saga
   */
  getSagas(): SagaDefinition[] {
    return [...this.sagas.values()]
  }

  /**
   * getStats — 获取补偿统计
   */
  getStats(): { totalCompensations: number; successfulCompensations: number; failedCompensations: number } {
    return { ...this.stats }
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  private findSagaForTask(taskId: string): SagaDefinition | undefined {
    for (const saga of this.sagas.values()) {
      if (saga.steps.some(s => s.taskId === taskId)) return saga
    }
    return undefined
  }

  private async executeCompensation(
    action: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    // 模拟补偿执行
    console.log(`[Compensation] Executing: ${action}`, params)
    // 未来对接真实的回滚逻辑
  }
}
