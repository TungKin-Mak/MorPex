/**
 * MockRuntimeAdapter — Deterministic mock for testing MorPexCore adapter contracts.
 *
 * Implements both InferencePort and AgentRuntimePort.
 * Replays a configurable MockScript with delays.
 * No Pi dependencies — usable in unit tests without a Pi backend.
 * No `as any` casts — all events are properly typed.
 */

import type {
  InferencePort,
  GenerateRequest,
  InferenceEvent,
  ExecutionContext,
  InferenceCapabilities,
} from '../../contracts/inference.js';

import type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
  RuntimeCheckpoint,
  AgentRuntimeCapabilities,
} from '../../contracts/agent-runtime.js';

import type { RuntimeError } from '../../contracts/errors.js';
import type { TokenUsage } from '../../contracts/inference.js';
import { NO_CAPABILITIES } from '../../contracts/capabilities.js';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** A step in a mock scenario */
export interface MockStep {
  delayMs?: number;
  event: AgentRuntimeEvent | InferenceEvent;
  final?: boolean;
}

/** A complete mock scenario */
export interface MockScript {
  label: string;
  steps: MockStep[];
  capabilities?: {
    inference?: Partial<InferenceCapabilities>;
    agentRuntime?: Partial<AgentRuntimeCapabilities>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Factory functions — properly typed, no `as any`
// ═══════════════════════════════════════════════════════════════════

export function simpleTextResponse(runId: string, text: string): MockScript {
  const ts = Date.now();
  return {
    label: 'simpleTextResponse',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: ts }),
      mkStep({ type: 'assistant.delta', runId, text: text.slice(0, 20) }),
      mkStep({ type: 'assistant.delta', runId, text: text.slice(20, 40) }),
      mkStep({ type: 'assistant.delta', runId, text: text.slice(40) }),
      mkStep({ type: 'assistant.completed', runId, content: text }),
      mkFinal({ type: 'run.completed', runId }),
    ],
  };
}

export function toolCallSequence(
  runId: string,
  calls: Array<{ name: string; args: Record<string, unknown>; result: string }>,
): MockScript {
  const ts = Date.now();
  const steps: MockStep[] = [
    mkStep({ type: 'run.started', runId, timestamp: ts }),
  ];

  for (let i = 0; i < calls.length; i++) {
    const tc = calls[i];
    const callId = `call_${i}`;

    steps.push(
      mkStep({
        type: 'tool.requested',
        runId,
        call: { callId, name: tc.name, args: tc.args },
      }),
      mkStep({ type: 'tool.started', runId, callId }),
      mkStep({
        type: 'tool.completed',
        runId,
        result: { callId, name: tc.name, success: true, content: tc.result, durationMs: 20 },
      }),
    );
  }

  steps.push(mkFinal({ type: 'run.completed', runId }));
  return { label: 'toolCallSequence', steps };
}

export function errorScenario(runId: string, error: Partial<RuntimeError>): MockScript {
  const err: RuntimeError = {
    code: error.code ?? 'E_MOCK_ERROR',
    message: error.message ?? 'Mock error',
    retryable: error.retryable ?? false,
    providerCode: error.providerCode,
    cause: error.cause,
  };
  const failedEvent: AgentRuntimeEvent = { type: 'run.failed', runId, error: err, timestamp: Date.now() };

  return {
    label: 'errorScenario',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep(failedEvent),
      mkFinal(failedEvent),
    ],
  };
}

export function timeoutScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_TIMEOUT', message: 'Execution timed out', retryable: true, providerCode: 'timeout' };
  const failEvent: AgentRuntimeEvent = { type: 'run.failed', runId, error: err, timestamp: Date.now() };

  return {
    label: 'timeoutScenario',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep({ type: 'assistant.delta', runId, text: 'Thinking...' }),
      mkStep(failEvent, 2000),
      mkFinal(failEvent),
    ],
  };
}

export function cancellationScenario(runId: string, reason?: string): MockScript {
  const cancelEvent: AgentRuntimeEvent = { type: 'run.cancelled', runId, reason, timestamp: Date.now() };

  return {
    label: 'cancellationScenario',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep({ type: 'assistant.delta', runId, text: 'Working...' }),
      mkStep(cancelEvent, 100),
      mkFinal(cancelEvent),
    ],
  };
}

export function usageScenario(runId: string): MockScript {
  const usage: TokenUsage = { inputTokens: 150, outputTokens: 300, cost: 0.002 };
  const usageEvent: AgentRuntimeEvent = { type: 'usage.updated', runId, usage };

  return {
    label: 'usageScenario',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep({ type: 'assistant.delta', runId, text: 'Response text.' }),
      mkStep({ type: 'assistant.completed', runId, content: 'Response text.' }),
      mkStep(usageEvent),
      mkFinal({ type: 'run.completed', runId, usage }),
    ],
  };
}

export function unknownEventScenario(runId: string): MockScript {
  const unknown: AgentRuntimeEvent = { type: 'unknown', runId, raw: { foo: 'bar' } };

  return {
    label: 'unknownEventScenario',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep(unknown),
      mkFinal({ type: 'run.completed', runId }),
    ],
  };
}

