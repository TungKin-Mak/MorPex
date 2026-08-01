/**
 * AsyncResourceLocker — per-resource async mutex
 *
 * Same key = serialized writes. Read operations bypass (no lock).
 * Uses Promise chaining (FIFO queue) — no external dependencies.
 *
 * Usage:
 *   const locker = new AsyncResourceLocker();
 *   await locker.withLock('artifact-123', async () => {
 *     // exclusive write access
 *   });
 */

export class AsyncResourceLocker {
  private _queues = new Map<string, Promise<void>>();

  /**
   * Acquire a write lock for the given resource key.
   * Returns an unlock function. Must be called exactly once after the critical section.
   *
   * If another write holds the same key, this call waits until it releases.
   */
  async acquire(key: string): Promise<() => void> {
    // Wait for the previous holder of this key to finish
    while (this._queues.has(key)) {
      await this._queues.get(key)!;
    }

    // Place our own lock promise in the queue
    let resolveUnlock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      resolveUnlock = resolve;
    });
    this._queues.set(key, lockPromise);

    // Return unlock: delete key and resolve the promise so the next waiter proceeds
    return () => {
      // Only delete if we're still the current lock holder
      if (this._queues.get(key) === lockPromise) {
        this._queues.delete(key);
      }
      resolveUnlock();
    };
  }

  /**
   * Execute a function under a write lock for the given resource key.
   * Auto-unlocks even if the function throws.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const unlock = await this.acquire(key);
    try {
      return await fn();
    } finally {
      unlock();
    }
  }

  /** Number of keys currently in the write queue */
  get queueDepth(): number {
    return this._queues.size;
  }

  /** Check if a specific key is currently locked */
  isLocked(key: string): boolean {
    return this._queues.has(key);
  }

  /** Clear all locks (use with extreme caution — only for orderly shutdown) */
  clear(): void {
    this._queues.clear();
  }
}

/** Error thrown when an optimistic-lock version check fails */
export class VersionConflictError extends Error {
  public artifactId: string;
  public expectedVersion: number;
  public currentVersion: number;

  constructor(artifactId: string, expectedVersion: number, currentVersion: number) {
    super(
      `[VersionConflict] ${artifactId}: expected version ${expectedVersion}, ` +
      `current version ${currentVersion}. The artifact was modified by another concurrent operation.`
    );
    this.name = 'VersionConflictError';
    this.artifactId = artifactId;
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}
