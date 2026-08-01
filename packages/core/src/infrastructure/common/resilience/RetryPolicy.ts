/**
 * RetryPolicy — 可配置重试策略
 *
 * v9.2 Phase 1: 统一重试框架，支持多种退避策略和错误过滤。
 *
 * 使用方式:
 *   const policy = RetryPolicy.standard();
 *   for (let i = 0; i <= policy.maxAttempts; i++) {
 *     try { return await op(); } catch (e) {
 *       if (!policy.shouldRetry(e)) throw e;
 *       await delay(policy.getDelay(i));
 *     }
 *   }
 */

export type BackoffStrategy = 'fixed' | 'linear' | 'exponential' | 'jitter';

export interface RetryPolicyConfig {
  /** 最大尝试次数 (含首次, default 3) */
  maxAttempts: number;
  /** 基础延迟 ms (default 1000) */
  baseDelayMs: number;
  /** 最大延迟 ms (default 30000) */
  maxDelayMs: number;
  /** 退避策略 (default 'exponential') */
  strategy: BackoffStrategy;
  /** 只有这些错误子串匹配时才重试 (空 = 全部可重试) */
  retryableErrors?: string[];
  /** 这些错误子串匹配时永不重试 */
  nonRetryableErrors?: string[];
}

const DEFAULT_CONFIG: RetryPolicyConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  strategy: 'exponential',
};

export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly strategy: BackoffStrategy;
  private retryableErrors: string[];
  private nonRetryableErrors: string[];

  constructor(config?: Partial<RetryPolicyConfig>) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.maxAttempts = merged.maxAttempts;
    this.baseDelayMs = merged.baseDelayMs;
    this.maxDelayMs = merged.maxDelayMs;
    this.strategy = merged.strategy;
    this.retryableErrors = merged.retryableErrors ?? [];
    this.nonRetryableErrors = merged.nonRetryableErrors ?? [];
  }

  /**
   * getDelay — 计算第 attempt 次的重试延迟
   * @param attempt 0-indexed 重试次数
   */
  getDelay(attempt: number): number {
    let delay: number;

    switch (this.strategy) {
      case 'fixed':
        delay = this.baseDelayMs;
        break;
      case 'linear':
        delay = this.baseDelayMs * (attempt + 1);
        break;
      case 'exponential':
        delay = this.baseDelayMs * Math.pow(2, attempt);
        break;
      case 'jitter': {
        const exp = this.baseDelayMs * Math.pow(2, attempt);
        delay = exp + Math.random() * this.baseDelayMs;
        break;
      }
      default:
        delay = this.baseDelayMs;
    }

    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * shouldRetry — 检查该错误是否应触发重试
   *
   * 优先检查 nonRetryableErrors 黑名单，再检查 retryableErrors 白名单。
   * 白名单为空时默认全部可重试。
   */
  shouldRetry(error: Error): boolean {
    const msg = error.message;

    // 黑名单: 匹配则永不重试
    for (const pattern of this.nonRetryableErrors) {
      if (msg.includes(pattern)) return false;
    }

    // 白名单: 非空时只有匹配才重试
    if (this.retryableErrors.length > 0) {
      for (const pattern of this.retryableErrors) {
        if (msg.includes(pattern)) return true;
      }
      return false;
    }

    return true;
  }

  // ── 预设 ──

  /** 快速重试: 5 次, 200ms base, linear */
  static fast(): RetryPolicy {
    return new RetryPolicy({ maxAttempts: 5, baseDelayMs: 200, strategy: 'linear', maxDelayMs: 5000 });
  }

  /** 标准重试: 3 次, 1s base, exponential */
  static standard(): RetryPolicy {
    return new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1000, strategy: 'exponential', maxDelayMs: 30000 });
  }

  /** 强健重试: 5 次, 2s base, jitter, 60s max */
  static robust(): RetryPolicy {
    return new RetryPolicy({ maxAttempts: 5, baseDelayMs: 2000, strategy: 'jitter', maxDelayMs: 60000 });
  }

  /** 不重试: 1 次 */
  static noRetry(): RetryPolicy {
    return new RetryPolicy({ maxAttempts: 1 });
  }
}
