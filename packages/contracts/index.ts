/**
 * MorPex Contracts — Barrel Export
 *
 * All stable contracts re-exported from one entry point.
 */

export type {
  InferencePort,
  GenerateRequest,
  GenerateOptions,
  InferenceMessage,
  InferenceEvent,
  ExecutionContext,
  TokenUsage,
} from './inference.js';

export type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
  RuntimeCheckpoint,
} from './agent-runtime.js';

export type {
  MorPexRuntimeEvent,
} from './runtime-events.js';

export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolExecutor,
  ToolParamDef,
  MorPexSchema,
} from './tool.js';

export type {
  RuntimeError,
  ErrorCategory,
} from './errors.js';
export { classifyError } from './errors.js';

export type {
  InferenceCapabilities,
  AgentRuntimeCapabilities,
} from './capabilities.js';
export { NO_CAPABILITIES } from './capabilities.js';
