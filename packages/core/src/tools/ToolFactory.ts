import { EventBus } from '../common/EventBus.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { ToolSchema, RegisteredTool } from './ToolRegistry.js';

// ── Types ──

export interface ToolGenContext {
  departmentId?: string;
  capabilities?: string[];
  existingTools?: string[];
}

// ── ToolFactory ──

export class ToolFactory {
  private eventBus: EventBus;
  private llmCaller: { generateText: (opts: { prompt: string; maxTokens?: number; temperature?: number }) => Promise<{ text: string }> } | null = null;

  private static readonly PRESET_TEMPLATES: Record<string, { schema: ToolSchema; code: string }> = {
    web_search: {
      schema: {
        name: 'web_search',
        description: '搜索互联网获取最新信息',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            maxResults: { type: 'number', description: '最大返回条数' },
          },
          required: ['query'],
        },
        category: 'research',
      },
      code: `export async function web_search(params: { query: string; maxResults?: number }) {
  return { results: [], total: 0, query: params.query };
}`,
    },
    api_call: {
      schema: {
        name: 'api_call',
        description: '调用外部 HTTP API',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'API URL' },
            method: { type: 'string', description: 'HTTP 方法' },
            body: { type: 'string', description: '请求体' },
          },
          required: ['url', 'method'],
        },
        category: 'integration',
      },
      code: `export async function api_call(params: { url: string; method: string; body?: string }) {
  return { status: 200, data: {} };
}`,
    },
    code_execute: {
      schema: {
        name: 'code_execute',
        description: '执行代码片段',
        parameters: {
          type: 'object',
          properties: {
            language: { type: 'string', description: '编程语言' },
            code: { type: 'string', description: '代码内容' },
            timeout: { type: 'number', description: '超时(ms)' },
          },
          required: ['language', 'code'],
        },
        category: 'development',
      },
      code: `export async function code_execute(params: { language: string; code: string; timeout?: number }) {
  return { stdout: '', stderr: '', exitCode: 0 };
}`,
    },
  };

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[ToolFactory] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setLLMCaller(caller: { generateText: (opts: { prompt: string; maxTokens?: number; temperature?: number }) => Promise<{ text: string }> }): void {
    this.llmCaller = caller;
  }

  async generateToolForTask(taskDesc: string, context?: ToolGenContext): Promise<ToolSchema & { toolId: string }> {
    const preset = this.matchPreset(taskDesc);
    if (preset) {
      const toolId = await ToolRegistry.register(preset.schema, preset.code);
      return { ...preset.schema, toolId };
    }

    if (this.llmCaller) {
      try {
        const schema = await this.llmGenerate(taskDesc);
        const codeTemplate = this.generateCodeImpl(schema);
        const toolId = await ToolRegistry.register(schema, codeTemplate);
        return { ...schema, toolId };
      } catch (err) {
        console.warn('[ToolFactory] LLM 生成失败，使用默认模板:', (err as Error).message);
      }
    }

    const fallbackSchema: ToolSchema = {
      name: 'generic_tool',
      description: taskDesc.substring(0, 100),
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: '任务输入' },
        },
        required: ['input'],
      },
      category: 'general',
    };
    const toolId = await ToolRegistry.register(fallbackSchema, this.generateCodeImpl(fallbackSchema));
    return { ...fallbackSchema, toolId };
  }

  private matchPreset(taskDesc: string): { schema: ToolSchema; code: string } | null {
    const lower = taskDesc.toLowerCase();
    if (lower.includes('搜索') || lower.includes('search') || lower.includes('互联网')) {
      return ToolFactory.PRESET_TEMPLATES.web_search;
    }
    if (lower.includes('api') || lower.includes('接口') || lower.includes('调用') || lower.includes('请求')) {
      return ToolFactory.PRESET_TEMPLATES.api_call;
    }
    if (lower.includes('代码') || lower.includes('执行') || lower.includes('code') || lower.includes('run')) {
      return ToolFactory.PRESET_TEMPLATES.code_execute;
    }
    return null;
  }

  private async llmGenerate(taskDesc: string): Promise<ToolSchema> {
    const prompt = `根据以下任务描述，生成一个 OpenAI function calling 格式的 tool schema。

任务: "${taskDesc}"

返回 JSON 格式:
{
  "name": "工具名(英文小写蛇形)",
  "description": "工具描述(中文)",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": { "type": "string", "description": "参数说明" }
    },
    "required": ["param1"]
  },
  "category": "research|development|integration|general"
}

只返回 JSON，不要其他内容。`;

    try {
      const response = await this.llmCaller!.generateText({ prompt, maxTokens: 500, temperature: 0.2 });
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ToolSchema;
      }
    } catch {
      // 降级
    }

    throw new Error('LLM 生成 tool schema 失败');
  }

  private generateCodeImpl(schema: ToolSchema): string {
    const params = Object.entries(schema.parameters.properties)
      .map(([name, info]) => `${name}: ${(info as { type: string }).type}`)
      .join(', ');

    return `export async function ${schema.name}(params: { ${params} }) {
  // Auto-generated by ToolFactory
  console.warn('[ToolFactory] 自动生成工具，需实现真实逻辑');
  return { success: true, data: null };
}`;
  }

  async generateAndRegister(taskDesc: string, context?: ToolGenContext): Promise<RegisteredTool> {
    const result = await this.generateToolForTask(taskDesc, context);
    const registered = ToolRegistry.get(result.toolId);
    if (!registered) throw new Error('[ToolFactory] 工具注册后未找到');
    return registered;
  }
}
