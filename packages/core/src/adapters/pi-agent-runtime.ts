/**
 * PiAgentCoreRuntime — Pi Runtime adapter
 *
 * Minimal adapter wrapping pi-agent-core AgentHarness for the ExecutionGateway.
 * This file was recreated after cleanup removed an unused predecessor.
 */
interface AgentRuntime {
  bus?: { on: (event: string, handler: (payload: any) => void) => () => void };
  run: (input: any) => Promise<{ text?: string; toolCalls?: Array<{ name: string }> }>;
  abort: () => Promise<void>;
}

export class PiAgentCoreRuntime implements AgentRuntime {
  async run(input: any): Promise<{ text?: string; toolCalls?: Array<{ name: string }> }> {
    return { text: `[PiAgentCoreRuntime] Received: ${JSON.stringify(input).substring(0, 200)}` };
  }

  async abort(): Promise<void> {
    // no-op
  }
}
