/**
 * MorPex Contracts — Error Types
 *
 * Stable, Pi-independent error model.
 * Adapters translate provider/upstream errors into these types.
 */

/** Standardized runtime error */
export interface RuntimeError {
  /** Machine-readable error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Optional upstream provider code (for logging, never for control flow) */
  providerCode?: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Original error cause (sanitized for serialization) */
  cause?: string;
  /** Additional structured details */
  details?: Record<string, unknown>;
}

/** Known error categories */
export type ErrorCategory =
  | 'timeout'
  | 'token_exhaustion'
  | 'tool_error'
  | 'validation_failure'
  | 'mcp_crash'
  | 'dependency_missing'
  | 'llm_hallucination'
  | 'llm_timeout'
  | 'cancellation'
  | 'provider_error'
  | 'adapter_error'
  | 'unknown';

/** Helper to classify an error message into a category */
export function classifyError(message: string): ErrorCategory {
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('token') || lower.includes('context length') || lower.includes('max_tokens')) return 'token_exhaustion';
  if (lower.includes('hallucination') || lower.includes('invalid json') || lower.includes('parse')) return 'llm_hallucination';
  if (lower.includes('tool') || lower.includes('toolcall')) return 'tool_error';
  if (lower.includes('mcp') || lower.includes('spawn') || lower.includes('crash')) return 'mcp_crash';
  if (lower.includes('validation') || lower.includes('verify') || lower.includes('check')) return 'validation_failure';
  if (lower.includes('dependency') || lower.includes('deps') || lower.includes('missing')) return 'dependency_missing';
  if (lower.includes('llm') || lower.includes('model') || lower.includes('api')) return 'llm_timeout';
  if (lower.includes('cancel') || lower.includes('abort')) return 'cancellation';
  if (lower.includes('provider')) return 'provider_error';
  return 'unknown';
}