export function providerUnavailableScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_PROVIDER_UNAVAILABLE', message: 'Service unavailable', retryable: true, providerCode: '503' };
  return {
    label: 'providerUnavailable',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkFinal({ type: 'run.failed', runId, error: err, timestamp: Date.now() }),
    ],
  };
}

export function authFailureScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_AUTHENTICATION_FAILED', message: 'Invalid API key', retryable: false, providerCode: '401' };
  return {
    label: 'authFailure',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkFinal({ type: 'run.failed', runId, error: err, timestamp: Date.now() }),
    ],
  };
}

export function rateLimitScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_RATE_LIMITED', message: 'Too many requests', retryable: true, providerCode: '429' };
  return {
    label: 'rateLimit',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkFinal({ type: 'run.failed', runId, error: err, timestamp: Date.now() }),
    ],
  };
}

export function contextLimitScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_CONTEXT_LIMIT_EXCEEDED', message: 'Context window exceeded', retryable: false, providerCode: 'context_length' };
  return {
    label: 'contextLimit',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkFinal({ type: 'run.failed', runId, error: err, timestamp: Date.now() }),
    ],
  };
}

export function streamingOrderScenario(runId: string): MockScript {
  const ts = Date.now();
  const deltas = ['First ', 'second ', 'third.'];
  const steps: MockStep[] = [mkStep({ type: 'run.started', runId, timestamp: ts })];
  for (const d of deltas) {
    steps.push(mkStep({ type: 'assistant.delta', runId, text: d }));
  }
  steps.push(mkStep({ type: 'assistant.completed', runId, content: deltas.join('') }));
  steps.push(mkFinal({ type: 'run.completed', runId }));
  return { label: 'streamingOrder', steps };
}

export function emptyResponseScenario(runId: string): MockScript {
  return {
    label: 'emptyResponse',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep({ type: 'assistant.completed', runId, content: '' }),
      mkFinal({ type: 'run.completed', runId }),
    ],
  };
}

export function modelNotFoundScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_MODEL_NOT_FOUND', message: 'Model not found', retryable: false };
  return {
    label: 'modelNotFound',
    steps: [
      mkFinal({ type: 'run.failed', runId, error: err, timestamp: Date.now() }),
    ],
  };
}

