/**
 * PiAdapterBridge — Wraps the old PiAdapter (which uses pi-agent-core AgentRuntime)
 * into the new AgentRuntimePort contract interface.
 *
 * Migration bridge: allows gradual transition from old PiAdapter to
 * new PiAgentCoreAdapter without breaking existing ExecutionGateway users.
 */

import type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
  RuntimeCheckpoint,
  AgentRuntimeCapabilities,
} from '@morpex/contracts/agent-runtime';

import type { ToolCall, ToolResult } from '@morpex/contracts/tool';
import type { RuntimeError } from '@morpex/contracts/errors';
import type { TokenUsage } from '@morpex/contracts/inference';
import { classifyError } from '@morpex/contracts/errors';

import { PiAdapter } from './adapters/PiAdapter.js';
import type { EventBus } from '../common/EventBus.js';
import type { ExecutionIdentity } from '../common/ExecutionIdentity.js';
import type { PiAdapterConfig } from '../common/types.js';

/**
 * PiAdapterBridge — Wraps old PiAdapter → AgentRuntimePort.
 *
 * The bridge preserves backward compatibility by delegating to the old PiAdapter
 * while exposing the new contract interface.
 */
export class PiAdapterBridge implements AgentRuntimePort {
  private adapter: PiAdapter;
  private activeRunId: string | null = null;

  constructor(
    adapterOrRuntime: PiAdapter | any,
    eventBus?: EventBus,
    config?: PiAdapterConfig,
    identity?: ExecutionIdentity,
  ) {
    if (adapterOrRuntime instanceof PiAdapter) {
      this.adapter = adapterOrRuntime;
    } else {
      // Construct from raw runtime (old bootstrap path)
      this.adapter = new PiAdapter(
        adapterOrRuntime,
        eventBus!,
        config,
        identity,
      );
    }
  }

  async *execute(
    request: AgentRunRequest,
    context?: any,
  ): AsyncIterable<AgentRuntimeEvent> {
    this.activeRunId = request.runId;

    // Convert AgentRunRequest → old ExecutionRequest format
    const oldRequest = {
      executionId: request.runId,
      agentRole: 'default',
      input: request.input,
      context: {
        sessionId: request.sessionId ?? `ses_${request.runId}`,
        traceId: request.runId,
        metadata: request.metadata,
      },
      constraints: {
        timeout: request.timeoutMs,
        maxRetries: request.maxTurns,
      },
    };

    yield { type: 'run.started', runId: request.runId, timestamp: Date.now() };

    try {
      const result = await this.adapter.execute(oldRequest);

      if (result.status === 'success') {
        yield { type: 'assistant.completed', runId: request.runId, content: result.output ?? '' };
        yield { type: 'run.completed', runId: request.runId, timestamp: Date.now() };
      } else if (result.status === 'aborted') {
        yield { type: 'run.cancelled', runId: request.runId, reason: 'Aborted', timestamp: Date.now() };
      } else {
        yield {
          type: 'run.failed',
          runId: request.runId,
          error: { code: 'E_EXECUTION_FAILED', message: 'Execution failed', retryable: false },
          timestamp: Date.now(),
        };
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const category = classifyError(msg);
      yield {
        type: 'run.failed',
        runId: request.runId,
        error: {
          code: `E_${category.toUpperCase()}`,
          message: msg,
          retryable: category === 'timeout' || category === 'token_exhaustion',
          cause: err?.cause ? String(err.cause) : undefined,
        },
        timestamp: Date.now(),
      };
    }
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    await this.adapter.abort('*');
  }

  async getCapabilities(): Promise<AgentRuntimeCapabilities> {
    return {
      streaming: false,  // Old adapter returns ExecutionResult, not stream
      toolCalling: true,
      parallelToolCalls: false,
      cancellation: true,
      reasoning: false,
      usageReporting: false,
      checkpointResume: false,
      sessionPersistence: true,
      compaction: false,
    };
  }

  async *resume(
    checkpoint: RuntimeCheckpoint,
    _context?: any,
  ): AsyncIterable<AgentRuntimeEvent> {
    yield {
      type: 'run.failed',
      runId: checkpoint.runId,
      error: { code: 'E_RESUME_UNSUPPORTED', message: 'Resume not supported by old PiAdapter', retryable: false },
      timestamp: Date.now(),
    };
  }
}
