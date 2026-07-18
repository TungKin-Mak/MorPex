/**
 * PiAI Event Mapper — converts pi-ai streaming events → MorPex InferenceEvent.
 *
 * Maps pi-ai's AssistantMessageEvent stream to the stable InferenceEvent
 * discriminated union. Unknown events are logged and mapped to 'unknown' type.
 */

import type { InferenceEvent, TokenUsage } from '../../contracts/inference.js';
import type { RuntimeError } from '../../contracts/errors.js';

/**
 * pi-ai AssistantMessageEvent shape (simplified — the real type is more complex).
 * We use a structural type to avoid importing the full pi-ai event union.
 */
interface PiStreamEvent {
  type: string;
  text?: string;
  delta?: string;
  content?: unknown;
  toolCall?: { id: string; name: string; arguments?: string };
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
  error?: { message?: string; code?: string };
  message?: { content?: unknown };
  finishReason?: string;
}

/**
 * Map a single pi-ai stream event to a MorPex InferenceEvent.
 *
 * Returns null if the event should be silently skipped.
 * Returns an 'unknown' event for unhandled event types.
 */
export function mapPiAIEvent(runId: string, rawEvent: unknown): InferenceEvent | null {
  const event = rawEvent as PiStreamEvent;
  const ts = Date.now();

  switch (event.type) {
    // Stream lifecycle
    case 'start':
      return { type: 'stream.started', runId, timestamp: ts };

    // Text deltas
    case 'text_delta':
      return {
        type: 'token',
        runId,
        text: event.delta ?? event.text ?? '',
        timestamp: ts,
      };

    // Text completion
    case 'text_end':
      // Intermediate — don't emit; wait for 'done'
      return null;

    // Thinking / reasoning
    case 'thinking_delta':
      return {
        type: 'reasoning',
        runId,
        text: event.delta ?? event.text ?? '',
        timestamp: ts,
      };
    case 'thinking_end':
      return null; // Wait for final

    // Tool calls
    case 'tool_use_start': {
      const tc = event.toolCall;
      if (!tc) return null;
      return {
        type: 'tool.call',
        runId,
        callId: tc.id,
        name: tc.name,
        args: tc.arguments ?? '{}',
      };
    }
    case 'tool_use_delta':
    case 'tool_use_end':
      return null; // Handled by tool_use_start

    // Final result
    case 'done': {
      const content = extractContent(event);
      // Also emit usage if available
      return {
        type: 'stream.completed',
        runId,
        content,
        timestamp: ts,
      };
    }

    // Error
    case 'error':
      return {
        type: 'stream.failed',
        runId,
        error: {
          code: event.error?.code ?? 'E_PROVIDER_ERROR',
          message: event.error?.message ?? 'Unknown provider error',
          retryable: false,
        },
        timestamp: ts,
      };

    // Usage update (some providers emit intermediate usage)
    case 'usage':
      return {
        type: 'usage',
        runId,
        usage: mapUsage(event.usage),
        timestamp: ts,
      };

    default:
      // Unknown event — log and emit as 'unknown'
      console.warn(`[PiAIAdapter] Unknown pi-ai event type: "${event.type}"`, {
        runId,
        eventType: event.type,
      });
      return {
        type: 'unknown',
        runId,
        raw: event,
        timestamp: ts,
      };
  }
}

/**
 * Extract text content from a 'done' event.
 */
function extractContent(event: PiStreamEvent): string {
  if (typeof event.content === 'string') return event.content;
  if (event.message?.content) {
    const c = event.message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .filter((part: unknown) => {
          const p = part as Record<string, unknown>;
          return p?.type === 'text' && typeof p?.text === 'string';
        })
        .map((part: unknown) => (part as Record<string, unknown>).text as string)
        .join('');
    }
  }
  return '';
}

/**
 * Map pi-ai usage to MorPex TokenUsage.
 */
export function mapUsage(usage?: PiStreamEvent['usage']): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cost: usage?.cost,
  };
}
