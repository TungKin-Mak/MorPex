/**
 * MorPex Contracts — Inference Port
 *
 * Defines the stable interface for single-turn model inference (non-agent).
 * Adapters (PiAIAdapter, MockRuntimeAdapter) implement this.
 *
 * This port is for one-shot text generation / streaming.
 * For full agent runs, use AgentRuntimePort.
 */

import type { RuntimeError } from './errors.js';
import type { InferenceCapabilities } from './capabilities.js';

// Re-export types consumed by adapter implementations
export type { InferenceCapabilities };
import type { ToolDefinition } from './tool.js';

// ═══════════════════════════════════════════════════════════════════
// Request / Response types
// ═══════════════════════════════════════════════════════════════════

/** A single message in a conversation */
export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

/** Options for a generate request */
export interface GenerateOptions {
  /** Temperature (0–1) */
  temperature?: number;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Model ID override */
  modelId?: string;
  /** Provider override */
  provider?: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>;
  /** HTTP request timeout in ms */
  timeoutMs?: number;
}

/** Request to generate text */
export interface GenerateRequest {
  /** Messages to send */
  messages: InferenceMessage[];
  /** Optional system prompt */
  systemPrompt?: string;
  /** Optional tools available */
  tools?: ToolDefinition[];
  /** Generation options */
  options?: GenerateOptions;
  /** Unique run ID (set by MorPexCore) */
  runId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Inference Event Stream (discriminated union)
// ═══════════════════════════════════════════════════════════════════

export type InferenceEvent =
  | { type: 'stream.started'; runId: string; timestamp: number }
  | { type: 'token'; runId: string; text: string; timestamp: number }
  | { type: 'reasoning'; runId: string; text: string; timestamp: number }
  | { type: 'tool.call'; runId: string; callId: string; name: string; args: string }
  | { type: 'stream.completed'; runId: string; content: string; timestamp: number }
  | { type: 'stream.failed'; runId: string; error: RuntimeError; timestamp: number }
  | { type: 'stream.cancelled'; runId: string; reason?: string; timestamp: number }
  | { type: 'usage'; runId: string; usage: TokenUsage; timestamp: number }
  | { type: 'unknown'; runId: string; raw: unknown; timestamp: number };

// ═══════════════════════════════════════════════════════════════════
// Token Usage
// ═══════════════════════════════════════════════════════════════════

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Optional cost in USD (or provider-native currency) */
  cost?: number;
  /** Optional cache-related tokens */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Execution Context
// ═══════════════════════════════════════════════════════════════════

export interface ExecutionContext {
  sessionId?: string;
  traceId?: string;
  parentExecutionId?: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// InferencePort — the stable interface
// ═══════════════════════════════════════════════════════════════════

export interface InferencePort {
  /**
   * Generate text (streaming).
   *
   * Returns an AsyncIterable of InferenceEvent.
   * The stream MUST end with either 'stream.completed', 'stream.failed',
   * or 'stream.cancelled'.
   */
  generate(
    request: GenerateRequest,
    context?: ExecutionContext,
  ): AsyncIterable<InferenceEvent>;

  /**
   * Abort a running generation.
   *
   * @param runId - The run to abort (must match the request's runId)
   * @param reason - Optional human-readable reason
   */
  abort?(runId: string, reason?: string): Promise<void>;

  /**
   * Query backend capabilities.
   */
  getCapabilities?(): Promise<InferenceCapabilities>;
}
