/**
 * ErrorHandlerService — 统一错误处理与恢复服务
 *
 * v9.2 Phase 1: 编排 RetryPolicy + CircuitBreaker + 补偿回调。
 * 所有 Stage / Manager 的关键操作包裹此服务。
 *
 * 流程:
 *   1. CircuitBreaker 快速拒绝 (OPEN 状态)
 *   2. RetryPolicy 控制重试次数 + 退避延迟
 *   3. 所有失败 → 补偿回调 (Saga 模式)
 *   4. 事件广播到 EventBus
 */

import { RetryPolicy } from './RetryPolicy.js';
import { CircuitBreaker, CircuitOpenError } from './CircuitBreaker.js';

export interface ExecutionContext {
  /** 阶段名称 (如 'intent', 'execution') */
  stage: string;
  /** 关联 Mission ID */
  missionId: string;
  /** 操作名称 (用于日志/追踪) */
  operation: string;
  /** 所有重试耗尽后的补偿操作 (Saga) */
  compensator?: (error: Error) => Promise<void>;
}

export interface ErrorRecord {
  missionId: string;
  stage: string;
  operation: string;
  error: string;
  attempt: number;
  maxAttempts: number;
  circuitState?: string;
  recovered: boolean;
  timestamp: number;
}

/**
 * 默认重试策略映射: stage → RetryPolicy
 * CircuitBreaker 默认使用 RetryPolicy.standard() 的 maxAttempts 作为阈值
 */
const DEFAULT_POLICIES: Record<string, RetryPolicy> = {
  context_assembly: RetryPolicy.standard(),
  intent: RetryPolicy.standard(),
  goal: RetryPolicy.standard(),
  twin: RetryPolicy.standard(),
  planning: RetryPolicy.standard(),
  execution: RetryPolicy.robust(),
  learning: RetryPolicy.standard(),
  evolution: RetryPolicy.standard(),
  persistence: RetryPolicy.fast(),
};

export class ErrorHandlerService {
  private policies: Map<string, RetryPolicy>;
  private breakers: Map<string, CircuitBreaker>;
  private errorLog: ErrorRecord[] = [];
  private eventBus: any;

  constructor(eventBus?: any) {
    this.eventBus = eventBus;
    this.policies = new Map(Object.entries(DEFAULT_POLICIES));
    this.breakers = new Map();
  }

  /**
   * registerPolicy — 注册阶段的重试策略
   */
  registerPolicy(stage: string, policy: RetryPolicy): void {
    this.policies.set(stage, policy);
  }

  /**
   * registerBreaker — 注册阶段的熔断器
   */
  registerBreaker(stage: string, breaker: CircuitBreaker): void {
    this.breakers.set(stage, breaker);
  }

  /**
   * executeWithRecovery — 带恢复的执行
   *
   * 完整流程:
   *   1. 获取阶段的 CircuitBreaker (或创建默认)
   *   2. CircuitBreaker 包裹 -> OPEN 时立即拒绝
   *   3. 循环重试 (RetryPolicy)
   *   4. 每次失败: 广播事件 + 记录日志
   *   5. 最终失败: 调用补偿 (若提供)
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    context: ExecutionContext
  ): Promise<T> {
    const breaker = this.getOrCreateBreaker(context.stage);
    const policy = this.getPolicy(context.stage);

    return breaker.execute<T>(async () => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
        try {
          const result = await operation();
          // 记录恢复 (如果有重试)
          if (attempt > 0) {
            this.errorLog.push({
              missionId: context.missionId,
              stage: context.stage,
              operation: context.operation,
              error: lastError?.message || '',
              attempt,
              maxAttempts: policy.maxAttempts,
              circuitState: breaker.getState(),
              recovered: true,
              timestamp: Date.now(),
            });
          }
          return result;
        } catch (err: any) {
          lastError = err;

          // 广播事件
          this.emitError(err, context, attempt, policy.maxAttempts, breaker.getState());

          // 记录
          this.errorLog.push({
            missionId: context.missionId,
            stage: context.stage,
            operation: context.operation,
            error: err.message,
            attempt: attempt + 1,
            maxAttempts: policy.maxAttempts,
            circuitState: breaker.getState(),
            recovered: false,
            timestamp: Date.now(),
          });

          // 判断是否可重试
          if (!policy.shouldRetry(err)) {
            throw err;
          }

          // 最后一次尝试失败 → 补偿
          if (attempt === policy.maxAttempts - 1) {
            if (context.compensator) {
              try {
                await context.compensator(err);
              } catch (compErr: any) {
                // 补偿失败记录但不阻止抛出原始错误
                this.errorLog.push({
                  missionId: context.missionId,
                  stage: context.stage,
                  operation: `${context.operation}:compensator`,
                  error: compErr.message,
                  attempt: attempt + 1,
                  maxAttempts: policy.maxAttempts,
                  circuitState: breaker.getState(),
                  recovered: false,
                  timestamp: Date.now(),
                });
              }
            }
            throw err;
          }

          // 退避等待
          const delay = policy.getDelay(attempt);
          await this.delay(delay);
        }
      }

      // 不应到达这里
      throw lastError || new Error('Unknown error in executeWithRecovery');
    });
  }

  /**
   * getErrorLog — 获取错误日志
   */
  getErrorLog(missionId?: string): ErrorRecord[] {
    if (missionId) {
      return this.errorLog.filter(e => e.missionId === missionId);
    }
    return [...this.errorLog];
  }

  /**
   * getBreakerStates — 获取所有熔断器状态
   */
  getBreakerStates(): Record<string, string> {
    const states: Record<string, string> = {};
    for (const [name, breaker] of this.breakers) {
      states[name] = breaker.getState();
    }
    return states;
  }

  /**
   * resetBreaker — 重置指定熔断器
   */
  resetBreaker(stage: string): void {
    this.breakers.get(stage)?.reset();
  }

  /**
   * resetAllBreakers — 重置所有熔断器
   */
  resetAllBreakers(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  // ── 内部 ──

  private getPolicy(stage: string): RetryPolicy {
    return this.policies.get(stage) ?? RetryPolicy.standard();
  }

  private getOrCreateBreaker(stage: string): CircuitBreaker {
    let breaker = this.breakers.get(stage);
    if (!breaker) {
      const policy = this.getPolicy(stage);
      breaker = new CircuitBreaker(stage, {
        failureThreshold: Math.max(3, policy.maxAttempts + 2),
        openTimeoutMs: 30000,
        successThreshold: 2,
        halfOpenMaxRequests: 1,
      });
      this.breakers.set(stage, breaker);
    }
    return breaker;
  }

  private emitError(error: Error, context: ExecutionContext, attempt: number, maxAttempts: number, circuitState: string): void {
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      try {
        this.eventBus.emit({
          id: `err_${Date.now()}`,
          type: 'ERROR_OCCURRED',
          timestamp: Date.now(),
          executionId: context.missionId,
          source: `error-handler:${context.stage}`,
          payload: {
            missionId: context.missionId,
            stage: context.stage,
            operation: context.operation,
            error: error.message,
            attempt: attempt + 1,
            maxAttempts,
            circuitState,
          },
        });
      } catch {
        // 事件总线错误不干扰主流程
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
