/**
 * PiBridge — 稳定的 pi-ai + pi-agent-core 抽象层
 *
 * 隔离 @earendil-works/pi-ai 和 @earendil-works/pi-agent-core 的 API 变更。
 * 当底层包升级时，只需修改此文件。
 *
 * 内部使用 pi-ai 0.81.x 新 API：builtinModels / Models.complete
 * 内部使用 pi-agent-core 0.81.x API：AgentHarness / InMemorySessionRepo / NodeExecutionEnv
 *
 * @packageDocumentation
 */

/** 默认 LLM 模型标识，所有模块统一引用此常量 */
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

// ═══════════════════════════════════════════════════════════════════
// pi-ai 导入（动态 + Record 类型避免编译时类型依赖）
// ═══════════════════════════════════════════════════════════════════

// YAML 配置（LLM 网关）
import { loadMorpexConfig, type LlmGatewayConfig } from './yamlConfig.js';

// ═══════════════════════════════════════════════════════════════════
// pi-agent-core 运行时导入
// ★★ PiBridge 是唯一直接导入 pi-agent-core 的文件 ★★
// ═══════════════════════════════════════════════════════════════════

import {
  AgentHarness as _AgentHarness,
  InMemorySessionRepo as _InMemorySessionRepo,
  JsonlSessionRepo as _JsonlSessionRepo,
  uuidv7 as _uuidv7,
} from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv as _NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type {
  AgentTool as _AgentTool,
  AgentToolResult as _AgentToolResult,
  AgentMessage as _AgentMessage,
  AgentEvent as _AgentEvent,
  Session as _Session,
  ExecutionEnv as _ExecutionEnv,
  AgentHarness as _AgentHarnessType,
} from '@earendil-works/pi-agent-core';

// pi-ai 工具函数（稳定 API，但通过 PiBridge 统一出口）
import { clampThinkingLevel as _clampThinkingLevel } from '@earendil-works/pi-ai';
import { getSupportedThinkingLevels as _getSupportedThinkingLevels } from '@earendil-works/pi-ai';

// ═══════════════════════════════════════════════════════════════════
// 类型重导出（对外暴露，业务代码不再直接导入 pi-agent-core）
// ═══════════════════════════════════════════════════════════════════

export type AgentTool = _AgentTool;
export type AgentToolResult = _AgentToolResult;
export type AgentMessage = _AgentMessage;
export type AgentEvent = _AgentEvent;
/** 会话 4：JSONL 持久化 Session 仓库类型（pi-agent-core JsonlSessionRepo 实例类型） */
export type AgentSessionRepo = InstanceType<typeof _JsonlSessionRepo>;
export type AgentExecutionEnv = _ExecutionEnv;
export type AgentHarness = _AgentHarnessType;
// AgentSession 使用下方简化接口定义

// ═══════════════════════════════════════════════════════════════════
// 公开类型（稳定的对外接口，不依赖 pi-ai/pi-agent-core 类型）
// ═══════════════════════════════════════════════════════════════════

