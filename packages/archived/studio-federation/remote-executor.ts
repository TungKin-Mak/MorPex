/**
 * RemoteExecutor — 远程执行器
 *
 * MorPex v10 Phase 5: 生产化远程 Agent 执行。
 *
 * 与 v9.2 RemoteAgentProxy 的关键区别：
 *   1. 去掉 setTimeout(100) mock — 使用 AgentTransport 真实通信
 *   2. 支持超时控制
 *   3. 支持指数退避重试
 *   4. 返回完整的 RemoteExecutionResponse（含 duration, nodeId, error）
 *   5. 跟踪请求状态（pending → in_flight → completed/failed/timed_out）
 *
 * 流程：
 *   RemoteExecutor.execute(request)
 *     → 验证目标节点在线
 *     → 发送 TransportMessage（task_request）
 *     → 等待响应（带超时）
 *     → 返回结果或错误
 *
 * 事件：
 *   - federation.execution.sent
 *   - federation.execution.completed
 *   - federation.execution.failed
 *   - federation.execution.timeout
 */

import type { EventBus } from '../../../core/src/common/EventBus.js';
import { AgentTransport } from '../../../core/src/agent/distributed/AgentTransport.js';
import type { TransportMessage } from '../../../core/src/agent/distributed/types.js';
import type {
  RemoteExecutionRequest,
  RemoteExecutionResponse,
  RemoteExecutionStatus,
} from './types.js';

// ── 事件常量 ──

const EVT_EXECUTION_SENT = 'federation.execution.sent';
const EVT_EXECUTION_COMPLETED = 'federation.execution.completed';
const EVT_EXECUTION_FAILED = 'federation.execution.failed';
const EVT_EXECUTION_TIMEOUT = 'federation.execution.timeout';

// ── 默认配置 ──

const DEFAULT_TIMEOUT = 30_000; // 30s
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY = 500; // 500ms

// ═══════════════════════════════════════════════════════════════
// RemoteExecutor
// ═══════════════════════════════════════════════════════════════

export class RemoteExecutor {
  private bus: EventBus | null;
  private transport: AgentTransport;
  private localNodeId: string;
  private pendingRequests: Map<string, RemoteExecutionStatus>;
  private startTime: number;

