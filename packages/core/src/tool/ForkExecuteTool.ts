/**
 * ForkExecuteTool — 派生无状态执行肢（Fork）
 *
 * Expert (Ring 1) 通过此工具将高风险/高耗时任务下放到 Fork (Ring 2)
 * 执行。Fork 运行在隔离的 worker_threads 中，超时/内存超限自动 terminate。
 *
 * 底层调用 ToolExecutionProxy.execute()，使用已有的 worker_threads 隔离机制。
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 类型基于 pi-agent-core 扩展
 *   0.4 (删除优先法则): 使用已有的 ToolExecutionProxy，不重复实现 Worker 隔离
 */

import type { AgentTool, AgentToolResult } from '../adapters/pi-types.js';
import { Type } from '../adapters/pi-ai-types.js';
import { ToolExecutionProxy } from './ToolExecutionProxy.js';

/**
 * ForkExecuteTool — 派生无状态短命执行肢
 *
 * 用法：
 *   const proxy = new ToolExecutionProxy();
 *   const tool = new ForkExecuteTool(proxy);
 *   // 注册到 Expert Agent 的工具列表
 */
export class ForkExecuteTool implements AgentTool {
  name = 'ForkExecute';
  label = '派生执行肢';
  description = '派生无状态短命执行肢（Fork）执行高风险/高耗时任务。Fork 运行在隔离的 worker_threads 中，超时自动终止。Expert 只能通过此工具执行底层操作，严禁在主线程中执行物理操作。';

  parameters = Type.Object({
    script_type: Type.String({ description: '脚本类型: bash（执行 shell 命令）| javascript（执行 JS 代码）' }),
    payload: Type.String({ description: '执行负载内容（bash 脚本或 JavaScript 代码）' }),
    timeout_ms: Type.Optional(Type.Number({ description: '超时毫秒（默认 120000）' })),
  });

  private proxy: ToolExecutionProxy;

  constructor(proxy?: ToolExecutionProxy) {
    this.proxy = proxy ?? new ToolExecutionProxy();
  }

  async execute(
    toolCallId: string,
    params: unknown,
    _signal?: AbortSignal,
    onUpdate?: any,
  ): Promise<AgentToolResult<any>> {
    const { script_type, payload } = (params || {}) as {
      script_type: string;
      payload: string;
      timeout_ms?: number;
    };

    let result: any;

    if (script_type === 'bash') {
      result = await this.proxy.execute(
        toolCallId,
        'ForkExecute',
        { command: payload },
        process.cwd(),
        onUpdate ? (partial: any) => onUpdate(partial) : undefined,
      );
    } else if (script_type === 'javascript') {
      result = await this.proxy.execute(
        toolCallId,
        'ForkExecute',
        { code: payload },
        process.cwd(),
        onUpdate ? (partial: any) => onUpdate(partial) : undefined,
      );
    } else {
      throw new Error(`[ForkExecute] 不支持的脚本类型: "${script_type}"。仅支持 bash 和 javascript。`);
    }

    // 归一化结果：附加执行摘要
    const textContent = result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => (c as any).text)
      .join('');

    const summary = textContent.length > 500
      ? textContent.substring(0, 500) + `\n... [共 ${textContent.length} 字符，已截断]`
      : textContent;

    return {
      content: [{ type: 'text' as const, text: `[Fork 执行完毕]\n${summary}` }],
      details: {
        ...result.details,
        forked: true,
        script_type,
        payload_length: payload.length,
        result_length: textContent.length,
      },
    };
  }
}

/**
 * createForkExecuteTool — ForkExecuteTool 工厂函数
 */
export function createForkExecuteTool(proxy?: ToolExecutionProxy): ForkExecuteTool {
  return new ForkExecuteTool(proxy);
}
