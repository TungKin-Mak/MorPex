/**
 * APICallPrimitive — API 调用原语
 *
 * 通用的 HTTP API 调用操作，通过 ConnectorRegistry 执行。
 * 不包含任何领域逻辑——纯粹的基础设施能力。
 *
 * @packageDocumentation
 */

import type { ActionPrimitive, ActionResult, APICallRequest } from './types.js';
import { PrimitiveGate } from './gateBinding.js';
import type { KnowledgeContextPackage } from '../../../gate/context.js';

// ── APICallPrimitive ──

export class APICallPrimitive implements ActionPrimitive {
  name = 'api_call';
  description = '通用的 HTTP API 调用（GET/POST/PUT/DELETE/PATCH）。通过 ConnectorRegistry 执行，支持超时和自定义请求头。';
  inputSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        description: 'HTTP 方法',
      },
      headers: {
        type: 'object',
        description: '自定义请求头（可选）',
        additionalProperties: { type: 'string' },
      },
      body: { description: '请求体（可选，对象或字符串）' },
      timeout: { type: 'number', description: '超时毫秒（默认 30000）' },
    },
    required: ['url', 'method'],
  };

  /** 已注入的 HTTP 执行器 */
  private static httpExecutor: ((params: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
    deptId: string;
  }) => Promise<ActionResult>) | null = null;

  /**
   * setHttpExecutor — 注入 HTTP 执行器
   */
  static setHttpExecutor(
    exec: (params: {
      url: string;
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
      timeout?: number;
      deptId: string;
    }) => Promise<ActionResult>
  ): void {
    APICallPrimitive.httpExecutor = exec;
  }

  canHandle(task: string): number {
    const lower = task.toLowerCase();
    if (/api|接口|http|请求|调用.*(api|接口)|curl|fetch|get|post|rest/.test(lower)) {
      return 0.95;
    }
    if (/同步|上传|下载|sync|upload|download|pull|push/.test(lower)) {
      return 0.7;
    }
    return 0;
  }

  async execute(
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string; gateContext?: KnowledgeContextPackage }
  ): Promise<ActionResult> {
    const deptId = context?.departmentId || 'global';
    const url = params.url as string;
    const method = (params.method as string)?.toUpperCase() || 'GET';
    const headers = params.headers as Record<string, string> | undefined;
    const body = params.body;
    const timeout = (params.timeout as number) || 30000;

    if (!url) {
      return { success: false, error: 'APICallPrimitive: url 不能为空' };
    }

    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return { success: false, error: `APICallPrimitive: 不支持的 HTTP 方法 "${method}"` };
    }

    // Wave 4：Gate 绑定 — 副作用方法（非 GET/HEAD）必须持有 KnowledgeContextPackage，缺失直接抛错
    const readonlyMethod = method === 'GET' || method === 'HEAD';
    if (readonlyMethod) {
      PrimitiveGate.gateReadonly(`APICallPrimitive ${method} ${url}`, context?.gateContext);
    } else {
      PrimitiveGate.gateDestructive(`APICallPrimitive ${method} ${url}`, context?.gateContext);
    }

    if (!APICallPrimitive.httpExecutor) {
      return { success: false, error: 'APICallPrimitive: HTTP 执行器未注入' };
    }

    try {
      const result = await APICallPrimitive.httpExecutor({
        url,
        method,
        headers,
        body,
        timeout,
        deptId,
      });

      console.log(`[APICallPrimitive] 🌐 ${method} ${url} (部门: ${deptId}) → ${result.success ? '✅' : '❌'}`);
      return result;
    } catch (err) {
      return { success: false, error: `APICallPrimitive: ${method} ${url} 失败: ${(err as Error).message}` };
    }
  }
}
