/**
 * DomainClusterAdapter — isolates pi-agent-core AgentHarness / InMemorySessionRepo / NodeExecutionEnv
 * for DomainCluster's sub-agent spawning.
 *
 * Only file that directly imports pi-agent-core for DomainCluster-specific agent creation.
 * Uses ModelResolver for type-safe model resolution (no `as any` for getModel).
 */

import { AgentHarness, InMemorySessionRepo } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';
import { resolveModel } from './model-resolver.js';

export type { AgentTool };
export type { AgentHarness, InMemorySessionRepo };

export function createInMemorySessionRepo(): InMemorySessionRepo {
  return new InMemorySessionRepo();
}

export function createNodeExecutionEnv(cwd?: string): NodeExecutionEnv {
  return new NodeExecutionEnv({ cwd: cwd ?? process.cwd() });
}

export { resolveModel };

/**
 * Create an AgentHarness with validated parameters.
 *
 * @param env     - Node execution environment
 * @param model   - Resolved pi-ai Model (from resolveModel)
 * @param session - Session from InMemorySessionRepo.create()
 * @param tools   - Agent tools
 * @param systemPrompt - System prompt string
 */
export function createAgentHarness(params: {
  env: NodeExecutionEnv;
  model: Model<Api>;
  session: Awaited<ReturnType<InMemorySessionRepo['create']>>;
  tools: AgentTool[];
  systemPrompt: string;
}): AgentHarness {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (AgentHarness as any)({
    env: params.env,
    model: params.model,
    session: params.session,
    tools: params.tools,
    systemPrompt: params.systemPrompt,
  }) as AgentHarness;
}
