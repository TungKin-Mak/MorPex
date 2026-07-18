/**
 * PiAgentCore Request Mapper — converts MorPex AgentRunRequest → pi-agent-core params.
 */

import type { AgentRunRequest } from '../../contracts/agent-runtime.js';
import type { ToolDefinition } from '../../contracts/tool.js';

import type { AgentTool } from '@earendil-works/pi-agent-core';

/**
 * Convert a MorPex ToolDefinition to a pi-agent-core AgentTool.
 *
 * pi-agent-core's AgentTool has: name, label, description, parameters, execute
 * We build the shape expected by AgentHarness.
 */
export function toPiAgentTool(tool: ToolDefinition): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as AgentTool['parameters'],
    execute: async (_params: unknown): Promise<unknown> => {
      // Tool execution is owned by pi-agent-core.
      // The actual execution callback is set by the harness.
      // Return a stub — the real executor is set externally.
      throw new Error(`Tool "${tool.name}" has no executor configured.`);
    },
  } as AgentTool;
}

/**
 * Build system prompt + tools for AgentHarness construction.
 */
export function buildHarnessParams(request: AgentRunRequest): {
  systemPrompt: string;
  tools: AgentTool[];
} {
  return {
    systemPrompt: request.systemPrompt,
    tools: request.tools.map(toPiAgentTool),
  };
}
