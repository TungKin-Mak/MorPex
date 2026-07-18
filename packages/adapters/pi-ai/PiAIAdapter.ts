/**
 * PiAIAdapter — Adapts @earendil-works/pi-ai to MorPex InferencePort.
 *
 * Converts MorPex GenerateRequest ↔ pi-ai streamSimple.
 * All pi-ai types are internal; callers see only MorPex contracts.
 *
 * Mapper modules:
 *   - pi-ai-request-mapper.ts  → GenerateRequest → pi-ai params
 *   - pi-ai-event-mapper.ts    → pi-ai stream events → InferenceEvent
 *   - pi-ai-error-mapper.ts    → pi-ai errors → RuntimeError
 */

import type {
  InferencePort,
  GenerateRequest,
  InferenceEvent,
  ExecutionContext,
} from '../../contracts/inference.js';
import type { InferenceCapabilities } from '../../contracts/capabilities.js';

// pi-ai imports (isolated to this file)
import { streamSimple } from '@earendil-works/pi-ai';
import type { Model, Api } from '@earendil-works/pi-ai';

// Mapper modules
import { buildPiContext, buildPiStreamOptions } from './pi-ai-request-mapper.js';
import { mapPiAIEvent, mapUsage } from './pi-ai-event-mapper.js';
import { mapPiAIError } from './pi-ai-error-mapper.js';

// Model resolver (type-safe, no `as any`)
import { resolveModel } from './model-resolver.js';

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

export interface PiAIAdapterConfig {
  defaultProvider?: string;
  defaultModelId?: string;
}

const DEFAULT_CONFIG: Required<PiAIAdapterConfig> = {
  defaultProvider: 'deepseek',
  defaultModelId: 'deepseek-v4-flash',
};

// ═══════════════════════════════════════════════════════════════════
// PiAIAdapter
// ═══════════════════════════════════════════════════════════════════

export class PiAIAdapter implements InferencePort {
  private config: Required<PiAIAdapterConfig>;
  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(config?: PiAIAdapterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async *generate(
    request: GenerateRequest,
    _context?: ExecutionContext,
  ): AsyncIterable<InferenceEvent> {
    const runId = request.runId;
    const ts = () => Date.now();

    // ── Resolve model (type-safe, no `as any`) ──
    const provider = request.options?.provider ?? this.config.defaultProvider;
    const modelId = request.options?.modelId ?? this.config.defaultModelId;

    let model: Model<Api>;
    try {
      model = resolveModel(provider, modelId);
    } catch (err) {
      yield {
        type: 'stream.failed', runId,
        error: {
          code: 'E_MODEL_NOT_FOUND',
          message: `Model not found: ${provider}/${modelId}`,
          retryable: false,
          cause: String(err),
        },
        timestamp: ts(),
      };
      return;
    }

    // ── Build pi-ai params via mapper ──
    const piContext = buildPiContext(request);
    const streamOpts = buildPiStreamOptions(request);

    // ── Abort controller ──
    const abortController = new AbortController();
    this.activeAbortControllers.set(runId, abortController);

    if (request.options?.signal) {
      if (request.options.signal.aborted) {
        abortController.abort();
      } else {
        request.options.signal.addEventListener(
          'abort',
          () => abortController.abort(),
          { once: true },
        );
      }
    }

    streamOpts.signal = abortController.signal;

    try {
      yield { type: 'stream.started', runId, timestamp: ts() };

      // ── Stream from pi-ai ──
      const stream = streamSimple(model, piContext as any, streamOpts as any);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          yield { type: 'stream.cancelled', runId, reason: 'User cancelled', timestamp: ts() };
          return;
        }

        // ── Map event via mapper ──
        const event = mapPiAIEvent(runId, chunk);
        if (event) {
          yield event;
        }

        // Terminal events — stop iterating
        if (event && (event.type === 'stream.completed' || event.type === 'stream.failed' || event.type === 'stream.cancelled')) {
          return;
        }
      }

      // Fallback: if stream ends without a terminal event
      yield { type: 'stream.completed', runId, content: '', timestamp: ts() };

    } catch (err) {
      if (abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        yield { type: 'stream.cancelled', runId, reason: String(err), timestamp: ts() };
        return;
      }

      const runtimeError = mapPiAIError(err);
      yield { type: 'stream.failed', runId, error: runtimeError, timestamp: ts() };

    } finally {
      this.activeAbortControllers.delete(runId);
    }
  }

  async abort(runId: string, _reason?: string): Promise<void> {
    this.activeAbortControllers.get(runId)?.abort();
  }

  async getCapabilities(): Promise<InferenceCapabilities> {
    return {
      streaming: true,
      reasoning: true,
      usageReporting: true,
      cancellation: true,
      imageInput: true,
    };
  }
}
