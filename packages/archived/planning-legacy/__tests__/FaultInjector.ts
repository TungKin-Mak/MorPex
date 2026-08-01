// @ts-nocheck
/**
 * FaultInjector.ts — Red-Team Fault Injection for DynamicReflexEngine
 *
 * DESIGN RULE (断裂点红队注入测试):
 *   After implementing DynamicReflexEngine's hot-patching, inject a
 *   SELF_HEALING_FAILED pseudo-event into MemoryBus 100ms after execution
 *   starts and verify the full reflex loop completes within 50ms:
 *     pause → 7-stage pipeline → hotPatch → resume
 *
 * Usage:
 *   const injector = new FaultInjector(memoryBus, { sessionId, executionId });
 *   injector.injectSelfHealingFailed({ failedNodeId: 'node_2' });
 *   // ... observe trace output ...
 *   const result = await injector.verifyReflexLoop({ expectedPatchDurationMs: 50 });
 *
 * @see DynamicReflexEngine.ts — consumes injected events
 * @see metaplanner-v2.test.ts — integration test using this injector
 */

import type { DeviationEvent, MemoryBusLogEntry, DAGPatch } from '../PlanTypes.js';

/** Minimal MemoryBus interface for fault injection */
interface FaultMemoryBus {
  on(event: string, handler: (event: any) => void): () => void;
  emit(event: any): void;
  appendLog?(entry: MemoryBusLogEntry): Promise<void>;
}

/** Verification result of the reflex loop */
export interface ReflexLoopVerification {
  /** Whether the full loop completed */
  completed: boolean;
  /** Time taken for pause → replan → patch → resume (ms) */
  totalDurationMs: number;
  /** Whether a DAG patch was applied */
  patchApplied: boolean;
  /** The patch that was applied (if any) */
  patch?: DAGPatch;
  /** Whether the deviation was recorded */
  deviationRecorded: boolean;
  /** Detailed trace of observed events */
  eventTrace: Array<{ type: string; timestamp: number; detail: string }>;
  /** Whether the loop completed within 50ms target */
  withinTarget: boolean;
}

/**
 * FaultInjector — Injects synthetic runtime failures to test the reflex loop
 */
export class FaultInjector {
  private memoryBus: FaultMemoryBus;
  private sessionId: string;
  private executionId: string;
  private eventLog: Array<{ type: string; timestamp: number; detail: string }> = [];
  private observedPatches: DAGPatch[] = [];
  private deviationObserved = false;
  private startTime = 0;

  /** Callbacks that external code sets to be measured */
  public onEvent?: (event: any) => void;

  constructor(
    memoryBus: FaultMemoryBus,
    context: { sessionId: string; executionId: string },
  ) {
    this.memoryBus = memoryBus;
    this.sessionId = context.sessionId;
    this.executionId = context.executionId;
  }

  /**
   * injectSelfHealingFailed — Emit SELF_HEALING_FAILED after 100ms delay
   *
   * This simulates a node that failed self-healing retries, triggering
   * the DynamicReflexEngine's full re-planning loop.
   */
  async injectSelfHealingFailed(payload?: {
    failedNodeId?: string;
    failureReason?: string;
    retryCount?: number;
  }): Promise<void> {
    await this.delay(100); // 100ms delay per spec

    const event: DeviationEvent = {
      type: 'SELF_HEALING_FAILED',
      sessionId: this.sessionId,
      executionId: this.executionId,
      timestamp: Date.now(),
      payload: {
        failedNodeId: payload?.failedNodeId ?? 'node_unknown',
        failureReason: payload?.failureReason ?? 'Injected fault: self-healing exhausted',
        retryCount: payload?.retryCount ?? 3,
        healingStatus: 'failed',
        ...payload,
      },
    };

    this.startTime = Date.now();
    this.eventLog.push({
      type: 'inject',
      timestamp: this.startTime,
      detail: `Injected SELF_HEALING_FAILED on ${event.payload.failedNodeId}`,
    });

    console.log(`[FaultInjector] 🧪 注入故障: SELF_HEALING_FAILED → node=${event.payload.failedNodeId}`);
    this.memoryBus.emit(event);
    this.onEvent?.(event);
  }

  /**
   * injectStateDeviation — Emit STATE_DEVIATION (alternative fault injection)
   */
  async injectStateDeviation(payload?: {
    failedNodeId?: string;
    deviationScore?: number;
    reason?: string;
  }): Promise<void> {
    await this.delay(100);

    const event: DeviationEvent = {
      type: 'STATE_DEVIATION',
      sessionId: this.sessionId,
      executionId: this.executionId,
      timestamp: Date.now(),
      payload: {
        failedNodeId: payload?.failedNodeId ?? 'node_unknown',
        deviationScore: payload?.deviationScore ?? 0.75,
        reason: payload?.reason ?? 'Injected fault: state deviation detected',
        ...payload,
      },
    };

    this.startTime = Date.now();
    this.eventLog.push({
      type: 'inject',
      timestamp: this.startTime,
      detail: `Injected STATE_DEVIATION score=${event.payload.deviationScore}`,
    });

    console.log(`[FaultInjector] 🧪 注入故障: STATE_DEVIATION → node=${event.payload.failedNodeId}`);
    this.memoryBus.emit(event);
    this.onEvent?.(event);
  }

