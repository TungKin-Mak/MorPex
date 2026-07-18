/**
 * PiAgentCore Event Mapper — converts pi-agent-core harness events → AgentRuntimeEvent.
 *
 * Maps AgentHarness events to the stable AgentRuntimeEvent discriminated union.
 */

import type { AgentRuntimeEvent } from '../../contracts/agent-runtime.js';
import type { ToolCall, ToolResult } from '../../contracts/tool.js';
import type { TokenUsage } from '../../contracts/inference.js';
import type { RuntimeError } from '../../contracts/errors.js';
import { classifyError } from '../../contracts/errors.js';

/**
 * pi-agent-core harness event shape (structural).
 */
interface PiHarnessEvent {
  type: string;
  message?: {
    role?: string;
    content?: string | unknown[];
  };
  delta?: string;
  toolCall?: {
    id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
  toolResult?: {
    callId?: string;
    toolName?: string;
    content?: string | unknown;
    isError?: boolean;
    error?: string;
  };
  usage?: {
    input?: number;
    output?: number;
    cost?: { total?: number };
    cacheRead?: number;
    cacheWrite?: number;
  };
  error?: string | { message?: string };
  reason?: string;
  summary?: string;
}

/**
 * Map a pi-agent-core harness event to AgentRuntimeEvent.
 * Returns null for events that should be silently consumed.
 */
export function mapPiAgentEvent(runId: string, rawEvent: unknown): AgentRuntimeEvent | null {
  const event = rawEvent as PiHarnessEvent;
  const ts = Date.now();

  switch (event.type) {
    // ── Agent lifecycle ──
    case 'agent_start':
      return { type: 'run.started', runId, timestamp: ts };

    case 'agent_end':
      return { type: 'run.completed', runId };

    // ── Streaming deltas ──
    case 'text_delta':
      return {
        type: 'assistant.delta',
        runId,
        text: event.delta ?? '',
      };

    case 'assistant_message': {
      const content = extractTextContent(event.message?.content);
      return {
        type: 'assistant.completed',
        runId,
        content,
      };
    }

    // ── Reasoning ──
    case 'thinking_delta':
      return {
        type: 'reasoning.delta',
        runId,
        text: event.delta ?? '',
      };

    // ── Tool calls ──
    case 'tool_call': {
      const tc = event.toolCall;
      if (!tc) return null;
      const args = typeof tc.arguments === 'string'
        ? tc.arguments
        : JSON.stringify(tc.arguments ?? {});

      return {
        type: 'tool.requested',
        runId,
        call: {
          callId: tc.id ?? `call_${ts}`,
          name: tc.name ?? 'unknown',
          args: safeJsonParse(args) as Record<string, unknown>,
        },
      };
    }

    case 'tool_start': {
      return {
        type: 'tool.started',
        runId,
        callId: event.toolCall?.id ?? `call_${ts}`,
      };
    }

    case 'tool_result': {
      const tr = event.toolResult;
      if (!tr) return null;

      const result: ToolResult = {
        callId: tr.callId ?? `call_${ts}`,
        name: tr.toolName ?? 'unknown',
        success: !tr.isError,
        content: tr.content ?? '',
        error: tr.error,
      };

      return result.success
        ? { type: 'tool.completed', runId, result }
        : {
            type: 'tool.failed',
            runId,
            callId: result.callId,
            error: {
              code: 'E_TOOL_EXECUTION_FAILED',
              message: tr.error ?? 'Tool execution failed',
              retryable: false,
            },
          };
    }

    // ── Errors ──
    case 'agent_error':
    case 'error': {
      const msg = typeof event.error === 'string'
        ? event.error
        : event.error?.message ?? 'Agent error';
      const category = classifyError(msg);
      return {
        type: 'run.failed',
        runId,
        error: {
          code: `E_${category.toUpperCase()}`,
          message: msg,
          retryable: category === 'timeout' || category === 'token_exhaustion',
        },
      };
    }

    // ── Usage ──
    case 'usage':
      return {
        type: 'usage.updated',
        runId,
        usage: mapPiUsage(event.usage),
      };

    // ── Compaction ──
    case 'compacted':
      return {
        type: 'run.compacted',
        runId,
        summary: event.summary ?? 'Context compacted',
      };

    // ── Cancellation ──
    case 'abort':
    case 'agent_abort':
      return {
        type: 'run.cancelled',
        runId,
        reason: event.reason ?? 'Cancelled',
      };

    default:
      console.warn(`[PiAgentCoreAdapter] Unknown harness event type: "${event.type}"`, {
        runId,
        eventType: event.type,
      });
      return {
        type: 'unknown',
        runId,
        raw: event,
      };
  }
}

// ── Helpers ──

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: unknown) => {
        const part = p as Record<string, unknown>;
        return part?.type === 'text' && typeof part?.text === 'string';
      })
      .map((p: unknown) => (p as Record<string, unknown>).text as string)
      .join('');
  }
  return '';
}

function mapPiUsage(usage?: PiHarnessEvent['usage']): TokenUsage {
  return {
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cost: usage?.cost?.total,
    cacheReadTokens: usage?.cacheRead,
    cacheWriteTokens: usage?.cacheWrite,
  };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
