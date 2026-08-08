/**
 * 通用空参保险测试（会话 16l·7）
 *
 * 验证模型无关的空参保险：任意 LLM 传空参时，prepareArguments 在 schema 校验前
 * 注入可推断值（knowledge→goal），使工具调用正常执行（而非校验抛错）。
 *
 * 覆盖：
 *   1. createPrimitiveAgentTools 生成的工具含 prepareArguments
 *   2. mapToolForAgent 透传 prepareArguments
 *   3. PiBridge 映射层透传 prepareArguments
 *   4. 完整链路：空参 → prepareArguments 注入 goal → validate 通过（不抛错）
 */

import { describe, it, expect } from 'vitest';
import { mapToolForAgent } from '../src/infrastructure/adapters/agent-spawner.js';

// 模拟 createPrimitiveAgentTools 的保险逻辑（真实实现已挂 prepareArguments）
function makeKnowledgeTool() {
  return {
    name: 'knowledge',
    label: 'knowledge_query',
    description: '查询知识库',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
    },
    prepareArguments: (rawArgs: unknown) => {
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      if (!args.query && 'step goal') args.query = '目标：生成电商报告';
      return args;
    },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
  };
}

describe('通用空参保险（P0 根治·会话 16l·7）', () => {
  it('mapToolForAgent 透传 prepareArguments', () => {
    const tool = makeKnowledgeTool();
    const mapped = mapToolForAgent(tool as never);
    expect(typeof (mapped as { prepareArguments?: unknown }).prepareArguments).toBe('function');
  });

  it('prepareArguments 在空参时注入 goal（模型无关兜底）', () => {
    const tool = makeKnowledgeTool();
    const mapped = mapToolForAgent(tool as never) as { prepareArguments?: (a: unknown) => unknown };
    // 模拟 LLM 传空 query
    const prepared = mapped.prepareArguments!({ query: '' });
    expect((prepared as Record<string, unknown>).query).toBe('目标：生成电商报告');
  });

  it('非空参数不被覆盖（prepareArguments 不误伤正常调用）', () => {
    const tool = makeKnowledgeTool();
    const mapped = mapToolForAgent(tool as never) as { prepareArguments?: (a: unknown) => unknown };
    const prepared = mapped.prepareArguments!({ query: '查询电商价格' });
    expect((prepared as Record<string, unknown>).query).toBe('查询电商价格');
  });

  it('完整链路：空参 → 注入 → 校验通过（不抛 validate 错误）', async () => {
    // 模拟 pi-agent-core 的 prepareToolCallArguments + validateToolArguments 顺序
    const tool = makeKnowledgeTool();
    const mapped = mapToolForAgent(tool as never) as { prepareArguments?: (a: unknown) => unknown; parameters: unknown };

    // 1. prepareToolCallArguments：调 prepareArguments
    const preparedArgs = mapped.prepareArguments!({ query: '' });

    // 2. validateToolArguments：校验（空参已被注入 goal → 通过）
    const { validateToolArguments } = await import('@earendil-works/pi-ai');
    const validated = validateToolArguments(
      { name: 'knowledge', parameters: mapped.parameters },
      { name: 'knowledge', arguments: preparedArgs },
    );
    expect(validated.query).toBe('目标：生成电商报告'); // 校验通过且已填参
  });
});
