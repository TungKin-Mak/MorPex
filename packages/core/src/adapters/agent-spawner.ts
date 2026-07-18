/**
 * AgentSpawnerAdapter — isolates pi-agent-core AgentHarness/InMemorySessionRepo/NodeExecutionEnv
 *
 * Only file that directly imports pi-agent-core for agent creation.
 * If pi-agent-core changes these exports, only this file needs updating.
 *
 * Uses ModelResolver for type-safe model resolution (no `as any`).
 */

import { AgentHarness, InMemorySessionRepo } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { resolveModel } from './model-resolver.js';

export type { AgentTool };

export interface SpawnParams {
  identityToken: string;
  ring: number;
  tools: AgentTool[];
  systemPrompt: string;
  provider?: string;
  modelId?: string;
  domainId?: string;
}

export const agentSpawner = {
  createEnv(): NodeExecutionEnv {
    return new NodeExecutionEnv({ cwd: process.cwd() });
  },

  async spawn(params: SpawnParams): Promise<AgentHarness> {
    const provider = params.provider ?? 'deepseek';
    const modelId = params.modelId ?? 'deepseek-v4-flash';

    const model = resolveModel(provider, modelId);

    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const repo = new InMemorySessionRepo();
    const session = await repo.create({
      id: `agent_${params.ring}_${params.domainId ?? 'generic'}_${Date.now()}`,
    });

    const harness = new AgentHarness({
      env,
      model,
      session,
      tools: params.tools,
      systemPrompt: params.systemPrompt,
    });

    return harness;
  },
};
