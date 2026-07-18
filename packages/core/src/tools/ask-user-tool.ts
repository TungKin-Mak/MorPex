/**
 * ask-user-tool — 向用户提问的 AgentTool
 * options 必填，前端渲染为可点击按钮。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { AgentTool } from '../adapters/pi-types.js';

export type AskUserHandler = (question: string, harnessId: string, options?: string[]) => Promise<string>;

export function createAskUserTool(handler: AskUserHandler, harnessId: string): AgentTool {
  return {
    name: 'ask_user',
    label: '向用户提问',
    description:
      `当你需要用户做出选择或提供信息时，必须调用此工具。` +
      `options 参数必须提供 3-6 个选项，前端渲染为可点击按钮。` +
      `用户可从按钮选择，也可在输入框自由输入。`,
    parameters: Type.Object({
      question: Type.String({ description: '问题' }),
      options: Type.Array(Type.String(), { description: '必须提供的选项，如 ["企业官网","个人博客","电商平台"]' }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { question, options } = params as { question: string; options: string[] };
      console.log(`[ask_user] 调用: question="${question}", options=${JSON.stringify(options)}`);
      const reply = await handler(question, harnessId, options);
      return {
        content: [{ type: 'text' as const, text: `用户选择: ${reply}` }],
        details: { userReply: reply },
      };
    },
  };
}
