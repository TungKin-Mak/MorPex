/**
 * PiAI Error Mapper — converts pi-ai errors → MorPex RuntimeError.
 *
 * Normalizes provider-specific errors into the stable RuntimeError format.
 */

import type { RuntimeError } from '../../contracts/errors.js';
import { classifyError } from '../../contracts/errors.js';

/**
 * Map a pi-ai error (thrown or from stream) to a RuntimeError.
 */
export function mapPiAIError(error: unknown, fallbackCode?: string): RuntimeError {
  if (error instanceof Error) {
    const msg = error.message;
    const category = classifyError(msg);

    return {
      code: toErrorCode(category, fallbackCode),
      message: sanitizeMessage(msg),
      retryable: isRetryable(category),
      providerCode: (error as unknown as Record<string, unknown>).code as string | undefined,
      cause: error.cause ? String(error.cause) : undefined,
      details: extractDetails(error),
    };
  }

  // Non-Error thrown (string, etc.)
  const msg = String(error);
  return {
    code: fallbackCode ?? 'E_UNKNOWN',
    message: msg,
    retryable: false,
  };
}

/**
 * Classify and map to a stable error code.
 */
function toErrorCode(category: string, fallback?: string): string {
  const codeMap: Record<string, string> = {
    timeout: 'E_TIMEOUT',
    token_exhaustion: 'E_CONTEXT_LIMIT_EXCEEDED',
    tool_error: 'E_TOOL_EXECUTION_FAILED',
    validation_failure: 'E_INVALID_REQUEST',
    mcp_crash: 'E_PROVIDER_UNAVAILABLE',
    dependency_missing: 'E_INVALID_REQUEST',
    llm_hallucination: 'E_PROVIDER_ERROR',
    llm_timeout: 'E_TIMEOUT',
    cancellation: 'E_CANCELLED',
    provider_error: 'E_PROVIDER_UNAVAILABLE',
    unknown: 'E_UNKNOWN',
  };

  return codeMap[category] ?? fallback ?? 'E_UNKNOWN';
}

/**
 * Determine if a given error category is retryable.
 */
function isRetryable(category: string): boolean {
  const retryable = new Set([
    'timeout',
    'llm_timeout',
    'provider_error',
    'rate_limited',
    'token_exhaustion',
  ]);
  return retryable.has(category);
}

/**
 * Sanitize error message — remove potential sensitive data.
 */
function sanitizeMessage(msg: string): string {
  // Truncate extremely long messages
  if (msg.length > 1000) {
    return msg.slice(0, 997) + '...';
  }
  return msg;
}

/**
 * Extract non-sensitive details from an error for diagnostics.
 */
function extractDetails(error: Error): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};

  // Include stack trace for debugging (truncated)
  if (error.stack) {
    details.stack = error.stack.slice(0, 500);
  }

  // Copy known safe properties
  const safe = error as unknown as Record<string, unknown>;
  for (const key of ['statusCode', 'status', 'type']) {
    if (safe[key] !== undefined) {
      details[key] = safe[key];
    }
  }

  return Object.keys(details).length > 0 ? details : undefined;
}