  /**
   * subscribeToEvents — Start listening for reflex loop responses
   *
   * Call this BEFORE injecting to capture the full loop trace.
   */
  subscribeToEvents(): void {
    // Listen for patch applications
    const unsubPatch = this.memoryBus.on('patch_applied', (event: any) => {
      this.eventLog.push({
        type: 'patch_applied',
        timestamp: Date.now(),
        detail: `Patch ${event.patchId} applied`,
      });
      if (event.patch) this.observedPatches.push(event.patch);
    });

    // Listen for deviation recordings
    const unsubDev = this.memoryBus.on('deviation_recorded', (event: any) => {
      this.deviationObserved = true;
      this.eventLog.push({
        type: 'deviation_recorded',
        timestamp: Date.now(),
        detail: `Deviation count: ${event.count}`,
      });
    });

    // Listen for circuit breaker
    const unsubCB = this.memoryBus.on('circuit_broken', (event: any) => {
      this.eventLog.push({
        type: 'circuit_broken',
        timestamp: Date.now(),
        detail: `Circuit broken: ${event.reason}`,
      });
    });

    // Store unsubscribers for cleanup
    (this as any)._unsubscribers = [unsubPatch, unsubDev, unsubCB];
  }

  /**
   * unsubscribe — Stop listening for events
   */
  unsubscribe(): void {
    const unsubs: Array<() => void> = (this as any)._unsubscribers ?? [];
    for (const u of unsubs) {
      try { u(); } catch {}
    }
  }

  /**
   * verifyReflexLoop — Wait for reflex completion and verify timing
   *
   * @param options.expectedPatchDurationMs - Expected max loop time (default 50ms)
   * @returns Verification result
   */
  async verifyReflexLoop(options?: {
    expectedPatchDurationMs?: number;
    timeoutMs?: number;
  }): Promise<ReflexLoopVerification> {
    const expectedMax = options?.expectedPatchDurationMs ?? 50;
    const timeoutMs = options?.timeoutMs ?? 5000;

    // Wait for the reflex to complete (poll for patches)
    const maxWait = timeoutMs;
    const pollInterval = 10;
    let waited = 0;

    while (waited < maxWait) {
      await this.delay(pollInterval);
      waited += pollInterval;

      // Check if we've seen a patch or circuit break
      if (this.observedPatches.length > 0 || this.eventLog.some(e => e.type === 'circuit_broken')) {
        break;
      }
    }

    const endTime = Date.now();
    const totalDuration = this.startTime > 0 ? endTime - this.startTime : 0;

    const result: ReflexLoopVerification = {
      completed: this.observedPatches.length > 0 || this.eventLog.some(e => e.type === 'circuit_broken'),
      totalDurationMs: totalDuration,
      patchApplied: this.observedPatches.length > 0,
      patch: this.observedPatches.length > 0 ? this.observedPatches[0] : undefined,
      deviationRecorded: this.deviationObserved,
      eventTrace: this.eventLog,
      withinTarget: totalDuration <= expectedMax,
    };

    // Log verification result
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  🔬 FaultInjector: Reflex Loop Verification Report     ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Completed:       ${result.completed ? '✅ YES' : '❌ NO'}`);
    console.log(`║  Total Duration:  ${result.totalDurationMs}ms ${result.withinTarget ? '✅' : '⚠️'} (target: ${expectedMax}ms)`);
    console.log(`║  Patch Applied:   ${result.patchApplied ? '✅ YES' : '❌ NO'}`);
    console.log(`║  Deviation Rec:   ${result.deviationRecorded ? '✅ YES' : '❌ NO'}`);
    if (result.patch) {
      console.log(`║  Patch ID:        ${result.patch.patchId}`);
      console.log(`║  Operations:      ${result.patch.operations.length}`);
      console.log(`║  Affected Nodes:  ${result.patch.affectedNodes.join(', ')}`);
    }
    console.log(`║  Event Trace:`);
    for (const evt of result.eventTrace) {
      console.log(`║    ${new Date(evt.timestamp).toISOString().slice(11, 23)}  ${evt.type.padEnd(20)} ${evt.detail}`);
    }
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    return result;
  }

  /**
   * getEventTrace — Get the captured event trace
   */
  getEventTrace(): Array<{ type: string; timestamp: number; detail: string }> {
    return [...this.eventLog];
  }

  /**
   * reset — Clear event log and observed state
   */
  reset(): void {
    this.eventLog = [];
    this.observedPatches = [];
    this.deviationObserved = false;
    this.startTime = 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * createFaultInjectionTest — Convenience wrapper for fault injection in test suites
 *
 * Example:
 * ```typescript
 * import { createFaultInjectionTest } from './FaultInjector.js';
 *
 * it('should complete reflex loop within 50ms', async () => {
 *   const { injector, result } = await createFaultInjectionTest({
 *     memoryBus: mockMemoryBus,
 *     dynamicReflexEngine: dre,
 *     sessionId: 's1',
 *     executionId: 'e1',
 *     injectType: 'self_healing_failed',
 *   });
 *   expect(result.withinTarget).toBe(true);
 *   expect(result.patchApplied).toBe(true);
 * });
 * ```
 */
export async function createFaultInjectionTest(options: {
  memoryBus: FaultMemoryBus;
  sessionId: string;
  executionId: string;
  injectType?: 'self_healing_failed' | 'state_deviation';
  injectPayload?: Record<string, unknown>;
  expectedPatchDurationMs?: number;
}): Promise<{ injector: FaultInjector; result: ReflexLoopVerification }> {
  const injector = new FaultInjector(options.memoryBus, {
    sessionId: options.sessionId,
    executionId: options.executionId,
  });

  injector.subscribeToEvents();

  const injectType = options.injectType ?? 'self_healing_failed';
  if (injectType === 'self_healing_failed') {
    await injector.injectSelfHealingFailed(options.injectPayload as any);
  } else {
    await injector.injectStateDeviation(options.injectPayload as any);
  }

  const result = await injector.verifyReflexLoop({
    expectedPatchDurationMs: options.expectedPatchDurationMs ?? 50,
  });

  injector.unsubscribe();
  return { injector, result };
}
