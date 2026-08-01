/**
 * AgentSpawnerAdapter — Agent 创建工厂
 *
 * 通过 PiBridge 隔离 pi-agent-core 依赖。
 * PiBridge 是唯一直接导入 pi-agent-core 的文件。
 */

import type { AgentTool } from './pi-bridge/index.js';
import { PiBridge } from './pi-bridge/index.js';

export type { AgentTool } from './pi-bridge/index.js';

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
  async spawn(params: SpawnParams): Promise<{
    prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    abort: () => Promise<void>;
  }> {
    const bridge = new PiBridge(
      `${params.provider ?? 'deepseek'}/${params.modelId ?? 'deepseek-v4-flash'}`,
    );

    return bridge.createAgentHarness({
      tools: params.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? {},
      })),
      systemPrompt: params.systemPrompt,
      model: `${params.provider ?? 'deepseek'}/${params.modelId ?? 'deepseek-v4-flash'}`,
      sessionId: `agent_${params.ring}_${params.domainId ?? 'generic'}_${Date.now()}`,
    });
  },
};
