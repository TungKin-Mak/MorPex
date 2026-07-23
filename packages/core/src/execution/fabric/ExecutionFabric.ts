/**
 * ExecutionFabric — v11 Unified Execution Fabric
 *
 * Merges AgentRuntime, Scheduler, and Connector Runtime into a single
 * execution plane. Coordinates the flow:
 *   Workflow Node → Capability Resolver → Agent Selection → Action Request → Execution
 *
 * @packageDocumentation
 */

import type { ConnectorRegistry } from '@morpex/connectors/ConnectorRegistry.js';
import type { ActionRequest, ActionResult } from '@morpex/connectors/types.js';
import type { IActionConnector } from '@morpex/connectors/IActionConnector.js';

// ═══════════════════════════════════════════════════════════════════
// Internal Types
// ═══════════════════════════════════════════════════════════════════

/** Agent capability descriptor */
export interface AgentCapability {
  agentId: string;
  agentName: string;
  capabilities: string[];
  reliabilityScore: number;
  costPerTask: number;
  status: 'available' | 'busy' | 'offline';
}

/** Capability resolution result */
export interface CapabilityResolution {
  capability: string;
  resolved: boolean;
  agents: AgentCapability[];
  selectedAgent?: AgentCapability;
  fallbackAgent?: AgentCapability;
}

/** Execution fabric configuration */
export interface ExecutionFabricConfig {
  /** Enable capability caching */
  cacheEnabled: boolean;
  /** Cache TTL in milliseconds */
  cacheTTLMs: number;
  /** Default timeout for actions */
  defaultTimeoutMs: number;
  /** Maximum retries for failed actions */
  maxRetries: number;
}

const DEFAULT_CONFIG: ExecutionFabricConfig = {
  cacheEnabled: true,
  cacheTTLMs: 60_000,
  defaultTimeoutMs: 30_000,
  maxRetries: 2,
};

// ═══════════════════════════════════════════════════════════════════
// ExecutionFabric
// ═══════════════════════════════════════════════════════════════════

/**
 * ExecutionFabric — Unified execution coordinator
 *
 * Provides a single entry point for executing actions through the
 * agent capability system and connector infrastructure.
 */
export class ExecutionFabric {
  /** Agent capability pool */
  private agentPool: Map<string, AgentCapability> = new Map();

  /** Connector registry reference */
  private connectorRegistry: ConnectorRegistry;

  /** Capability → Agent cache */
  private capabilityCache: Map<string, CapabilityResolution> = new Map();
  private cacheTimestamps: Map<string, number> = new Map();

  /** Fabric configuration */
  private config: ExecutionFabricConfig;

