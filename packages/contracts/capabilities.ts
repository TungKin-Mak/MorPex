/**
 * MorPex Contracts — Capability Descriptors
 *
 * Runtime capabilities that backends declare.
 * MorPexCore reads these to decide routing, degradation, and fast-fail.
 */

/** Inference backend capabilities */
export interface InferenceCapabilities {
  /** Supports streaming token delivery */
  streaming: boolean;
  /** Supports reasoning/thinking extraction */
  reasoning: boolean;
  /** Reports token usage */
  usageReporting: boolean;
  /** Accepts AbortSignal for cancellation */
  cancellation: boolean;
  /** Supports image input */
  imageInput: boolean;
}

/** Agent runtime capabilities */
export interface AgentRuntimeCapabilities {
  /** Supports streaming token delivery */
  streaming: boolean;
  /** Supports tool calling */
  toolCalling: boolean;
  /** Supports parallel tool execution */
  parallelToolCalls: boolean;
  /** Supports AbortSignal cancellation */
  cancellation: boolean;
  /** Supports reasoning extraction */
  reasoning: boolean;
  /** Reports token usage */
  usageReporting: boolean;
  /** Supports checkpoint/resume */
  checkpointResume: boolean;
  /** Supports session persistence */
  sessionPersistence: boolean;
  /** Supports compaction / context window management */
  compaction: boolean;
}

/** Default "no capabilities" sentinel */
export const NO_CAPABILITIES: AgentRuntimeCapabilities = {
  streaming: false,
  toolCalling: false,
  parallelToolCalls: false,
  cancellation: false,
  reasoning: false,
  usageReporting: false,
  checkpointResume: false,
  sessionPersistence: false,
  compaction: false,
};
