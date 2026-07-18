/**
 * MorPex Contracts — Agent Runtime Port
 *
 * Defines the stable interface for full agent execution runs.
 * Adapters (PiAgentCoreAdapter, MockRuntimeAdapter) implement this.
 */

import type { RuntimeError } from './errors.js';
import type { AgentRuntimeCapabilities } from './capabilities.js';
import type { ToolDefinition, ToolCall, ToolResult } from './tool.js';
import type { ExecutionContext, TokenUsage } from './inference.js';

// Re-export types consumed by adapter implementations
export type { AgentRuntimeCapabilities };
export type { ExecutionContext };

// ═══════════════════════════════════════════════════════════════════
// Agent Run Request
// ═══════════════════════════════════════════════════════════════════

export interface AgentRunRequest {
  /** Unique run ID (owned by MorPexCore) */
  runId: string;
  /** The user's task / goal */
  input: string;
  /** System prompt that defines the agent persona */
  systemPrompt: string;
  /** Tools available to the agent */
  tools: ToolDefinition[];
  /** Model identifier */
  modelId?: string;
  /** Provider identifier */
  provider?: string;
  /** Session ID for persistent sessions */
  sessionId?: string;
  /** Maximum number of agent loop turns */
  maxTurns?: number;
  /** Timeout in ms for the entire run */
  timeoutMs?: number;
  /** Temperature */
  temperature?: number;
  /** Max tokens per turn */
  maxTokens?: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// Agent Runtime Event (discriminated union)
// ═══════════════════════════════════════════════════════════════════

export type AgentRuntimeEvent =
  | { type: 'run.started'; runId: string; timestamp: number }
  | { type: 'assistant.delta'; runId: string; text: string; timestamp?: number }
  | { type: 'assistant.completed'; runId: string; content: string; timestamp?: number }
  | { type: 'reasoning.delta'; runId: string; text: string; timestamp?: number }
  | { type: 'tool.requested'; runId: string; call: ToolCall; timestamp?: number }
  | { type: 'tool.started'; runId: string; callId: string; timestamp?: number }
  | { type: 'tool.completed'; runId: string; result: ToolResult; timestamp?: number }
  | { type: 'tool.failed'; runId: string; callId: string; error: RuntimeError; timestamp?: number }
  | { type: 'usage.updated'; runId: string; usage: TokenUsage; timestamp?: number }
  | { type: 'run.completed'; runId: string; usage?: TokenUsage; timestamp?: number }
  | { type: 'run.cancelled'; runId: string; reason?: string; timestamp?: number }
  | { type: 'run.failed'; runId: string; error: RuntimeError; timestamp?: number }
  | { type: 'run.compacted'; runId: string; summary: string; timestamp?: number }
  | { type: 'unknown'; runId: string; raw: unknown; timestamp?: number };

// ═══════════════════════════════════════════════════════════════════
// Checkpoint (for resume — if supported)
// ═══════════════════════════════════════════════════════════════════

export interface RuntimeCheckpoint {
  runId: string;
  sessionId: string;
  /** Serialized state that the adapter can restore */
  state: unknown;
  /** Timestamp when the checkpoint was created */
  timestamp: number;
  /** Number of completed turns */
  completedTurns: number;
}

// ═══════════════════════════════════════════════════════════════════
// AgentRuntimePort — the stable interface
// ═══════════════════════════════════════════════════════════════════

export interface AgentRuntimePort {
  /**
   * Execute a full agent run.
   *
   * Returns an AsyncIterable of AgentRuntimeEvent.
   * The stream MUST end with either 'run.completed', 'run.failed',
   * or 'run.cancelled'.
   */
  execute(
    request: AgentRunRequest,
    context?: ExecutionContext,
  ): AsyncIterable<AgentRuntimeEvent>;

  /**
   * Cancel a running agent execution.
   *
   * @param runId - The run to cancel
   * @param reason - Optional human-readable reason
   */
  cancel(runId: string, reason?: string): Promise<void>;

  /**
   * Resume from a checkpoint (optional — check capabilities first).
   */
  resume?(
    checkpoint: RuntimeCheckpoint,
    context?: ExecutionContext,
  ): AsyncIterable<AgentRuntimeEvent>;

  /**
   * Query backend capabilities.
   */
  getCapabilities?(): Promise<AgentRuntimeCapabilities>;
}
