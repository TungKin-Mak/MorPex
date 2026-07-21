/**
 * ApprovalEngine — 审批引擎
 *
 * Phase 4 / MorPex v8: 标准化人工审批流程管理。
 *
 * 职责：
 *   1. 创建审批请求（高风险操作需要人工确认）
 *   2. 发射 APPROVAL_REQUIRED 事件让前端展示
 *   3. 支持 approve / deny / 超时自动拒绝
 *   4. 低风险操作可配置自动批准
 *
 * 与 MissionRuntime 的集成：
 *   MissionRuntime 在 WAIT_APPROVAL 状态下调用 ApprovalEngine：
 *     const request = await approvalEngine.requestApproval(missionId, action, desc, risk);
 *     if (request.status === 'auto_approved') → continue
 *     else → wait for user input
 *
 * 使用方式：
 *   const approvalEngine = new ApprovalEngine(eventBus);
 *   const request = await approvalEngine.requestApproval('mis_123', 'execute_plan', '执行投资分析计划', 'high');
 *   // Wait for user: approve('apr_456', 'user_789', 'Looks good')
 *   // Or:          deny('apr_456', 'user_789', 'Need more details')
 */

import { EventBus } from '../../common/EventBus.js';
import { EventType } from '../../protocol/events/EventType.js';
import type { ApprovalRequest, ApprovalEngineConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════
// ApprovalEngine
// ═══════════════════════════════════════════════════════════════

export class ApprovalEngine {
  /** EventBus 引用 */
  private bus: EventBus;

  /** 所有审批请求（requestId → ApprovalRequest） */
  private requests: Map<string, ApprovalRequest> = new Map();

  /** 配置 */
  private config: Required<ApprovalEngineConfig>;

  /** ID 计数器 */
  private idCounter = 0;

  /** 超时定时器映射（requestId → setTimeout handle） */
  private timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * @param bus - EventBus 实例
   * @param config - 审批引擎配置
   */
  constructor(
    bus: EventBus,
    config?: ApprovalEngineConfig
  ) {
    this.bus = bus;
    this.config = {
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 5 * 60 * 1000, // 5 分钟
      autoApproveLowRisk: config?.autoApproveLowRisk ?? true,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 核心方法
  // ═══════════════════════════════════════════════════════════

  /**
   * requestApproval — 创建审批请求
   *
   * 根据风险等级决定行为：
   *   - low:   如果 autoApproveLowRisk=true，自动批准
   *   - medium: 创建 pending 请求，等待用户处理
   *   - high:   创建 pending 请求，等待用户处理
   *
   * @param missionId - 所属 Mission ID
   * @param action - 操作描述
   * @param description - 人类可读的详细描述
   * @param risk - 风险等级
   * @param context - 额外上下文信息
   * @returns ApprovalRequest（如果自动批准，status='approved'）
   */
  async requestApproval(
    missionId: string,
    action: string,
    description: string,
    risk: 'low' | 'medium' | 'high',
    context?: Record<string, unknown>
  ): Promise<ApprovalRequest> {
    const id = this.generateId();
    const now = Date.now();

    // 低风险自动批准
    if (risk === 'low' && this.config.autoApproveLowRisk) {
      const request: ApprovalRequest = {
        id,
        missionId,
        action,
        description,
        risk,
        context: context ?? {},
        status: 'approved',
        requestedAt: now,
        resolvedAt: now,
        resolvedBy: 'system',
        reason: 'Auto-approved: low risk action',
        timeoutMs: 0,
      };

      this.requests.set(id, request);

      // 仍然发射 APPROVAL_GRANTED 事件（用于审计和前端追踪）
      this.bus.emit({
        id: `evt_${id}`,
        type: EventType.APPROVAL_GRANTED,
        timestamp: now,
        executionId: missionId,
        source: 'approval-engine',
        payload: {
          requestId: id,
          missionId,
          action,
          risk,
          autoApproved: true,
          status: 'approved',
        },
      });

      console.log(`[ApprovalEngine] ✅ Auto-approved: ${action} (low risk)`);
      return request;
    }

    // 中/高风险 — 创建 pending 请求
    const timeoutMs = this.config.defaultTimeoutMs;
    const request: ApprovalRequest = {
      id,
      missionId,
      action,
      description,
      risk,
      context: context ?? {},
      status: 'pending',
      requestedAt: now,
      timeoutMs,
    };

    this.requests.set(id, request);

    // 发射 APPROVAL_REQUIRED 事件
    this.bus.emit({
      id: `evt_${id}`,
      type: EventType.APPROVAL_REQUIRED,
      timestamp: now,
      executionId: missionId,
      source: 'approval-engine',
      payload: {
        requestId: id,
        missionId,
        action,
        description,
        risk,
        context: request.context,
      },
    });

    console.log(`[ApprovalEngine] ⏳ Approval required: ${action} (${risk} risk, timeout=${timeoutMs}ms)`);

    // 设置超时自动拒绝
    if (timeoutMs > 0) {
      const timer = setTimeout(() => {
        this.expire(id).catch(err => {
          console.error(`[ApprovalEngine] Failed to expire request ${id}:`, (err as Error).message);
        });
      }, timeoutMs);
      this.timeoutTimers.set(id, timer);
    }

    return request;
  }

  /**
   * approve — 批准审批请求
   *
   * @param requestId - 审批请求 ID
   * @param by - 审批人（用户 ID）
   * @param reason - 审批原因
   * @returns 更新后的 ApprovalRequest
   * @throws 如果请求不存在或已处理
   */
  async approve(
    requestId: string,
    by?: string,
    reason?: string
  ): Promise<ApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`[ApprovalEngine] Request not found: ${requestId}`);
    }
    if (request.status !== 'pending') {
      throw new Error(
        `[ApprovalEngine] Cannot approve: request ${requestId} is already ${request.status}`
      );
    }

    // 清除超时定时器
    this.clearTimeout(requestId);

    const now = Date.now();
    request.status = 'approved';
    request.resolvedAt = now;
    request.resolvedBy = by ?? 'unknown';
    request.reason = reason ?? 'Approved';

    // 发射 APPROVAL_GRANTED 事件
    this.bus.emit({
      id: `evt_${requestId}`,
      type: EventType.APPROVAL_GRANTED,
      timestamp: now,
      executionId: request.missionId,
      source: 'approval-engine',
      payload: {
        requestId,
        missionId: request.missionId,
        action: request.action,
        risk: request.risk,
        approvedBy: by ?? 'unknown',
        reason: reason ?? '',
        status: 'approved',
      },
    });

    console.log(`[ApprovalEngine] ✅ Approved: ${request.action} (by ${by ?? 'unknown'})`);
    return request;
  }

  /**
   * deny — 拒绝审批请求
   *
   * @param requestId - 审批请求 ID
   * @param by - 拒绝人（用户 ID）
   * @param reason - 拒绝原因
   * @returns 更新后的 ApprovalRequest
   * @throws 如果请求不存在或已处理
   */
  async deny(
    requestId: string,
    by?: string,
    reason?: string
  ): Promise<ApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`[ApprovalEngine] Request not found: ${requestId}`);
    }
    if (request.status !== 'pending') {
      throw new Error(
        `[ApprovalEngine] Cannot deny: request ${requestId} is already ${request.status}`
      );
    }

    // 清除超时定时器
    this.clearTimeout(requestId);

    const now = Date.now();
    request.status = 'denied';
    request.resolvedAt = now;
    request.resolvedBy = by ?? 'unknown';
    request.reason = reason ?? 'Denied';

    // 发射 APPROVAL_DENIED 事件
    this.bus.emit({
      id: `evt_${requestId}`,
      type: EventType.APPROVAL_DENIED,
      timestamp: now,
      executionId: request.missionId,
      source: 'approval-engine',
      payload: {
        requestId,
        missionId: request.missionId,
        action: request.action,
        risk: request.risk,
        deniedBy: by ?? 'unknown',
        reason: reason ?? '',
        status: 'denied',
      },
    });

    console.log(`[ApprovalEngine] ❌ Denied: ${request.action} (by ${by ?? 'unknown'}: ${reason ?? 'No reason'})`);
    return request;
  }

  // ═══════════════════════════════════════════════════════════
  // 查询方法
  // ═══════════════════════════════════════════════════════════

  /**
   * getPendingForMission — 获取指定 Mission 的待处理审批请求
   *
   * @param missionId - Mission ID
   * @returns 待处理的审批请求列表
   */
  getPendingForMission(missionId: string): ApprovalRequest[] {
    return [...this.requests.values()].filter(
      r => r.missionId === missionId && r.status === 'pending'
    );
  }

  /**
   * getPending — 获取所有待处理的审批请求
   *
   * @returns 所有待处理的审批请求
   */
  getPending(): ApprovalRequest[] {
    return [...this.requests.values()].filter(r => r.status === 'pending');
  }

  /**
   * hasPending — 检查指定 Mission 是否有待处理的审批请求
   *
   * @param missionId - Mission ID
   * @returns 是否有待处理的审批请求
   */
  hasPending(missionId: string): boolean {
    return this.getPendingForMission(missionId).length > 0;
  }

  /**
   * getRequest — 获取单个审批请求
   *
   * @param requestId - 审批请求 ID
   * @returns ApprovalRequest 或 undefined
   */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * getAllRequests — 获取所有审批请求
   *
   * @returns 所有审批请求列表
   */
  getAllRequests(): ApprovalRequest[] {
    return [...this.requests.values()];
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * expire — 超时自动拒绝
   *
   * @param requestId - 审批请求 ID
   */
  private async expire(requestId: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') return;

    const now = Date.now();
    request.status = 'expired';
    request.resolvedAt = now;
    request.reason = 'Auto-denied: approval timeout';

    // 发射 APPROVAL_DENIED 事件（expired 作为 denied 的一种）
    this.bus.emit({
      id: `evt_${requestId}_expired`,
      type: EventType.APPROVAL_DENIED,
      timestamp: now,
      executionId: request.missionId,
      source: 'approval-engine',
      payload: {
        requestId,
        missionId: request.missionId,
        action: request.action,
        risk: request.risk,
        deniedBy: 'system',
        reason: 'Auto-denied: approval timeout',
        status: 'expired',
      },
    });

    console.log(`[ApprovalEngine] ⏰ Expired: ${request.action} (timeout ${request.timeoutMs}ms)`);
  }

  /**
   * clearTimeout — 清除超时定时器
   *
   * @param requestId - 审批请求 ID
   */
  private clearTimeout(requestId: string): void {
    const timer = this.timeoutTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(requestId);
    }
  }

  /**
   * generateId — 生成审批请求 ID
   */
  private generateId(): string {
    return `apr_${Date.now()}_${++this.idCounter}_${Math.random().toString(36).slice(2, 6)}`;
  }
}
