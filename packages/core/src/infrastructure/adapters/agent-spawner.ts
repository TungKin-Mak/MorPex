/**
 * AgentSpawnerAdapter — Agent 创建工厂
 *
 * 通过 PiBridge 隔离 pi-agent-core 依赖。
 * PiBridge 是唯一直接导入 pi-agent-core 的文件。
 *
 * ═══ 会话 3 修复（多 Agent 框架 P0）═══
 * - 未指定 provider/modelId 时不传 model → PiBridge 构造器按 config/morpex.yaml
 *   网关解析默认模型（网关启用 → 网关模型；否则 GLM-4.7-Flash 默认），
 *   此前硬编码默认模型在网关启用时不在注册表 → getModel 返回空 → model.provider=undefined →
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
  /**
   * 会话 4（Session 化）：注入的持久化 Session（JsonlSessionRepo 创建）。
   * 提供时 agent 对话/工具调用自动写入该会话；否则默认内存会话。
   */
  session?: unknown;
  /**
   * 会话 15（工具可靠性 P0）：工具执行前钩子（透传到 pi-agent-core AgentHarness）。
   * 用于空参拦截强制重发 / knowledge query 空时用 step goal 兜底。
   */
  beforeToolCall?: (params: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<{ block?: boolean; reason?: string } | undefined> | { block?: boolean; reason?: string } | undefined;
}

/**
 * mapToolForAgent — 将 AgentTool（pi-agent-core 契约）映射为 AgentToolDescriptor
 *
 * ⚠️ 会话 4 审查修复：AgentTool.execute 签名是 (toolCallId, params, signal?, onUpdate?)，
 * 此前适配器单参调用 `t.execute(p)` → p 落到 toolCallId、params=undefined →
 * step-agent 的工具调用参数全部被丢弃（原语以空参执行，e2e 成功是假阳性）。
 * 修复：显式双参调用，toolCallId 用空串（PiBridge 包装层不消费它）。
 */
export function mapToolForAgent(t: AgentTool): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute?: (p: Record<string, unknown>) => Promise<unknown>;
} {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? {},
    execute: t.execute
      ? async (p: Record<string, unknown>) => {
          // 保留原契约参数：toolCallId 由执行框架生成，此处不消费，传空串占位
          return (t.execute as unknown as (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>)('', p);
        }
      : undefined,
  };
}

export const agentSpawner = {
  async spawn(params: SpawnParams): Promise<{
    prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    abort: () => Promise<void>;
  }> {
    // 未指定时让 PiBridge 构造器解析默认模型（网关启用 → 网关模型；否则 GLM-4.7-Flash）
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
      tools: params.tools.map(mapToolForAgent),
      systemPrompt: params.systemPrompt,
      sessionId: `agent_${params.ring}_${params.domainId ?? 'generic'}_${Date.now()}`,
    };
    if (params.provider && params.modelId) {
      config.model = `${params.provider}/${params.modelId}`;
    }
    // ⬅️ Session 化：透传持久化会话（AgentHarness 自动把对话写入注入 session）
    if (params.session) {
      (config as { session?: unknown }).session = params.session;
    }
    // ⬅️ 会话 15（工具可靠性 P0）：透传工具执行前钩子（空参拦截/知识 goal 兜底）
    if (params.beforeToolCall) {
      (config as { beforeToolCall?: typeof params.beforeToolCall }).beforeToolCall = params.beforeToolCall;
    }

    return bridge.createAgentHarness(config);
  },
};
