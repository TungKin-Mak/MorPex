/**
 * TeamSayTool — 领域间通信工具
 *
 * 向指定 Agent 发送消息（UDP 语义，非阻塞）。
 * 目标 Agent 当前 turn 完成后自动消费消息。
 *
 * 使用 pi-agent-core harness.steer() 实现。
 * steer() 注入 steering 消息，异步非阻塞。
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 类型基于 pi-agent-core 扩展
 *   0.4 (删除优先法则): 使用 pi 原生 steer() 而非自定义通信
 */

import type { AgentTool, AgentToolResult } from '../adapters/pi-types.js';
import { Type } from '../adapters/pi-ai-types.js';

/** Agent 注册表 — 用于查找目标 Agent 的 AgentHarness */
export type AgentRegistry = Map<string, any>; // AgentHarness 简化为 any 避免循环依赖

/**
 * TeamSayTool — 团队通信工具
 *
 * 用法：
 *   const tool = new TeamSayTool(registry, 'senderDomain');
 *   // 注册到 AgentHarness 的工具列表
 */
export class TeamSayTool implements AgentTool {
  name = 'TeamSay';
  label = '团队通信';
  description = '向指定 Agent 发送消息。目标 Agent 在当前任务完成后自动接收。';

  parameters = Type.Object({
    to: Type.String({ description: '目标 Agent 名称或领域 ID' }),
    message: Type.String({ description: '消息内容' }),
  });

  private registry: AgentRegistry;
  private senderName: string;

  constructor(registry: AgentRegistry, senderName: string) {
    this.registry = registry;
    this.senderName = senderName;
  }

  async execute(
    toolCallId: string,
    params: unknown,
    _signal?: AbortSignal,
    _onUpdate?: any,
  ): Promise<AgentToolResult<any>> {
    const { to, message } = (params || {}) as { to: string; message: string };

    // 查找目标 Agent
    const targetHarness = this.registry.get(to);

    if (!targetHarness) {
      // AgentTool 契约：错误通过 throw 传递（详见 pi-agent-core 类型注释）
      throw new Error(`未找到目标 Agent: "${to}"`);
    }

    try {
      await targetHarness.steer(`[来自 ${this.senderName}]: ${message}`);

      return {
        content: [{ type: 'text' as const, text: `消息已发送至 ${to}` }],
        details: {
          to,
          sender: this.senderName,
          timestamp: Date.now(),
        },
      };
    } catch (err: any) {
      throw new Error(`发送消息到 ${to} 失败: ${err.message}`);
    }
  }
}

/**
 * createTeamSayTool — TeamSay 工厂函数
 */
export function createTeamSayTool(
  registry: AgentRegistry,
  senderName: string,
): TeamSayTool {
  return new TeamSayTool(registry, senderName);
}
