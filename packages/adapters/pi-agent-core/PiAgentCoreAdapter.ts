/**
 * PiAgentCoreAdapter — Adapts @earendil-works/pi-agent-core to MorPex AgentRuntimePort.
 *
 * Converts MorPex AgentRunRequest → pi-agent-core AgentHarness.
 * All pi-agent-core types are internal; callers see only MorPex contracts.
 *
 * Mapper modules:
 *   - pi-agent-request-mapper.ts → AgentRunRequest → pi-agent-core params
 *   - pi-agent-event-mapper.ts   → harness events → AgentRuntimeEvent
 *   - pi-agent-error-mapper.ts   → errors → RuntimeError
 */

import type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
  RuntimeCheckpoint,
  ExecutionContext,
} from '../../contracts/agent-runtime.js';
import type { AgentRuntimeCapabilities } from '../../contracts/capabilities.js';

// pi-agent-core imports (isolated to this file)
import { AgentHarness, InMemorySessionRepo } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { AgentHarnessEvent } from '@earendil-works/pi-agent-core';

// Mapper modules
import { buildHarnessParams } from './pi-agent-request-mapper.js';
import { mapPiAgentEvent } from './pi-agent-event-mapper.js';
import { mapPiAgentError } from './pi-agent-error-mapper.js';

// Model resolver (type-safe, no `as any`)
import { resolveModel } from './model-resolver.js';

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

export interface PiAgentCoreAdapterConfig {
  defaultProvider?: string;
  defaultModelId?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<PiAgentCoreAdapterConfig> = {
  defaultProvider: 'deepseek',
  defaultModelId: 'deepseek-v4-flash',
  maxTurns: 25,
  timeoutMs: 120_000,
};

// ═══════════════════════════════════════════════════════════════════
// PiAgentCoreAdapter
// ═══════════════════════════════════════════════════════════════════

export class PiAgentCoreAdapter implements AgentRuntimePort {
  private config: Required<PiAgentCoreAdapterConfig>;
  private harnesses: Map<string, AgentHarness> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private env: NodeExecutionEnv;

  constructor(config?: PiAgentCoreAdapterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.env = new NodeExecutionEnv({ cwd: process.cwd() });
  }

  // ═══════════════════════════════════════════════════════════════
  // AgentRuntimePort implementation
  // ═══════════════════════════════════════════════════════════════

  async *execute(
    request: AgentRunRequest,
    _context?: ExecutionContext,
  ): AsyncIterable<AgentRuntimeEvent> {
    const runId = request.runId;
    const ts = () => Date.now();

    // ── Create harness ──
    const harness = await this.createHarness(request);
    this.harnesses.set(runId, harness);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    try {
      yield { type: 'run.started', runId, timestamp: ts() };

      // ── Bridge harness events → AgentRuntimeEvent stream ──
      const eventStream = this.bridgeEvents(harness, runId, abortController.signal);
      const runPromise = harness.prompt(request.input);

      for await (const event of eventStream) {
        yield event;
        if (
          event.type === 'run.completed' ||
          event.type === 'run.failed' ||
          event.type === 'run.cancelled'
        ) {
          return;
        }
      }

      await runPromise;

    } catch (err) {
      if (abortController.signal.aborted) {
        yield { type: 'run.cancelled', runId, reason: 'Cancelled', timestamp: ts() };
        return;
      }
      const runtimeError = mapPiAgentError(err);
      yield { type: 'run.failed', runId, error: runtimeError, timestamp: ts() };

    } finally {
      this.abortControllers.delete(runId);
      this.harnesses.delete(runId);
    }
  }

  async cancel(runId: string, _reason?: string): Promise<void> {
    this.abortControllers.get(runId)?.abort();
    const harness = this.harnesses.get(runId);
    if (harness) {
      try { await harness.abort(); } catch { /* ignore */ }
    }
  }

  async getCapabilities(): Promise<AgentRuntimeCapabilities> {
    return {
      streaming: true, toolCalling: true, parallelToolCalls: true,
      cancellation: true, reasoning: true, usageReporting: true,
      checkpointResume: false, sessionPersistence: true, compaction: true,
    };
  }

  async *resume(
    checkpoint: RuntimeCheckpoint,
    _context?: ExecutionContext,
  ): AsyncIterable<AgentRuntimeEvent> {
    yield {
      type: 'run.failed',
      runId: checkpoint.runId,
      error: { code: 'E_RESUME_UNSUPPORTED', message: 'Checkpoint/resume is not supported', retryable: false },
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create an AgentHarness from an AgentRunRequest.
   * Uses ModelResolver for type-safe model resolution.
   */
  private async createHarness(request: AgentRunRequest): Promise<AgentHarness> {
    const provider = request.provider ?? this.config.defaultProvider;
    const modelId = request.modelId ?? this.config.defaultModelId;
    const model = resolveModel(provider, modelId);

    const repo = new InMemorySessionRepo();
    const session = await repo.create({
      id: `run_${request.runId}_${Date.now()}`,
    });

    const { tools } = buildHarnessParams(request);

    return new AgentHarness({
      env: this.env,
      model,
      session,
      tools,
      systemPrompt: request.systemPrompt,
    });
  }

  /**
   * Bridge pi-agent-core harness subscription → async iterable of AgentRuntimeEvent.
   */
  private async *bridgeEvents(
    harness: AgentHarness,
    runId: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentRuntimeEvent> {
    const buffer: AgentRuntimeEvent[] = [];
    let resolver: (() => void) | null = null;

    const unsubscribe = harness.subscribe((event: AgentHarnessEvent) => {
      const mapped = mapPiAgentEvent(runId, event);
      if (mapped) {
        buffer.push(mapped);
        resolver?.();
      }
    });

    try {
      while (!signal.aborted) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
        } else {
          await new Promise<void>(resolve => {
            resolver = resolve;
            setTimeout(resolve, 100); // Poll every 100ms
          });
        }
      }

      if (signal.aborted) {
        yield { type: 'run.cancelled', runId, reason: 'Aborted', timestamp: Date.now() };
      }
    } finally {
      unsubscribe();
    }
  }
}
