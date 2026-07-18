/**
 * MorPex Contracts — Tool Definitions
 *
 * Stable, Pi-independent tool contracts.
 * Adapters map between these and Pi's native tool types.
 */

/** JSON Schema–compatible type descriptor (pi-ai uses TypeBox, we normalize to a subset) */
export interface MorPexSchema {
  type: string;
  properties?: Record<string, MorPexSchema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: MorPexSchema;
  additionalProperties?: boolean;
}

/** Tool parameter definition */
export interface ToolParamDef {
  name: string;
  schema: MorPexSchema;
  description?: string;
}

/** Tool definition (MorPex canonical) */
export interface ToolDefinition {
  /** Unique tool name */
  name: string;
  /** Human-readable description for the model */
  description: string;
  /** JSON Schema describing the tool's input parameters */
  parameters: MorPexSchema;
  /** Optional execution category for grouping */
  category?: string;
}

/** Tool call — a request to execute a tool */
export interface ToolCall {
  /** Unique call ID */
  callId: string;
  /** Tool name */
  name: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Optional domain context */
  domain?: string;
  /** Optional task ID for tracing */
  taskId?: string;
}

/** Tool execution result */
export interface ToolResult {
  callId: string;
  name: string;
  /** Whether the tool completed successfully */
  success: boolean;
  /** Result content (text or structured) */
  content?: string | unknown;
  /** Error details when success=false */
  error?: string;
  /** Execution duration in ms */
  durationMs?: number;
}

/** Factory-style tool executor */
export interface ToolExecutor {
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}
