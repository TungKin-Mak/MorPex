/**
 * ContractGateway — Contract-based execution gateway (replaces old ExecutionGateway).
 *
 * Routes execution requests through AgentRuntimePort/InferencePort adapters.
 * Core code never touches Pi types — only contracts.
 */

import type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
} from '@morpex/contracts/agent-runtime';

import type {
  InferencePort,
  GenerateRequest,
  InferenceEvent,
} from '@morpex/contracts/inference';

import type { AgentRuntimeCapabilities } from '@morpex/contracts/capabilities';
import type { ToolDefinition, ToolCall, ToolResult } from '@morpex/contracts/tool';
import type { RuntimeError } from '@morpex/contracts/errors';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface RegisteredAdapter {
  name: string;
  agentRuntime: AgentRuntimePort;
  inference?: InferencePort;
  capabilities: AgentRuntimeCapabilities;
}

export interface ContractGatewayConfig {
  defaultAdapterName?: string;
}

// ═══════════════════════════════════════════════════════════════════
// ContractGateway
// ═══════════════════════════════════════════════════════════════════

/**
 * ContractGateway — Routes execution through contract-based adapters.
 *
 * Core modules use this gateway.
 * Adapters are registered from bootstrap.
 */
export class ContractGateway {
  private adapters: Map<string, RegisteredAdapter> = new Map();
  private defaultName: string | null = null;
  private config: Required<ContractGatewayConfig>;

  constructor(config?: ContractGatewayConfig) {
    this.config = {
      defaultAdapterName: config?.defaultAdapterName ?? 'pi',
    };
  }

  /**
   * Register an adapter.
   */
  register(name: string, agentRuntime: AgentRuntimePort, inference?: InferencePort): void {
    // Query capabilities synchronously (default if async not available)
    const capsPromise = agentRuntime.getCapabilities?.() ?? Promise.resolve({
      streaming: true, toolCalling: true, parallelToolCalls: true,
      cancellation: true, reasoning: true, usageReporting: true,
      checkpointResume: false, sessionPersistence: true, compaction: true,
    });

    // To keep registration synchronous, resolve capabilities later
    capsPromise.then(capabilities => {
      this.adapters.set(name, { name, agentRuntime, inference, capabilities });
    }).catch(() => {
      this.adapters.set(name, {
        name, agentRuntime, inference,
        capabilities: {
          streaming: true, toolCalling: true, parallelToolCalls: true,
          cancellation: true, reasoning: true, usageReporting: true,
          checkpointResume: false, sessionPersistence: true, compaction: true,
        },
      });
    });
  }

  /**
   * Execute an agent run through the adapter.
   */
  async *executeAgentRun(
    request: AgentRunRequest,
    adapterName?: string,
  ): AsyncIterable<AgentRuntimeEvent> {
    const adapter = this.resolveAdapter(adapterName);
    yield* adapter.agentRuntime.execute(request);
  }

  /**
   * Cancel an agent run.
   */
  async cancelRun(runId: string, reason?: string, adapterName?: string): Promise<void> {
    const adapter = this.resolveAdapter(adapterName);
    await adapter.agentRuntime.cancel(runId, reason);
  }

  /**
   * Generate text through inference adapter.
   */
  async *generate(
    request: GenerateRequest,
    adapterName?: string,
  ): AsyncIterable<InferenceEvent> {
    const adapter = this.resolveAdapter(adapterName);
    if (!adapter.inference) {
      // Fallback: use agent runtime as inference
      // This is a simplified path — just use the agent runtime with a single call
      yield { type: 'stream.started', runId: request.runId, timestamp: Date.now() };
      yield { type: 'stream.failed', runId: request.runId, error: { code: 'E_NO_INFERENCE', message: `Adapter "${adapter.name}" does not support inference port`, retryable: false }, timestamp: Date.now() };
      return;
    }
    yield* adapter.inference.generate(request);
  }

  /**
   * Get available adapters.
   */
  getAdapterNames(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Get adapter capabilities.
   */
  getCapabilities(adapterName?: string): AgentRuntimeCapabilities | null {
    try {
      const adapter = this.resolveAdapter(adapterName);
      return adapter.capabilities;
    } catch {
      return null;
    }
  }

  private resolveAdapter(name?: string): RegisteredAdapter {
    const adapterName = name ?? this.config.defaultAdapterName;
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      const available = this.getAdapterNames().join(', ') || 'none';
      throw new Error(`[ContractGateway] Adapter "${adapterName}" not found. Available: ${available}`);
    }
    return adapter;
  }

  /**
   * Set default adapter.
   */
  setDefaultAdapter(name: string): void {
    this.config.defaultAdapterName = name;
  }
}
