/**
 * PiAI Request Mapper — converts MorPex GenerateRequest → pi-ai streamSimple params.
 *
 * All pi-ai types are confined to this file.
 */

import type { GenerateRequest, InferenceMessage } from '../../contracts/inference.js';
import type { ToolDefinition } from '../../contracts/tool.js';

/**
 * Convert a MorPex InferenceMessage to a pi-ai Message-compatible object.
 */
export function toPiMessage(msg: InferenceMessage): Record<string, unknown> {
  const result: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };

  if (msg.name) result.name = msg.name;
  if (msg.toolCallId) result.tool_call_id = msg.toolCallId;

  return result;
}

/**
 * Convert a MorPex ToolDefinition to a pi-ai Tool-compatible object.
 */
export function toPiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/**
 * Build the pi-ai context object from a GenerateRequest.
 */
export function buildPiContext(request: GenerateRequest): Record<string, unknown> {
  const messages: Record<string, unknown>[] = request.messages.map(toPiMessage);

  if (request.systemPrompt) {
    messages.unshift({ role: 'system', content: request.systemPrompt });
  }

  const context: Record<string, unknown> = { messages };

  if (request.tools && request.tools.length > 0) {
    context.tools = request.tools.map(toPiTool);
  }

  return context;
}

/**
 * Extract stream options from a GenerateRequest.
 */
export function buildPiStreamOptions(request: GenerateRequest): Record<string, unknown> {
  const opts: Record<string, unknown> = {};

  if (request.options?.temperature !== undefined) {
    opts.temperature = request.options.temperature;
  }
  if (request.options?.maxTokens !== undefined) {
    opts.maxTokens = request.options.maxTokens;
  }
  if (request.options?.stopSequences) {
    opts.stop = request.options.stopSequences;
  }
  if (request.options?.signal) {
    opts.signal = request.options.signal;
  }
  if (request.options?.timeoutMs !== undefined) {
    opts.timeoutMs = request.options.timeoutMs;
  }
  if (request.options?.metadata) {
    opts.metadata = request.options.metadata;
  }

  return opts;
}
