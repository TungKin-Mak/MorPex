/**
 * DomainClusterAdapter — isolates pi-agent-core AgentHarness / InMemorySessionRepo / NodeExecutionEnv
 *
 * All pi-agent-core dependencies go through PiBridge static methods.
 * Types are re-exported from pi-utils.ts (which also goes through PiBridge).
 */

import type { AgentTool, AgentHarness } from './pi-bridge/index.js';
import { PiBridge } from './pi-bridge/index.js';
import { resolveModel } from './model-resolver.js';

export type { AgentTool };
export type { AgentHarness };
export type InMemorySessionRepo = InstanceType<typeof PiBridge.SessionRepoClass>;

export { resolveModel };

export function createInMemorySessionRepo(): InMemorySessionRepo {
  return PiBridge.createSessionRepo() as unknown as InMemorySessionRepo;
}

export function createNodeExecutionEnv(cwd?: string) {
  return PiBridge.createNodeEnv(cwd);
}

export function createAgentHarness(params: {
  env: ReturnType<typeof PiBridge.createNodeEnv>;
  model: Record<string, unknown>;
  session: { id: string };
  tools: AgentTool[];
  systemPrompt: string;
}) {
  return new (PiBridge.AgentHarnessClass as any)({
    env: params.env,
    model: params.model,
    session: params.session,
    tools: params.tools,
    systemPrompt: params.systemPrompt,
  }) as AgentHarness;
}
