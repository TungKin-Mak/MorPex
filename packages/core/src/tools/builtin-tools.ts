/**
 * builtin-tools — MorPex 内置 AgentTool 定义
 *
 * v3.x 重构：所有 pi 包直接依赖已隔离到适配层。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { Static, TSchema } from '../adapters/pi-ai-types.js';
import type { AgentTool, ExecutionEnv, AgentToolResult } from '../adapters/pi-types.js';

/** 文本内容辅助函数 */
function textContent(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text' as const, text }];
}

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

/** executionEnv 适配器：将 NodeExecutionEnv 适配为 BrowserExecutionEnv（禁用 shell 命令） */
export function createBrowserExecutionEnv(): ExecutionEnv {
  return {
    async exec(_command: string, _options?: any) {
      return { ok: true as const, value: { exitCode: 1, stdout: '', stderr: '[BrowserExecutionEnv] exec 已禁用' } };
    },
    async read(_path: string, _signal?: AbortSignal) {
      return { ok: true as const, value: { size: 0, content: '' } };
    },
    isFile() { return false; },
    isDirectory() { return false; },
    chdir() {},
    basename(path: string) { return path.split(/[/\\]/).pop() ?? path; },
    dirname(path: string) { return path.split(/[/\\]/).slice(0, -1).join('/') || '.'; },
    join(...segments: string[]) { return segments.join('/'); },
    relative(from: string, to: string) { return to; },
    resolve(...segments: string[]) { return segments.join('/'); },
    sep: '/',
    extname(path: string) { return path.includes('.') ? '.' + path.split('.').pop() : ''; },
    async listDir() { return []; },
    async exists() { return false; },
    async stat() { return { size: 0, mode: 0, createdAt: new Date(), modifiedAt: new Date() }; },
    async mkdir() {},
    async writeFile() {},
    async rm() {},
    realCwd() { return process.cwd(); },
    cwd: process.cwd(),
  } as unknown as ExecutionEnv;
}

// ════════════════════════════════════════════════════════════════
// Tool 定义
// ════════════════════════════════════════════════════════════════

/** 获取系统时间 */
export const getCurrentTimeTool: AgentTool = {
  name: 'getCurrentTime',
  description: '获取当前系统时间',
  parameters: Type.Object({}),
  label: '获取当前时间',
  execute: async (_toolCallId: string) => {
    const now = new Date();
    return {
      content: textContent(`当前时间：${now.toLocaleString('zh-CN')}`),
      details: { iso: now.toISOString() },
    };
  },
};

/** 运算器 */
export const calculatorTool: AgentTool = {
  name: 'calculator',
  description: '数学计算器（加减乘除、幂运算）',
  parameters: Type.Object({
    expression: Type.String({ description: '数学表达式，例如 "2 + 3 * 4"' }),
  }),
  label: '计算器',
  execute: async (_toolCallId: string, params: any) => {
    const expression = (params as { expression: string }).expression;
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().,%\s]/g, '');
      if (!sanitized.trim()) throw new Error('无效表达式');
      const result = new Function(`"use strict"; return (${sanitized})`)();
      return {
        content: textContent(`计算结果：${result}`),
        details: { expression, result },
      };
    } catch (err: any) {
      return {
        content: textContent(`计算失败：${err.message}`),
        details: { expression, error: err.message },
        isError: true,
      };
    }
  },
};

/** echo */
export const echoTool: AgentTool = {
  name: 'echo',
  description: '回显消息',
  parameters: Type.Object({
    message: Type.String({ description: '要回显的消息' }),
  }),
  label: '回显',
  execute: async (_toolCallId: string, params: any) => {
    const message = (params as { message: string }).message;
    return {
      content: textContent(message),
      details: { echoed: message },
    };
  },
};

/** 内置工具注册表 */
export const BUILTIN_TOOLS: AgentTool[] = [
  getCurrentTimeTool,
  calculatorTool,
  echoTool,
];