export interface GenerateParams {
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  modelUsed: string;
  finishReason: string;
  usage: { input: number; output: number; total: number };
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

export interface AgentConfig {
  tools: AgentToolDescriptor[];
  systemPrompt: string;
  model?: string;
  sessionId?: string;
  /**
   * 会话 4 补充（Session 化）：注入的 pi-agent-core Session 实例（JsonlSessionRepo 持久化会话）。
   * 提供时直接使用（AgentHarness 自动把对话/工具调用写入该 session），否则默认 InMemorySessionRepo。
   */
  session?: unknown;
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentSession {
  readonly id: string;
  readonly createdAt: number;
}

export interface AgentHarnessHandle {
  /** 发送 prompt 给 agent，返回文本 */
  prompt(input: string): Promise<string>;
  /** 中止当前 agent 执行 */
  abort(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// PiBridge
// ═══════════════════════════════════════════════════════════════════

export class PiBridge {
  private models: Record<string, unknown> | null = null;
  private initialized = false;
  readonly defaultModel: string;
  /** LLM 网关配置（config/morpex.yaml 的 llm 块；enabled=true 时生效） */
  private gateway: LlmGatewayConfig | null = null;

  constructor(defaultModel = 'deepseek/deepseek-v4-flash') {
    // 读取 YAML 配置：有启用网关 → 默认模型指向网关 provider/model
    const cfg = loadMorpexConfig();
    if (cfg?.llm?.enabled && cfg.llm.provider && cfg.llm.model) {
      this.gateway = cfg.llm;
      this.defaultModel = `${cfg.llm.provider}/${cfg.llm.model}`;
    } else {
      this.gateway = null;
      this.defaultModel = defaultModel;
    }
  }

  // ── 初始化 ──

  /**
   * init — 初始化 Models 实例
   *
   * - 配置了 LLM 网关（config/morpex.yaml llm.enabled=true）→ 用 pi-ai createProvider
   *   注册自定义 OpenAI 兼容 provider（指向网关 baseUrl）
   * - 未配置 → 注册所有内置 providers（builtinModels，现状）
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      if (this.gateway) {
        await this.initGateway(this.gateway);
      } else {
        const mod = await import('@earendil-works/pi-ai/providers/all');
        const fn = mod.builtinModels as unknown as () => Record<string, unknown>;
        this.models = fn();
      }
      this.initialized = true;
    } catch (err) {
      console.warn('[PiBridge] 初始化失败:', err);
    }
  }

  /**
   * initGateway — 用 pi-ai createProvider 注册自定义 OpenAI 兼容网关
   *
   * 参考 pi-ai README「createProvider()」：本地推理服务/代理/OpenAI 兼容端点。
   * 模型走 openai-completions API，baseUrl 指向网关，apiKey 由 auth.resolve 提供。
   */
  private async initGateway(cfg: LlmGatewayConfig): Promise<void> {
    const piAi = (await import('@earendil-works/pi-ai')) as unknown as {
      createModels: () => {
        setProvider: (p: unknown) => void;
        getModel: (p: string, id: string) => Record<string, unknown> | undefined;
        getModels: (p?: string) => Array<Record<string, unknown>>;
      };
      createProvider: (input: Record<string, unknown>) => unknown;
    };
    const apiMod = (await import('@earendil-works/pi-ai/api/openai-completions.lazy')) as unknown as {
      openAICompletionsApi: () => unknown;
    };

    const providerId = cfg.provider ?? 'morpex-gateway';
    const baseUrl = cfg.baseUrl ?? 'http://localhost:8000/v1';
    const modelId = cfg.model ?? 'grok-2';
    const apiKey = cfg.apiKey ?? '';

    // 模型定义（openai-completions API）
    const model = {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: providerId,
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: cfg.contextWindow ?? 128000,
      maxTokens: cfg.maxTokens ?? 32000,
    };

    // 自定义 provider（auth.resolve 提供 apiKey）
    const provider = piAi.createProvider({
      id: providerId,
      name: `${providerId} (OpenAI-compatible gateway)`,
      baseUrl,
      auth: {
        apiKey: {
          name: providerId,
          resolve: async () => ({ auth: { apiKey } }),
        },
      },
      models: [model],
      api: apiMod.openAICompletionsApi(),
    });

    // 创建 Models 集合并注入自定义 provider
    const models = piAi.createModels();
    models.setProvider(provider);
    this.models = models as unknown as Record<string, unknown>;

    console.log(`[PiBridge] ✅ 自定义 LLM 网关已配置: ${baseUrl} (${providerId}/${modelId})`);
  }

  get ready(): boolean {
    return this.initialized && this.models !== null;
  }

  // ═══════════════════════════════════════════════════════════════
  // AI 推理
  // ═══════════════════════════════════════════════════════════════

  /** 列出可用模型 */
  listModels(provider?: string): ModelInfo[] {
    if (!this.models) return [];
    try {
      const m = this.models as unknown as { getModels: (p?: string) => Array<Record<string, unknown>> };
      const models = provider ? m.getModels(provider) : m.getModels();
      const list = Array.isArray(models) ? models : [];
      return list.map((item: Record<string, unknown>) => ({
        id: item.id as string,
        name: item.name as string,
        provider: (item.provider as { id?: string })?.id ?? (item.provider as string),
        api: item.api as string,
        contextWindow: item.contextWindow as number,
        maxTokens: item.maxTokens as number,
        reasoning: (item.reasoning as boolean) ?? false,
      }));
    } catch {
      return [];
    }
  }

  /** 列出所有 provider */
  listProviders(): string[] {
    if (!this.models) return [];
    try {
      const m = this.models as unknown as { getProviders: () => Array<{ id: string }> };
      return m.getProviders().map(p => p.id);
    } catch {
      return [];
    }
  }

  /** 按 provider + modelId 查找模型 */
  findModel(provider: string, modelId: string): ModelInfo | undefined {
    if (!this.models) return undefined;
    try {
      const accessor = this.models as unknown as { getModel: (p: string, id: string) => Record<string, unknown> | undefined };
      const found = accessor.getModel(provider, modelId);
      if (!found) return undefined;
      return {
        id: found.id as string,
        name: found.name as string,
        provider: (found.provider as { id?: string })?.id ?? provider,
        api: found.api as string,
        contextWindow: found.contextWindow as number,
        maxTokens: found.maxTokens as number,
        reasoning: (found.reasoning as boolean) ?? false,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * generateText — 非流式文本生成
   * 内部使用 Models.complete（pi-ai 0.81.x 新 API）
   */
  async generateText(params: GenerateParams): Promise<GenerateResult> {
    if (!this.models) {
      await this.init();
      if (!this.models) throw new Error('PiBridge not initialized');
    }

    const [provider, modelId] = this.parseModel(params.model ?? this.defaultModel);
    const m = this.models as unknown as {
      getModel: (p: string, id: string) => Record<string, unknown> | undefined;
      complete: (model: Record<string, unknown>, ctx: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    const model = m.getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.prompt });

    const result = await m.complete(model, { messages }, {
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    });

    const text = this.extractText(result);

    return {
      text,
      modelUsed: `${provider}/${model.id as string}`,
      finishReason: (result.stopReason as string) ?? 'unknown',
      usage: {
        input: (result.usage as { input?: number })?.input ?? 0,
        output: (result.usage as { output?: number })?.output ?? 0,
        total: (result.usage as { totalTokens?: number })?.totalTokens ?? 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Agent 生命周期
  // ═══════════════════════════════════════════════════════════════

  /**
   * createAgentHarness — 创建 Agent 执行单元
   *
   * 封装 pi-agent-core 的 AgentHarness，对外暴露稳定的 prompt()/abort() 接口。
   *
   * @param config - Agent 配置
   * @returns AgentHarnessHandle
   */
  async createAgentHarness(config: AgentConfig): Promise<{
    prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    abort: () => Promise<void>;
  }> {
    if (!this.models) await this.init();

    const [provider, modelId] = this.parseModel(config.model ?? this.defaultModel);
    let model: Record<string, unknown> = {};
    if (this.models) {
      const m = this.models as unknown as { getModel: (p: string, id: string) => Record<string, unknown> | undefined };
      const found = m.getModel(provider, modelId);
      if (found) model = found;
    }

    const env = new _NodeExecutionEnv({ cwd: process.cwd() });
    // ⬅️ Session 化（会话 4）：注入持久化 session 时直接使用（对话自动落盘），否则回退内存 repo
    let session: unknown;
    if (config.session) {
      session = config.session;
    } else {
      const repo = new _InMemorySessionRepo();
      session = await repo.create({
        id: config.sessionId ?? `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });
    }

    const tools: _AgentTool[] = config.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      // ⬅️ 多 Agent 框架（会话 3）：透传 execute——之前只传 name/description/parameters，
      //    pi-agent-core Agent 声明的工具没有执行函数 → 工具调用循环空转（DAG 节点卡死根因之一）。
      execute: t.execute
        ? async (toolCallId: string, params: unknown) => {
            try {
              const raw = await (t.execute as (p: Record<string, unknown>) => Promise<unknown>)((params ?? {}) as Record<string, unknown>);
              const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
              return { content: [{ type: 'text', text }], isError: false } as _AgentToolResult;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: [{ type: 'text', text: `[tool error] ${msg}` }], isError: true } as _AgentToolResult;
            }
          }
        : undefined,
    } as _AgentTool));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const harness = new (_AgentHarness as any)({
      env,
      // ⬅️ 会话 3 修复：pi-agent-core AgentHarness 构造函数要求 options.models（Models 实例，
      //    含 streamSimple）——此前未传 → this.models=undefined → "Cannot read properties of undefined
      //    (reading 'streamSimple')" → agent 4ms 返回空内容（step-agent 空转根因）。
      models: this.models,
      model,
      session,
      tools,
      systemPrompt: config.systemPrompt || 'You are a helpful assistant.',
    });

    return harness as {
      prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      abort: () => Promise<void>;
    };
  }

  /**
   * createAgentSession — 创建一个 agent session ID
   */
  createAgentSessionId(prefix = 'sess'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * createJsonlSessionRepo — 创建 JSONL 持久化 Session 仓库（会话 4 Session 化）
   *
   * 落盘布局：root/<encodeCwd(cwd)>/<ISO时间戳>_<sessionId>.jsonl
   * （cwd 作为组件分组维度：'orchestrator' | 'step-agent' | 'executor'）
   */
  static createJsonlSessionRepo(root: string): _JsonlSessionRepo {
    const env = new _NodeExecutionEnv({ cwd: process.cwd() });
    return new _JsonlSessionRepo({ fs: env, sessionsRoot: root });
  }

  /**
   * generateUuid — 生成 UUID v7
   */
  generateUuid(): string {
    return _uuidv7();
  }

  // ═══════════════════════════════════════════════════════════════
  // 静态工具（供 pi-utils.ts 等模块级引用使用）
  // ═══════════════════════════════════════════════════════════════

  /** UUID v7 生成器（静态版本） */
  static uuidv7(): string {
    return _uuidv7();
  }

  /** 创建 NodeExecutionEnv */
  static createNodeEnv(cwd?: string): _NodeExecutionEnv {
    return new _NodeExecutionEnv({ cwd: cwd ?? process.cwd() });
  }

  /** 创建 InMemorySessionRepo */
  static createSessionRepo(): InstanceType<typeof _InMemorySessionRepo> {
    return new _InMemorySessionRepo();
  }

  /** AgentHarness 类引用 */
  static get AgentHarnessClass(): typeof _AgentHarness {
    return _AgentHarness;
  }

  /** InMemorySessionRepo 类引用 */
  static get SessionRepoClass(): typeof _InMemorySessionRepo {
    return _InMemorySessionRepo;
  }

  /** NodeExecutionEnv 类引用 */
  static get NodeEnvClass(): typeof _NodeExecutionEnv {
    return _NodeExecutionEnv;
  }

  /** clampThinkingLevel — 钳制推理深度 */
  static clampThinkingLevel: typeof _clampThinkingLevel = _clampThinkingLevel;

  /** getSupportedThinkingLevels — 获取模型支持的推理深度 */
  static getSupportedThinkingLevels: typeof _getSupportedThinkingLevels = _getSupportedThinkingLevels;

  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════

  private parseModel(model: string): [string, string] {
    const idx = model.indexOf('/');
    return idx === -1 ? ['deepseek', model] : [model.substring(0, idx), model.substring(idx + 1)];
  }

  private extractText(msg: Record<string, unknown>): string {
    const content = msg.content as Array<{ type?: string; text?: string }> | undefined;
    if (!content) return '';
    return content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text!)
      .join('');
  }
}