  constructor(
    localNodeId: string,
    transport: AgentTransport,
    bus?: EventBus
  ) {
    this.localNodeId = localNodeId;
    this.transport = transport;
    this.bus = bus ?? null;
    this.pendingRequests = new Map();
    this.startTime = Date.now();

    console.log(`[RemoteExecutor] Initialized (localNode: ${localNodeId})`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — 发送远程执行请求并等待响应
   *
   * 核心方法。不再使用 setTimeout mock，而是通过 AgentTransport
   * 发送真实消息并轮询等待响应。
   *
   * @param request - 远程执行请求
   * @returns RemoteExecutionResponse
   */
  async execute(request: RemoteExecutionRequest): Promise<RemoteExecutionResponse> {
    const startTime = Date.now();
    const requestId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = request.timeout ?? DEFAULT_TIMEOUT;

    // 1. 验证目标节点在线
    const targetNode = this.transport.getNode(request.targetNodeId);
    if (!targetNode) {
      const error = `Target node ${request.targetNodeId} not found`;
      this.emitEvent(EVT_EXECUTION_FAILED, {
        requestId,
        targetNodeId: request.targetNodeId,
        agentId: request.agentId,
        action: request.action,
        error,
      });
      return {
        success: false,
        error,
        duration: Date.now() - startTime,
        nodeId: this.localNodeId,
      };
    }

    if (targetNode.status === 'offline') {
      const error = `Target node ${request.targetNodeId} is offline`;
      this.emitEvent(EVT_EXECUTION_FAILED, {
        requestId,
        targetNodeId: request.targetNodeId,
        agentId: request.agentId,
        action: request.action,
        error,
      });
      return {
        success: false,
        error,
        duration: Date.now() - startTime,
        nodeId: this.localNodeId,
      };
    }

    // 2. 创建状态跟踪
    const status: RemoteExecutionStatus = {
      requestId,
      status: 'pending',
      sentAt: Date.now(),
    };
    this.pendingRequests.set(requestId, status);

    // 3. 发送消息
    const msg: TransportMessage = {
      id: requestId,
      fromNode: this.localNodeId,
      toNode: request.targetNodeId,
      type: 'task_request',
      payload: {
        action: request.action,
        payload: request.payload,
        targetAgent: request.agentId,
      },
      timestamp: Date.now(),
      correlationId: requestId,
    };

    let lastError: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // 指数退避
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
        console.log(`[RemoteExecutor] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms for ${requestId}`);
        await this.sleep(delay);
      }

      status.status = 'in_flight';

      try {
        const sent = await this.transport.sendMessage(msg);
        if (!sent) {
          lastError = `Failed to send message to ${request.targetNodeId} (attempt ${attempt + 1})`;
          continue;
        }

        this.emitEvent(EVT_EXECUTION_SENT, {
          requestId,
          targetNodeId: request.targetNodeId,
          agentId: request.agentId,
          action: request.action,
          attempt: attempt + 1,
        });

        // 4. 等待响应（带超时）
        const response = await this.waitForResponse(requestId, msg, timeout);

        if (response) {
          status.status = 'completed';
          status.completedAt = Date.now();
          status.response = response;
          this.pendingRequests.delete(requestId);

          this.emitEvent(EVT_EXECUTION_COMPLETED, {
            requestId,
            targetNodeId: request.targetNodeId,
            agentId: request.agentId,
            action: request.action,
            duration: response.duration,
            success: response.success,
          });

          return response;
        }

        // 超时
        lastError = `Timeout after ${timeout}ms waiting for ${request.targetNodeId}`;

      } catch (err: any) {
        lastError = err?.message || String(err);
        console.warn(`[RemoteExecutor] Attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    // 所有重试失败
    status.status = 'failed';
    status.completedAt = Date.now();
    this.pendingRequests.delete(requestId);

    this.emitEvent(EVT_EXECUTION_FAILED, {
      requestId,
      targetNodeId: request.targetNodeId,
      agentId: request.agentId,
      action: request.action,
      error: lastError,
      retries: MAX_RETRIES,
    });

    return {
      success: false,
      error: lastError ?? 'Unknown error',
      duration: Date.now() - startTime,
      nodeId: this.localNodeId,
    };
  }

  /**
   * getPendingRequests — 获取所有待处理的请求
   */
  getPendingRequests(): RemoteExecutionStatus[] {
    return [...this.pendingRequests.values()];
  }

  /**
   * getRequestStatus — 获取指定请求的状态
   */
  getRequestStatus(requestId: string): RemoteExecutionStatus | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * cancelRequest — 取消待处理的请求
   */
  cancelRequest(requestId: string): boolean {
    const status = this.pendingRequests.get(requestId);
    if (!status || status.status === 'completed' || status.status === 'failed') {
      return false;
    }
    status.status = 'failed';
    status.completedAt = Date.now();
    this.pendingRequests.delete(requestId);
    return true;
  }

  /**
   * getStats — 获取执行统计
   */
  getStats(): { pendingCount: number; totalSent: number } {
    return {
      pendingCount: this.pendingRequests.size,
      totalSent: 0, // 可用 count 跟踪
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number; elapsed: number; pendingRequests: number } {
    return {
      ok: true,
      name: 'RemoteExecutor',
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
      pendingRequests: this.pendingRequests.size,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * waitForResponse — 等待远程节点的响应
   *
   * 通过轮询 AgentTransport 的消息队列来获取响应，
   * 避免使用 setTimeout mock。
   */
  private async waitForResponse(
    requestId: string,
    sentMsg: TransportMessage,
    timeout: number
  ): Promise<RemoteExecutionResponse | null> {
    const deadline = Date.now() + timeout;

    // 先尝试同步获取（消息可能已经到达）
    const immediateMsgs = this.transport.getMessagesForNode(this.localNodeId);
    for (const msg of immediateMsgs) {
      if (msg.correlationId === requestId && msg.type === 'task_response') {
        return this.parseResponse(msg);
      }
    }

    // 轮询等待响应
    while (Date.now() < deadline) {
      await this.sleep(100); // 100ms 轮询间隔

      const msgs = this.transport.getMessagesForNode(this.localNodeId);
      for (const msg of msgs) {
        if (msg.correlationId === requestId && msg.type === 'task_response') {
          return this.parseResponse(msg);
        }
      }
    }

    // 超时
    this.emitEvent(EVT_EXECUTION_TIMEOUT, {
      requestId,
      targetNodeId: sentMsg.toNode,
      timeout,
    });

    return null;
  }

  /**
   * parseResponse — 解析传输消息为执行响应
   */
  private parseResponse(msg: TransportMessage): RemoteExecutionResponse {
    const payload = msg.payload as any;
    return {
      success: payload?.success ?? true,
      result: payload?.result,
      error: payload?.error,
      duration: payload?.duration ?? 0,
      nodeId: msg.fromNode,
    };
  }

  /**
   * sleep — 异步等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * emitEvent — 发射事件
   */
  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_re_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: String(payload.requestId || 'federation'),
        source: 'remote-executor',
        payload,
      });
    } catch (err: any) {
      console.warn('[RemoteExecutor] Failed to emit event:', err.message);
    }
  }
}