export function streamMidFailureScenario(runId: string): MockScript {
  const err: RuntimeError = { code: 'E_PROVIDER_ERROR', message: 'Stream interrupted', retryable: true };
  return {
    label: 'streamMidFailure',
    steps: [
      mkStep({ type: 'run.started', runId, timestamp: Date.now() }),
      mkStep({ type: 'assistant.delta', runId, text: 'Half way...' }),
      mkFinal({ type: 'run.failed', runId, error: err, timestamp: Date.now() }),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers — construct properly typed MockStep objects
// ═══════════════════════════════════════════════════════════════════

function mkStep(event: AgentRuntimeEvent, delayMs?: number): MockStep {
  return { delayMs: delayMs ?? (event.type === 'run.failed' || event.type === 'tool.completed' ? 20 : 10), event };
}

function mkFinal(event: AgentRuntimeEvent): MockStep {
  return { event, final: true };
}

// ═══════════════════════════════════════════════════════════════════
// Inference Event Mapping — converts AgentRuntimeEvent → InferenceEvent
// ═══════════════════════════════════════════════════════════════════

function toInferenceEvents(runId: string, steps: MockStep[]): MockStep[] {
  return steps.map(s => {
    const e = s.event as AgentRuntimeEvent;
    let mapped: InferenceEvent;

    switch (e.type) {
      case 'run.started':
        mapped = { type: 'stream.started', runId, timestamp: e.timestamp };
        break;
      case 'assistant.delta':
        mapped = { type: 'token', runId, text: e.text, timestamp: Date.now() };
        break;
      case 'assistant.completed':
        mapped = { type: 'stream.completed', runId, content: e.content, timestamp: Date.now() };
        break;
      case 'run.failed':
        mapped = { type: 'stream.failed', runId, error: e.error, timestamp: Date.now() };
        break;
      case 'run.cancelled':
        mapped = { type: 'stream.cancelled', runId, reason: e.reason, timestamp: Date.now() };
        break;
      case 'run.completed':
        mapped = { type: 'stream.completed', runId, content: '', timestamp: Date.now() };
        break;
      case 'usage.updated':
        mapped = { type: 'usage', runId, usage: e.usage, timestamp: Date.now() };
        break;
      // Already InferenceEvent types — pass through
      case 'stream.started':
      case 'stream.completed':
      case 'stream.failed':
      case 'stream.cancelled':
      case 'token':
      case 'usage':
      case 'reasoning':
      case 'unknown':
        mapped = s.event as InferenceEvent;
        break;
      default:
        mapped = { type: 'unknown', runId, raw: e, timestamp: Date.now() };
        break;
    }

    return { ...s, event: mapped };
  });
}

// ═══════════════════════════════════════════════════════════════════
// MockRuntimeAdapter
// ═══════════════════════════════════════════════════════════════════

export interface MockRuntimeAdapterConfig {
  defaultScript?: MockScript;
  globalDelayMs?: number;
  respectAbortSignal?: boolean;
  inferenceCapabilities?: InferenceCapabilities;
  agentRuntimeCapabilities?: AgentRuntimeCapabilities;
}

const DEFAULT_INFERENCE_CAPABILITIES: InferenceCapabilities = {
  streaming: true, reasoning: true, usageReporting: true, cancellation: true, imageInput: false,
};

const DEFAULT_AGENT_CAPABILITIES: AgentRuntimeCapabilities = {
  streaming: true, toolCalling: true, parallelToolCalls: true, cancellation: true,
  reasoning: true, usageReporting: true, checkpointResume: false, sessionPersistence: true, compaction: true,
};

export class MockRuntimeAdapter {
  private config: Required<MockRuntimeAdapterConfig>;
  private currentScript: MockScript | null = null;
  private activeRunId: string | null = null;
  private aborted = false;

  constructor(config: MockRuntimeAdapterConfig = {}) {
    this.config = {
      defaultScript: config.defaultScript ?? simpleTextResponse('mock', 'Mock response'),
      globalDelayMs: config.globalDelayMs ?? 0,
      respectAbortSignal: config.respectAbortSignal ?? true,
      inferenceCapabilities: config.inferenceCapabilities ?? DEFAULT_INFERENCE_CAPABILITIES,
      agentRuntimeCapabilities: config.agentRuntimeCapabilities ?? DEFAULT_AGENT_CAPABILITIES,
    };
  }

  /** Set/override the script for the next run (used by contract tests). */
  setScript(script: MockScript): void {
    this.config.defaultScript = script;
  }

  // ═══════════════════════════════════════════════════════════════
  // AgentRuntimePort
  // ═══════════════════════════════════════════════════════════════

  async *execute(
    request: AgentRunRequest,
    _context?: ExecutionContext,
  ): AsyncIterable<AgentRuntimeEvent> {
    this.activeRunId = request.runId;
    this.aborted = false;
    this._portMode = 'agent';
    this.currentScript = this.config.defaultScript ?? simpleTextResponse(request.runId, 'Mock output');

    yield* this.replayEvents<AgentRuntimeEvent>(request.runId);
  }

  async cancel(runId: string, _reason?: string): Promise<void> {
    if (runId === this.activeRunId || runId === '*') {
      this.aborted = true;
    }
  }

  async getAgentCapabilities(): Promise<AgentRuntimeCapabilities> {
    return { ...this.config.agentRuntimeCapabilities };
  }

  // ═══════════════════════════════════════════════════════════════
  // InferencePort
  // ═══════════════════════════════════════════════════════════════

  async *generate(
    request: GenerateRequest,
    _context?: ExecutionContext,
  ): AsyncIterable<InferenceEvent> {
    this.activeRunId = request.runId;
    this.aborted = false;
    this._portMode = 'inference';
    this.currentScript = this.config.defaultScript ?? simpleTextResponse(request.runId, 'Mock output');

    // Wire abort signal from request options
    if (request.options?.signal) {
      const signal = request.options.signal;
      if (signal.aborted) { this.aborted = true; }
      else { signal.addEventListener('abort', () => { this.aborted = true; }, { once: true }); }
    }

    const inferenceSteps = toInferenceEvents(request.runId, this.currentScript.steps);
    this.currentScript = { ...this.currentScript, steps: inferenceSteps };

    yield* this.replayEvents<InferenceEvent>(request.runId);
  }

  async abort(runId: string, _reason?: string): Promise<void> {
    if (runId === this.activeRunId || runId === '*') {
      this.aborted = true;
    }
  }

  async getInferenceCapabilities(): Promise<InferenceCapabilities> {
    return { ...this.config.inferenceCapabilities };
  }

  // ═══════════════════════════════════════════════════════════════
  // Replay engine
  // ═══════════════════════════════════════════════════════════════

  private _portMode: 'agent' | 'inference' = 'agent';

  private async *replayEvents<T extends AgentRuntimeEvent | InferenceEvent>(
    runId: string,
  ): AsyncIterable<T> {
    if (!this.currentScript) return;

    const cancelType = this._portMode === 'inference' ? 'stream.cancelled' : 'run.cancelled';

    for (const step of this.currentScript.steps) {
      if (this.config.respectAbortSignal && this.aborted) {
        yield {
          type: cancelType,
          runId,
          reason: 'Aborted by cancel()',
          timestamp: Date.now(),
        } as unknown as T;
        return;
      }

      const delay = this.config.globalDelayMs + (step.delayMs ?? 10);
      if (delay > 0) {
        await this.sleep(delay);
      }

      // Check abort again after delay
      if (this.config.respectAbortSignal && this.aborted) {
        yield {
          type: cancelType,
          runId,
          reason: 'Aborted by cancel()',
          timestamp: Date.now(),
        } as unknown as T;
        return;
      }

      yield step.event as unknown as T;

      if (step.final) return;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