  constructor(
    connectorRegistry: ConnectorRegistry,
    config?: Partial<ExecutionFabricConfig>
  ) {
    this.connectorRegistry = connectorRegistry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ═══════════════════════════════════════════════════════════════
  // Agent Capability Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * registerAgentCapabilities — Register an agent's capabilities
   *
   * @param agentId - Agent identifier
   * @param agentName - Human-readable name
   * @param capabilities - List of capabilities
   * @param reliabilityScore - Agent reliability (0-1)
   * @param costPerTask - Cost per task (0-1)
   */
  registerAgentCapabilities(
    agentId: string,
    agentName: string,
    capabilities: string[],
    reliabilityScore: number = 0.8,
    costPerTask: number = 0.5
  ): void {
    this.agentPool.set(agentId, {
      agentId,
      agentName,
      capabilities,
      reliabilityScore,
      costPerTask,
      status: 'available',
    });
    this.invalidateCache();
  }

  /**
   * unregisterAgent — Remove an agent from the pool
   */
  unregisterAgent(agentId: string): void {
    this.agentPool.delete(agentId);
    this.invalidateCache();
  }

  /**
   * getAgent — Get agent capabilities
   */
  getAgent(agentId: string): AgentCapability | undefined {
    return this.agentPool.get(agentId);
  }

  /**
   * setAgentStatus — Update agent status
   */
  setAgentStatus(agentId: string, status: AgentCapability['status']): void {
    const agent = this.agentPool.get(agentId);
    if (agent) {
      agent.status = status;
    }
  }

  /**
   * listAgents — List all agents in the pool
   */
  listAgents(status?: AgentCapability['status']): AgentCapability[] {
    const all = [...this.agentPool.values()];
    if (status) return all.filter(a => a.status === status);
    return all;
  }

  /**
   * getPoolCapabilities — Get all unique capabilities across all agents
   */
  getPoolCapabilities(): string[] {
    const caps = new Set<string>();
    for (const agent of this.agentPool.values()) {
      for (const cap of agent.capabilities) {
        caps.add(cap);
      }
    }
    return [...caps].sort();
  }

  // ═══════════════════════════════════════════════════════════════
  // Capability Resolution
  // ═══════════════════════════════════════════════════════════════

  /**
   * resolveCapability — Find the best agent for a capability
   *
   * Uses the agent pool to find the highest-ranked available agent
   * that matches the requested capability. Results are cached.
   *
   * @param capability - Required capability
   * @returns Capability resolution with selected agent
   */
  resolveCapability(capability: string): CapabilityResolution {
    // Check cache
    if (this.config.cacheEnabled) {
      const cached = this.capabilityCache.get(capability);
      const timestamp = this.cacheTimestamps.get(capability) ?? 0;
      if (cached && (Date.now() - timestamp) < this.config.cacheTTLMs) {
        return cached;
      }
    }

    // Find matching agents
    const matchingAgents = [...this.agentPool.values()]
      .filter(a =>
        a.status === 'available' && a.capabilities.includes(capability)
      )
      .sort((a, b) => {
        // Score: reliability / cost
        const scoreA = a.reliabilityScore / (1 + a.costPerTask);
        const scoreB = b.reliabilityScore / (1 + b.costPerTask);
        return scoreB - scoreA;
      });

    const resolution: CapabilityResolution = {
      capability,
      resolved: matchingAgents.length > 0,
      agents: matchingAgents,
      selectedAgent: matchingAgents[0],
      fallbackAgent: matchingAgents.length > 1 ? matchingAgents[1] : undefined,
    };

    // Cache result
    if (this.config.cacheEnabled) {
      this.capabilityCache.set(capability, resolution);
      this.cacheTimestamps.set(capability, Date.now());
    }

    return resolution;
  }

  /**
   * resolveMultipleCapabilities — Resolve multiple capabilities at once
   *
   * @param capabilities - Array of required capabilities
   * @returns Array of capability resolutions
   */
  resolveMultipleCapabilities(capabilities: string[]): CapabilityResolution[] {
    return capabilities.map(cap => this.resolveCapability(cap));
  }

  /**
   * findCoverage — Check if all required capabilities are covered
   *
   * @param requiredCapabilities - Required capabilities
   * @returns Coverage report
   */
  findCoverage(requiredCapabilities: string[]): {
    covered: string[];
    uncovered: string[];
    coverageRatio: number;
  } {
    const covered: string[] = [];
    const uncovered: string[] = [];

    for (const cap of requiredCapabilities) {
      const resolution = this.resolveCapability(cap);
      if (resolution.resolved) {
        covered.push(cap);
      } else {
        uncovered.push(cap);
      }
    }

    return {
      covered,
      uncovered,
      coverageRatio: requiredCapabilities.length > 0
        ? covered.length / requiredCapabilities.length
        : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Action Execution
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — Execute an action through the fabric
   *
   * Flow:
   * 1. Resolve capability (find agent)
   * 2. Route to connector
   * 3. Execute with retry logic
   * 4. Return result
   *
   * @param capability - Required capability for this action
   * @param connectorAction - Connector action to execute
   * @param params - Action parameters
   * @param options - Optional execution options
   * @returns Action result
   */
  async execute(
    capability: string,
    connectorAction: string,
    params: Record<string, unknown>,
    options?: {
      timeout?: number;
      agentId?: string;
      executionId?: string;
    }
  ): Promise<ActionResult> {
    // 1. Resolve capability (unless specific agent requested)
    if (!options?.agentId) {
      const resolution = this.resolveCapability(capability);
      if (!resolution.resolved) {
        return {
          success: false,
          error: `No available agent with capability: ${capability}`,
          duration: 0,
        };
      }

      // Mark agent as busy
      if (resolution.selectedAgent) {
        this.setAgentStatus(resolution.selectedAgent.agentId, 'busy');
      }
    }

    // 2. Execute via connector registry
    const request: ActionRequest = {
      action: connectorAction,
      params,
      executionId: options?.executionId,
      timeout: options?.timeout ?? this.config.defaultTimeoutMs,
    };

    let lastError: string | undefined;
    const maxAttempts = this.config.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.connectorRegistry.execute(request);

      if (result.success) {
        // Mark agent as available again
        if (!options?.agentId && this.agentPool.size > 0) {
          // Set the first available agent back to available
          for (const [id, agent] of this.agentPool) {
            if (agent.status === 'busy') {
              agent.status = 'available';
              break;
            }
          }
        }
        return result;
      }

      lastError = result.error;

      if (attempt < maxAttempts) {
        // Wait before retry (exponential backoff)
        await this.delay(attempt * 1000);
      }
    }

    // All retries failed
    if (!options?.agentId && this.agentPool.size > 0) {
      for (const agent of this.agentPool.values()) {
        if (agent.status === 'busy') {
          agent.status = 'available';
          break;
        }
      }
    }

    return {
      success: false,
      error: `Execution failed after ${maxAttempts} attempts: ${lastError}`,
      duration: 0,
    };
  }

  /**
   * executePipeline — Execute a pipeline of actions
   *
   * Each step specifies the capability and action needed.
   * Steps are executed in sequence, with data flowing between them.
   *
   * @param pipeline - Array of pipeline steps
   * @param initialContext - Initial context data
   * @returns Array of results and final context
   */
  async executePipeline(
    pipeline: Array<{
      stepId: string;
      capability: string;
      action: string;
      params: Record<string, unknown>;
      dependsOn?: string[];
    }>,
    initialContext?: Record<string, unknown>
  ): Promise<{
    results: Map<string, ActionResult>;
    context: Record<string, unknown>;
    failed: boolean;
  }> {
    const results = new Map<string, ActionResult>();
    let context: Record<string, unknown> = { ...initialContext };

    for (const step of pipeline) {
      // Check dependencies
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          const depResult = results.get(dep);
          if (!depResult?.success) {
            return {
              results,
              context,
              failed: true,
            };
          }
          // Pass dependency data to context
          context[`${dep}_output`] = depResult.data;
        }
      }

      // Execute step
      const result = await this.execute(
        step.capability,
        step.action,
        { ...step.params, ...context },
        { executionId: step.stepId }
      );

      results.set(step.stepId, result);

      if (!result.success) {
        return { results, context, failed: true };
      }

      // Pass output to context
      context[`${step.stepId}_output`] = result.data;
    }

    return { results, context, failed: false };
  }

  // ═══════════════════════════════════════════════════════════════
  // Metrics & Status
  // ═══════════════════════════════════════════════════════════════

  /**
   * getFabricStatus — Get overall fabric status
   */
  getFabricStatus(): {
    totalAgents: number;
    availableAgents: number;
    busyAgents: number;
    offlineAgents: number;
    totalCapabilities: number;
    cacheSize: number;
  } {
    const agents = [...this.agentPool.values()];
    return {
      totalAgents: agents.length,
      availableAgents: agents.filter(a => a.status === 'available').length,
      busyAgents: agents.filter(a => a.status === 'busy').length,
      offlineAgents: agents.filter(a => a.status === 'offline').length,
      totalCapabilities: this.getPoolCapabilities().length,
      cacheSize: this.capabilityCache.size,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  private invalidateCache(): void {
    this.capabilityCache.clear();
    this.cacheTimestamps.clear();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
