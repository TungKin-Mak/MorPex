/**
 * WorkflowRegistry — 工作流注册表
 *
 * Phase 5 / MorPex v8.5: 正式工作流生命周期管理。
 *
 * 生命周期:
 *   candidate → confirmed → active → deprecated
 *                    ↓
 *                 paused → active
 *
 * 职责:
 *   1. 注册候选工作流
 *   2. 管理状态转换 (confirm / activate / deprecate / pause)
 *   3. 版本管理 (addVersion)
 *   4. 执行追踪 (recordExecution)
 *   5. 查询 (按状态 / 可自动执行)
 */

import type {
  RegisteredWorkflow,
  WorkflowCandidate,
  WorkflowStatus,
  WorkflowVersion,
  VersionPerformance,
} from './types.js'
import type { WorkflowContract } from './contract/WorkflowContract.js'
import { ContractValidator } from './contract/WorkflowContract.js'

export class WorkflowRegistry {
  /** 工作流存储: id → RegisteredWorkflow */
  private workflows: Map<string, RegisteredWorkflow> = new Map();

  /** ID 计数器 */
  private idCounter = 0;

  // ═══════════════════════════════════════════════════════════
  // 生命周期管理
  // ═══════════════════════════════════════════════════════════

  /**
   * register — 从候选注册新工作流
   *
   * ★ v8.8: 支持 WorkflowContract 契约验证。
   * 如果提供 contract，注册前会自动验证契约。
   * 契约验证不通过时注册失败。
   *
   * 状态: candidate → confirmed
   *
   * @param candidate - 候选工作流
   * @param contract - 可选的工作流契约（v8.8）
   * @returns 注册后的 RegisteredWorkflow
   */
  register(candidate: WorkflowCandidate, contract?: WorkflowContract): RegisteredWorkflow {
    const id = `wf_${Date.now()}_${++this.idCounter}`;
    const now = Date.now();

    const version1: WorkflowVersion = {
      version: 1,
      steps: candidate.steps,
      createdAt: now,
      createdBy: 'system',
      changeDescription: 'Initial version from pattern detection',
    };

    // ★ v8.8: 契约验证
    if (contract) {
      const validator = new ContractValidator()
      const validation = validator.validate(contract, {
        input: {},
        output: {},
        context: {},
      })
      if (!validation.valid) {
        throw new Error(
          `Contract validation failed for "${candidate.name}": ${validation.errors.join('; ')}`
        )
      }
    }

    const workflow: RegisteredWorkflow = {
      id,
      name: candidate.name,
      description: candidate.description,
      status: 'confirmed',
      currentVersion: 1,
      versions: [version1],
      sourceMissions: candidate.sourceMissionIds,
      executionCount: 0,
      successRate: 0,
      avgDuration: 0,
      lastExecutedAt: undefined,
      lastOptimizedAt: undefined,
      createdAt: now,
      updatedAt: now,
      metadata: {
        confidence: candidate.confidence,
        suggestedFrequency: candidate.suggestedFrequency,
        ...(contract ? {
          hasContract: true,
          contractWorkflowId: contract.workflowId,
          contractVersion: contract.version,
        } : {}),
      },
    }

    this.workflows.set(id, workflow)
    return workflow
  }

  /**
   * confirm — 确认候选工作流 (从 candidate 或 外部来源)
   *
   * @param workflowId - 工作流 ID
   * @returns 更新后的 RegisteredWorkflow
   */
  confirm(workflowId: string): RegisteredWorkflow | undefined {
    const wf = this.workflows.get(workflowId);
    if (!wf) return undefined;
    if (wf.status !== 'confirmed') {
      wf.status = 'confirmed';
      wf.updatedAt = Date.now();
    }
    return wf;
  }

