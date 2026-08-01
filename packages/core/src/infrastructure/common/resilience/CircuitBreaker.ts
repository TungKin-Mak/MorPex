/**
 * CircuitBreaker — 熔断器
 *
 * v9.2 Phase 1: 防止级联故障，快速失败。
 *
 * 状态机:
 *   CLOSED (正常) → 连续 failureCount >= failureThreshold → OPEN
 *   OPEN (熔断) → 等待 openTimeoutMs → HALF_OPEN
 *   HALF_OPEN (半开) → 首次成功 → CLOSED
 *   HALF_OPEN (半开) → 失败 → OPEN (立即)
 *
 * 使用方式:
 *   const cb = new CircuitBreaker('execution-stage');
 *   await cb.execute(() => riskyOperation());
 *   // 如果熔断器 OPEN, 立即抛出 CircuitOpenError
 */

export class CircuitOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN`);
    this.name = 'CircuitOpenError';
  }
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** 连续失败次数阈值后熔断 (default 5) */
  failureThreshold: number;
  /** HALF_OPEN 状态下成功次数阈值后恢复 CLOSED (default 3) */
  successThreshold: number;
  /** 熔断后等待多久进入半开 (default 30000 ms) */
  openTimeoutMs: number;
  /** HALF_OPEN 状态下允许的最大并发请求数 (default 1) */
  halfOpenMaxRequests: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  openTimeoutMs: 30000,
  halfOpenMaxRequests: 1,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenPending = 0;

  private config: CircuitBreakerConfig;

  private eventBus?: { emit: (type: string, payload: any) => void }

  constructor(
    public readonly name: string,
    config?: Partial<CircuitBreakerConfig>,
    eventBus?: { emit: (type: string, payload: any) => void }
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = eventBus;
  }

  /**
   * execute — 在熔断器保护下执行异步操作
   *
   * - OPEN: 立即抛出 CircuitOpenError
   * - HALF_OPEN: 限制并发数，成功则恢复 CLOSED，失败则回到 OPEN
   * - CLOSED: 正常执行，失败记录计数
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.evaluateState();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name);
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenPending >= this.config.halfOpenMaxRequests) {
        throw new CircuitOpenError(this.name);
      }
      this.halfOpenPending++;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err: any) {
      this.recordFailure();
      throw err;
    }
  }

  /** 记录成功 */
  recordSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      this.halfOpenPending = Math.max(0, this.halfOpenPending - 1);
      if (this.successCount >= this.config.successThreshold) {
        const prevState = this.state;
        this.state = 'CLOSED';
        this.successCount = 0;
        this.eventBus?.emit('circuit.closed', { name: this.name, successCount: this.successCount, timestamp: Date.now() });
      }
    } else {
      this.state = 'CLOSED';
      this.successCount = 0;
    }
  }

  /** 记录失败 */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.state === 'HALF_OPEN') {
      const prevState = this.state;
      this.state = 'OPEN';
      this.halfOpenPending = Math.max(0, this.halfOpenPending - 1);
      this.eventBus?.emit('circuit.open', { name: this.name, failureCount: this.failureCount, timestamp: Date.now() });
      return;
    }

    this.failureCount++;
    if (this.failureCount >= this.config.failureThreshold) {
      const prevState = this.state;
      this.state = 'OPEN';
      this.eventBus?.emit('circuit.open', { name: this.name, failureCount: this.failureCount, timestamp: Date.now() });
    }
  }

  /** 获取当前状态 */
  getState(): CircuitState {
    this.evaluateState();
    return this.state;
  }

  /** 获取统计信息 */
  getStats(): { state: CircuitState; failureCount: number; successCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /** 强制重置为 CLOSED */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenPending = 0;
  }

  /**
   * evaluateState — 检查是否需要从 OPEN → HALF_OPEN
   */
  private evaluateState(): void {
    if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.config.openTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.successCount = 0;
      this.eventBus?.emit('circuit.half_open', { name: this.name, timestamp: Date.now() });
    }
  }
}
