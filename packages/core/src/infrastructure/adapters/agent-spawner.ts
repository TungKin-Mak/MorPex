/**
 * AgentSpawnerAdapter — Agent 创建工厂
 *
 * 通过 PiBridge 隔离 pi-agent-core 依赖。
 * PiBridge 是唯一直接导入 pi-agent-core 的文件。
 *
 * ═══ 会话 3 修复（多 Agent 框架 P0）═══
 * - 未指定 provider/modelId 时不传 model → PiBridge 构造器按 config/morpex.yaml
 *   网关解析默认模型（此前硬编码 'deepseek/deepseek-v4-flash'，网关启用时
 *   该模型不在注册表 → getModel 返回空 → model.provider=undefined →
 *   "Unknown provider: undefined" → step-agent 空转）。
 * - 透传 execute：step-agent 执行肢的工具必须真正可调用（此前被丢弃）。
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
    // 未指定时让 PiBridge 构造器解析默认模型（网关启用 → 网关模型；否则 deepseek）
    const bridge = new PiBridge(
      params.provider && params.modelId
        ? `${params.provider}/${params.modelId}`
        : undefined,
    );

    const config: {
      tools: Array<{ name: string; description: string; parameters: Record<string, unknown>; execute?: (p: Record<string, unknown>) => Promise<unknown> }>;
      systemPrompt: string;
      model?: string;
      sessionId: string;
    } = {
      tools: params.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? {},
        // ⬅️ 会话 3：透传 execute——step-agent 执行肢的工具必须真正可调用（此前被丢弃）
        // 适配签名：AgentTool.execute(toolCallId, params, signal, onUpdate) → AgentToolDescriptor.execute(params)
        execute: t.execute
          ? async (p: Record<string, unknown>) => {
              return (t.execute as unknown as (params: Record<string, unknown>) => Promise<unknown>)(p);
            }
          : undefined,
      })),
      systemPrompt: params.systemPrompt,
      sessionId: `agent_${params.ring}_${params.domainId ?? 'generic'}_${Date.now()}`,
    };
    if (params.provider && params.modelId) {
      config.model = `${params.provider}/${params.modelId}`;
    }

    return bridge.createAgentHarness(config);
  },
};