  /**
   * activate — 激活工作流 (允许自动执行)
   *
   * @param workflowId - 工作流 ID
   * @returns 更新后的 RegisteredWorkflow
   */
  activate(workflowId: string): RegisteredWorkflow | undefined {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.status !== 'confirmed') return undefined;
    wf.status = 'active';
    wf.updatedAt = Date.now();
    return wf;
  }

  /**
   * pause — 暂停工作流 (暂时停止自动执行)
   */
  pause(workflowId: string): RegisteredWorkflow | undefined {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.status !== 'active') return undefined;
    wf.status = 'paused';
    wf.updatedAt = Date.now();
    return wf;
  }

  /**
   * resume — 恢复工作流
   */
  resume(workflowId: string): RegisteredWorkflow | undefined {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.status !== 'paused') return undefined;
    wf.status = 'active';
    wf.updatedAt = Date.now();
    return wf;
  }

  /**
   * deprecate — 废弃工作流
   *
   * @param workflowId - 工作流 ID
   * @param reason - 废弃原因
   */
  deprecate(workflowId: string, reason: string): void {
    const wf = this.workflows.get(workflowId);
    if (!wf) return;
    wf.status = 'deprecated';
    wf.updatedAt = Date.now();
    wf.metadata.deprecatedReason = reason;
  }

  // ═══════════════════════════════════════════════════════════
  // 版本管理
  // ═══════════════════════════════════════════════════════════

  /**
   * addVersion — 为工作流添加新版本
   *
   * @param workflowId - 工作流 ID
   * @param version - 新版本 (version.number 应递增)
   * @returns 更新后的 RegisteredWorkflow
   */
  addVersion(
    workflowId: string,
    version: Omit<WorkflowVersion, 'version'>
  ): RegisteredWorkflow | undefined {
    const wf = this.workflows.get(workflowId);
    if (!wf) return undefined;

    const newVersion: WorkflowVersion = {
      ...version,
      version: wf.currentVersion + 1,
    };

    wf.versions.push(newVersion);
    wf.currentVersion = newVersion.version;
    wf.updatedAt = Date.now();

    return wf;
  }

  // ═══════════════════════════════════════════════════════════
  // 执行追踪
  // ═══════════════════════════════════════════════════════════

  /**
   * recordExecution — 记录执行结果并更新性能指标
   *
   * @param workflowId - 工作流 ID
   * @param success - 是否成功
   * @param duration - 执行时长 (ms)
   */
  recordExecution(workflowId: string, success: boolean, duration: number): void {
    const wf = this.workflows.get(workflowId);
    if (!wf) return;

    wf.executionCount++;
    wf.lastExecutedAt = Date.now();

    // 滑动窗口: 计算新成功率 (最近 20 次)
    const windowSize = 20;
    const prevSuccessCount = Math.round(wf.successRate * (wf.executionCount - 1));
    const newSuccessCount = prevSuccessCount + (success ? 1 : 0);
    const effectiveCount = Math.min(wf.executionCount, windowSize);
    wf.successRate = newSuccessCount / effectiveCount;

    // 更新平均时长 (指数移动平均)
    const alpha = 0.3;
    wf.avgDuration = wf.avgDuration === 0
      ? duration
      : alpha * duration + (1 - alpha) * wf.avgDuration;

    // 更新当前版本的性能
    const currentVer = wf.versions[wf.versions.length - 1];
    if (currentVer) {
      const perf = currentVer.performance || {
        avgDuration: 0, successRate: 0, executionCount: 0,
      };
      perf.executionCount++;
      perf.lastExecutedAt = wf.lastExecutedAt;
      perf.avgDuration = perf.avgDuration === 0
        ? duration
        : alpha * duration + (1 - alpha) * perf.avgDuration;
      const prevPerfSuccess = Math.round(perf.successRate * (perf.executionCount - 1));
      perf.successRate = (prevPerfSuccess + (success ? 1 : 0)) / Math.min(perf.executionCount, windowSize);
      currentVer.performance = perf;
    }

    wf.updatedAt = Date.now();
  }

  // ═══════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════

  /**
   * get — 获取指定工作流
   */
  get(workflowId: string): RegisteredWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * getByStatus — 按状态获取工作流
   */
  getByStatus(status: WorkflowStatus): RegisteredWorkflow[] {
    return [...this.workflows.values()].filter(w => w.status === status);
  }

  /**
   * getAutoExecutable — 获取可自动执行的工作流
   *
   * 条件: status === 'active' && successRate >= 0.8 && executionCount >= 3
   */
  getAutoExecutable(): RegisteredWorkflow[] {
    return [...this.workflows.values()].filter(
      w => w.status === 'active'
        && w.successRate >= 0.8
        && w.executionCount >= 3
    );
  }

  /**
   * getExecutable — 获取可手动执行的工作流
   *
   * 条件: status === 'active' || status === 'confirmed'
   */
  getExecutable(): RegisteredWorkflow[] {
    return [...this.workflows.values()].filter(
      w => w.status === 'active' || w.status === 'confirmed'
    );
  }

  /**
   * getAll — 获取所有注册工作流
   */
  getAll(): RegisteredWorkflow[] {
    return [...this.workflows.values()];
  }

  /**
   * count — 统计工作流数量
   */
  count(status?: WorkflowStatus): number {
    if (status) {
      return this.getByStatus(status).length;
    }
    return this.workflows.size;
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  toJSON(): RegisteredWorkflow[] {
    return [...this.workflows.values()];
  }

  static fromJSON(data: RegisteredWorkflow[]): WorkflowRegistry {
    const registry = new WorkflowRegistry();
    for (const wf of data) {
      registry.workflows.set(wf.id, wf);
    }
    return registry;
  }
}
