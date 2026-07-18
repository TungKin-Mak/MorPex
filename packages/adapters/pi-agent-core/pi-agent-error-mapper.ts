/**
 * PiAgentCore Error Mapper — converts pi-agent-core errors → MorPex RuntimeError.
 */

import type { RuntimeError } from '../../contracts/errors.js';
import { classifyError } from '../../contracts/errors.js';

export function mapPiAgentError(error: unknown, fallbackCode?: string): RuntimeError {
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

  return {
    code: fallbackCode ?? 'E_UNKNOWN',
    message: String(error),
    retryable: false,
  };
}

function toErrorCode(category: string, fallback?: string): string {
  const map: Record<string, string> = {
    timeout: 'E_TIMEOUT',
    token_exhaustion: 'E_CONTEXT_LIMIT_EXCEEDED',
    tool_error: 'E_TOOL_EXECUTION_FAILED',
    validation_failure: 'E_INVALID_REQUEST',
    mcp_crash: 'E_PROVIDER_UNAVAILABLE',
    llm_timeout: 'E_TIMEOUT',
    cancellation: 'E_CANCELLED',
    provider_error: 'E_PROVIDER_UNAVAILABLE',
    unknown: 'E_UNKNOWN',
  };
  return map[category] ?? fallback ?? 'E_UNKNOWN';
}

function isRetryable(category: string): boolean {
  return new Set(['timeout', 'llm_timeout', 'provider_error', 'token_exhaustion']).has(category);
}

function sanitizeMessage(msg: string): string {
  return msg.length > 1000 ? msg.slice(0, 997) + '...' : msg;
}

function extractDetails(error: Error): Record<string, unknown> | undefined {
  const d: Record<string, unknown> = {};
  if (error.stack) d.stack = error.stack.slice(0, 500);
  const s = error as unknown as Record<string, unknown>;
  for (const k of ['statusCode', 'status', 'type']) {
    if (s[k] !== undefined) d[k] = s[k];
  }
  return Object.keys(d).length > 0 ? d : undefined;
}
