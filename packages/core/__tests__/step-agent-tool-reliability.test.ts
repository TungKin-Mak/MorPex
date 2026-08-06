/**
 * 工具可靠性 P0（会话 15）测试 —— 工具空参根治
 *
 * 覆盖：
 *   1. createPrimitiveBeforeToolCall：
 *      - knowledge query 空 → 用 step goal 兜底注入（不 block）
 *      - shell/api/file 必填空参 → block + 精确重发指令（含工具专属示例）
 *      - 完整参数 → 放行
 *   2. 工具 schema 强化（enrichSchemaForTool）：
 *      - 顶层 additionalProperties: false
 *      - 必填自由文本参数 minLength: 1（空串在 TypeBox 校验层即被拒）
 *      - 必填参数 examples（LLM 格式提示）
 *      - knowledge query 不设 minLength（保留 goal 兜底注入路径）
 *
 * 链路：createPrimitiveBeforeToolCall / createPrimitiveAgentTools 为纯函数层，
 * 不触发 LLM / pi-agent-core；beforeToolCall 在 PiBridge → agent-spawner → StepAgentExecutor
 * 为薄直传（见 step-agent-gate.test.ts 同类直传验证模式）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomainPrimitiveRegistry } from '../src/infrastructure/tools/DomainPrimitiveRegistry.js';
import type { ActionPrimitive } from '../src/infrastructure/tools/primitives/types.js';
import {
  createPrimitiveBeforeToolCall,
  createPrimitiveAgentTools,
} from '../src/infrastructure/tools/primitiveAgentTools.js';

// ── 注册最小原语集（真实注册表，覆盖 5 个通用原语）──

const PRIMITIVES: Array<Partial<ActionPrimitive> & { name: string }> = [
  {
    name: 'knowledge_query',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '自然语言查询内容' } },
      required: ['query'],
    },
  },
  {
    name: 'shell_execution',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: '要执行的命令' } },
      required: ['command'],
    },
  },
  {
    name: 'api_call',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '请求 URL' },
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP 方法' },
      },
      required: ['url', 'method'],
    },
  },
];

beforeEach(() => {
  for (const p of PRIMITIVES) {
    DomainPrimitiveRegistry.unregister(p.name);
    DomainPrimitiveRegistry.register({
      name: p.name,
      description: `${p.name}（测试 mock）`,
      canHandle: () => 0,
      execute: async () => ({ success: true, data: { ok: true } }),
      ...p,
    } as ActionPrimitive);
  }
});

describe('createPrimitiveBeforeToolCall — 空参拦截 + goal 兜底', () => {
  it('knowledge query 为空 + 有 goal → 注入 goal 并放行（不 block）', async () => {
    const hook = createPrimitiveBeforeToolCall({ goal: '查询公司技术栈' });
    const args: Record<string, unknown> = { query: '' };
    const result = await hook({ toolCallId: 'tc1', toolName: 'knowledge', args });
    expect(result).toBeUndefined();
    expect(args.query).toBe('查询公司技术栈');
  });

  it('knowledge query 为空 + 无 goal → block（返回精确缺失指令）', async () => {
    const hook = createPrimitiveBeforeToolCall({});
    const result = await hook({ toolCallId: 'tc1', toolName: 'knowledge', args: { query: '' } });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('query');
    expect(result?.reason).toContain('knowledge');
  });

  it('shell command 为空 → block + 重发指令含正确示例 JSON', async () => {
    const hook = createPrimitiveBeforeToolCall({});
    const result = await hook({ toolCallId: 'tc1', toolName: 'shell', args: { command: '   ' } });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('command');
    expect(result?.reason).toContain('"command"'); // 示例含 JSON 键
  });

  it('api url 为空 → block；method 缺省 → block', async () => {
    const hook = createPrimitiveBeforeToolCall({});
    const r1 = await hook({ toolCallId: 'tc1', toolName: 'api', args: { url: '', method: 'GET' } });
    expect(r1?.block).toBe(true);
    const r2 = await hook({ toolCallId: 'tc1', toolName: 'api', args: { url: 'https://x.com', method: undefined } });
    expect(r2?.block).toBe(true);
  });

  it('完整参数 → 放行（不 block）', async () => {
    const hook = createPrimitiveBeforeToolCall({});
    const r1 = await hook({ toolCallId: 'tc1', toolName: 'shell', args: { command: 'ls -la' } });
    expect(r1).toBeUndefined();
    const r2 = await hook({ toolCallId: 'tc1', toolName: 'api', args: { url: 'https://x.com', method: 'GET' } });
    expect(r2).toBeUndefined();
  });

  it('未注册工具名 → 放行（不误拦）', async () => {
    const hook = createPrimitiveBeforeToolCall({});
    const result = await hook({ toolCallId: 'tc1', toolName: 'unknown_tool', args: {} });
    expect(result).toBeUndefined();
  });
});

describe('工具 schema 强化（enrichSchemaForTool）', () => {
  it('顶层 additionalProperties: false + 必填参数 examples/minLength', () => {
    const tools = createPrimitiveAgentTools({});
    const shellTool = tools.find(t => t.name === 'shell')!;
    const params = shellTool.parameters as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { minLength?: number; examples?: unknown[] }>;
    };
    expect(params.additionalProperties).toBe(false);
    expect(params.required).toContain('command');
    expect(params.properties?.command?.minLength).toBe(1);
    expect(Array.isArray(params.properties?.command?.examples)).toBe(true);
  });

  it('knowledge query 保留 examples 但不设 minLength（goal 兜底路径不被 TypeBox 阻断）', () => {
    const tools = createPrimitiveAgentTools({});
    const knowledgeTool = tools.find(t => t.name === 'knowledge')!;
    const params = knowledgeTool.parameters as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { minLength?: number; examples?: unknown[] }>;
    };
    expect(params.additionalProperties).toBe(false);
    expect(params.required).toContain('query');
    expect(params.properties?.query?.minLength).toBeUndefined();
    expect(Array.isArray(params.properties?.query?.examples)).toBe(true);
    expect(params.properties?.query?.examples!.length).toBeGreaterThan(0);
  });

  it('api method（enum）不误加 minLength（枚举校验已覆盖空值）', () => {
    const tools = createPrimitiveAgentTools({});
    const apiTool = tools.find(t => t.name === 'api')!;
    const params = apiTool.parameters as {
      properties?: Record<string, { minLength?: number }>;
    };
    expect(params.properties?.method?.minLength).toBeUndefined();
  });
});

describe('recall_task 工具（B2 指针消费端）', () => {
  it('注入 recallTask → 暴露 recall_task 工具并按 taskRef 拉取详情', async () => {
    const tools = createPrimitiveAgentTools({
      recallTask: async (taskRef) => `目标: 618价格合规\n结果: success（质量分 0.9）`,
    });
    const recall = tools.find(t => t.name === 'recall_task');
    expect(recall).toBeDefined();
    const res = await recall!.execute('tc1', { taskRef: 'msn_x' });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain('618价格合规');
  });

  it('未注入 recallTask → 不暴露 recall_task（避免无效工具）', () => {
    const tools = createPrimitiveAgentTools({});
    expect(tools.find(t => t.name === 'recall_task')).toBeUndefined();
  });

  it('缺 taskRef → 精确重发指引；拉取失败 → 错误返回', async () => {
    const tools = createPrimitiveAgentTools({ recallTask: async () => null });
    const recall = tools.find(t => t.name === 'recall_task')!;
    const noRef = await recall.execute('tc1', {});
    expect(noRef.isError).toBe(true);
    expect(noRef.content[0].text).toContain('taskRef');
    const notFound = await recall.execute('tc1', { taskRef: 'nope' });
    expect(notFound.isError).toBe(true);
  });
});
