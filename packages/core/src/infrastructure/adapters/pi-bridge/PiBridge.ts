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
/**
 * DEFAULT_MODEL — 默认模型兜底（会话 11：config 为唯一来源，此常量仅当 config 缺失/未配置时兜底）
 * 实际模型由 config/morpex.yaml 的 llm.provider + llm.model 驱动。
 */
export const DEFAULT_MODEL = 'opencode/deepseek-v4-flash-free';

/**
 * RateLimitError — LLM 网关限流/过载错误（会话 10 新增）
 *
 * GLM 速率限制（HTTP 429，code 1302/1305）时 pi-ai 静默返回空结果；
 * 本错误让调用方显式感知限流并退避重试（batch-run 已按 429/5xx 重试）。
 */
export class RateLimitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
  }
}

/**
 * resolveDefaultModel — 从 config/morpex.yaml 解析默认模型（会话 11：抽离硬编码，config 为唯一来源）
 *
 * 返回 `${provider}/${model}`（如 'opencode/deepseek-v4-flash-free'）；
 * config 未配置 llm 或缺 provider/model → 回退 DEFAULT_MODEL 兜底。
 * 各模块（model-registry / model-resolver / MorPexConfig / PiModelRegistry）统一引用，
 * 消除散落的硬编码模型名。
 */
export function resolveDefaultModel(configPath?: string): string {
  try {
    const cfg = loadMorpexConfig(configPath);
    const llm = cfg?.llm;
    if (llm?.provider && llm.model) return `${llm.provider}/${llm.model}`;
  } catch { /* config 异常 → 兜底 */ }
  return DEFAULT_MODEL;
}

// ═══════════════════════════════════════════════════════════════════
// pi-ai 导入（动态 + Record 类型避免编译时类型依赖）
// ═══════════════════════════════════════════════════════════════════

// YAML 配置（LLM 网关）
import { loadMorpexConfig, getEnabledExtraLlms, type LlmGatewayConfig } from './yamlConfig.js';

// ═══ 去黑盒化（黑盒① LLM 交互记录 + 黑盒② 成本落库）：统一记录入口 ═══
// PiBridge 不直接依赖 EventStore，经进程级共享单例旁路写入（未配置时内存缓冲，永不阻断）。
import { getSharedDeblackboxRecorder } from '../../observability/deblackbox/DeblackboxRecorder.js';

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
  /** 去黑盒化：调用方标识（规划/执行/反思/参数提取…），随 llm.call 决策单记录 */
  caller?: string;
  /** 去黑盒化：关联执行 ID（任务级成本/交互溯源） */
  executionId?: string;
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
  /**
   * 会话 15（工具可靠性 P0）：工具执行前钩子。
   * 在 pi-agent-core 校验通过后、execute 执行前调用；返回 { block: true, reason } 可拦截本次调用，
   * reason 作为错误结果回填 LLM（强制其补全参数重发），用于根治思考模式空参问题。
   */
  beforeToolCall?: (params: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<{ block?: boolean; reason?: string } | undefined> | { block?: boolean; reason?: string } | undefined;
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<unknown>;
  /**
   * ═══ 会话 16l·7（通用空参保险）：在 schema 校验前处理参数（空参注入可推断值）。
   *     模型无关——任意 LLM 的空参都可在校验前被保险层兜住。
   */
  prepareArguments?: (args: unknown) => unknown;
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
  private _defaultModel: string;

  /** 当前生效模型标识（'provider/model'，config 解析；可运行时 setDefaultModel 全局切换） */
  get defaultModel(): string {
    return this._defaultModel;
  }

  /**
   * setDefaultModel — 运行时切换全局默认模型（'provider/model'，如 'minicpm/minicpm5'）。
   * 只影响「之后发起」的 generateText 调用；在途请求已在 generateTextOnce 开头解析完模型。
   */
  setDefaultModel(modelId: string): void {
    if (typeof modelId === 'string' && modelId.trim()) {
      this._defaultModel = modelId.trim();
    }
  }
  /** LLM 网关配置（config/morpex.yaml 的 llm 块；enabled=true 时生效） */
  private gateway: LlmGatewayConfig | null = null;
  /** 附加模型网关（config 中所有 `llm_*` 块；注册为可选 provider，不改变默认模型） */
  private extraGateways: LlmGatewayConfig[] = [];

  constructor(defaultModel = DEFAULT_MODEL) {
    // ═══ 会话 11：config 为唯一模型来源（抽离硬编码）═══
    // llm.mode:
    //   - 'builtin'（默认）→ 用 pi-ai 内置 provider（provider/model 从 config 读；
    //                       apiKey 经 config 注入 process.env 供内置 provider 自带 env 鉴权）
    //   - 'gateway'       → 自定义 OpenAI 兼容网关（baseUrl + apiKey）
    const cfg = loadMorpexConfig();
    const llm = cfg?.llm;
    if (llm?.enabled && llm.provider && llm.model) {
      this._defaultModel = `${llm.provider}/${llm.model}`;
      const mode = llm.mode ?? 'builtin';
      if (mode === 'gateway') {
        this.gateway = llm;
      } else {
        // builtin：gateway 置空走 pi-ai 内置 provider；若 config 提供 apiKey（含 ${VAR}/Windows 兑底），
        // 注入 process.env.<PROVIDER>_API_KEY 供内置 provider 鉴权（envApiKeyAuth 只读 process.env）
        this.gateway = null;
        if (llm.apiKey) {
          const envKey = `${llm.provider.toUpperCase()}_API_KEY`;
          if (!process.env[envKey]) process.env[envKey] = llm.apiKey;
        }
      }
    } else {
      this.gateway = null;
      this._defaultModel = defaultModel;
    }
    // ═══ 附加模型：config 中所有 llm_* 块（如 llm_minicpm）═══
    // 与默认模型并存：默认仍走 llm.provider/llm.model，附加模型用 "provider/model" 完整标识显式选择
    // 过滤条件与 model-registry / model-resolver 共用 isExtraLlmUsable（yamlConfig），防止三处漂移
    this.extraGateways = getEnabledExtraLlms(cfg);
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
      // ═══ 附加模型：在同一 Models 实例上叠加注册所有 llm_* 网关 provider ═══
      // 与默认模型并存：默认仍走 llm.provider/llm.model；附加模型用 "provider/model" 完整标识选择
      for (const extra of this.extraGateways) {
        await this.registerExtraProvider(extra);
      }
      this.initialized = true;
    } catch (err) {
      console.warn('[PiBridge] 初始化失败:', err);
    }
  }

  /**
   * initGateway — 用 pi-ai createProvider 注册自定义 OpenAI 兼容网关（主 llm 块）
   *
   * 参考 pi-ai README「createProvider()」：本地推理服务/代理/OpenAI 兼容端点。
   * 模型走 openai-completions API，baseUrl 指向网关，apiKey 由 auth.resolve 提供。
   * 新建 Models 集合并注入主网关 provider。
   */
  private async initGateway(cfg: LlmGatewayConfig): Promise<void> {
    const provider = await this.buildProvider(cfg);
    const piAi = (await import('@earendil-works/pi-ai')) as unknown as {
      createModels: () => {
        setProvider: (p: unknown) => void;
      };
    };
    // 创建 Models 集合并注入主网关 provider
    const models = piAi.createModels();
    models.setProvider(provider);
    this.models = models as unknown as Record<string, unknown>;

    console.log(`[PiBridge] ✅ 自定义 LLM 网关已配置: ${cfg.baseUrl ?? 'http://localhost:8000/v1'} (${cfg.provider ?? 'morpex-gateway'}/${cfg.model ?? 'grok-2'})`);
  }

  /**
   * buildProvider — 用 pi-ai createProvider 构建 OpenAI 兼容网关 provider
   *
   * 主网关（llm 块）与附加模型（llm_* 块）共用此构建逻辑；区别只在注册目标：
   *   - 主网关   → initGateway 新建 Models 集合并 setProvider
   *   - 附加模型 → registerExtraProvider 叠加到已初始化的 Models 实例
   */
  private async buildProvider(cfg: LlmGatewayConfig): Promise<unknown> {
    const piAi = (await import('@earendil-works/pi-ai')) as unknown as {
      createProvider: (input: Record<string, unknown>) => unknown;
    };
    const apiMod = (await import('@earendil-works/pi-ai/api/openai-completions.lazy')) as unknown as {
      openAICompletionsApi: () => unknown;
    };

    const providerId = cfg.provider ?? 'morpex-gateway';
    const baseUrl = cfg.baseUrl ?? 'http://localhost:8000/v1';
    const modelId = cfg.model ?? 'grok-2';
    // ═══ 空 apiKey 处理（本地无 Key 服务）═══
    // pi-ai openai-completions 的 getClientApiKey 要求非空 apiKey（空串按缺失处理，
    // 在发请求前内部抛 "No API key for provider" → PiBridge 误判为 EMPTY_RESPONSE 限流重试）。
    // 本地 OpenAI 兼容服务（如 llama.cpp，未配 --api-key）不校验 Authorization，
    // 传占位非空 key 使请求真正到达服务端；服务端若要求 Key 则返回清晰的 401。
    const apiKey = cfg.apiKey || 'not-needed';

    // 模型定义（openai-completions API）
    const model = {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: providerId,
      baseUrl,
      reasoning: cfg.reasoning ?? false,
      // ═══ 会话 17i.10：思考开关——qwen-chat-template 会发 chat_template_kwargs.enable_thinking
      //     （对应 config 注释；pi-ai 据此把返回的 reasoning_content 组装成 thinking 块，agent 会话可记录、前端可投影）═══
      compat: { thinkingFormat: 'qwen-chat-template' as const },
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: cfg.contextWindow ?? 128000,
      maxTokens: cfg.maxTokens ?? 32000,
    };

    // 自定义 provider（auth.resolve 提供 apiKey）
    return piAi.createProvider({
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
  }

  /**
   * registerExtraProvider — 把附加模型网关叠加注册到已初始化的 Models 实例
   *
   * （builtin 基底或主网关之上；模型用 "provider/model" 完整标识选择，如 minicpm/minicpm5）
   * 单个注册失败不阻断其余模型与主流程。
   */
  private async registerExtraProvider(cfg: LlmGatewayConfig): Promise<void> {
    if (!this.models) return;
    try {
      const provider = await this.buildProvider(cfg);
      const models = this.models as unknown as { setProvider: (p: unknown) => void };
      models.setProvider(provider);
      console.log(`[PiBridge] ✅ 附加 LLM 网关已注册: ${cfg.baseUrl} (${cfg.provider}/${cfg.model})`);
    } catch (err) {
      console.warn(`[PiBridge] ⚠️ 附加 LLM 网关注册失败（忽略，不影响主流程）: ${cfg.provider}/${cfg.model}`, err instanceof Error ? err.message : String(err));
    }
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
    // ═══ 16m·2 全局限流自愈：RateLimitError 自动退避重试（覆盖 grounding 之外的
    //     step-agent/参数提取/反思/编排等所有 generateText 调用），模型无关 ═══
    //     GLM-4-Flash 免费模型密集调用时频繁限流（HTTP 429 / EMPTY_RESPONSE），
    //     此前仅 gate 层 withGateRetry 退避，非 gate 调用直接失败 → 复杂任务多步受挫。
    const MAX_RETRY = 4; // 最多 4 次尝试（含首次），退避 2s→4s→8s 封顶 30s
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      try {
        return await this.generateTextOnce(params, attempt);
      } catch (err) {
        if (!(err instanceof RateLimitError) || attempt >= MAX_RETRY - 1) throw err;
        lastErr = err;
        const wait = Math.min(30_000, 2_000 * 2 ** attempt);
        console.warn(`[PiBridge] ⚠️ 限流退避重试（${attempt + 1}/${MAX_RETRY - 1}）→ 等待 ${wait / 1000}s：${(err as Error).message.slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  /** generateText 单次执行（含限流检测/抛错），供外层全局限流重试包装
   *
   * 去黑盒化：每次调用（含重试 attempt）都记录 llm.call 决策单（摘要永久 + 全文 L2 采样），
   * 异常/失败强制全记。
   */
  private async generateTextOnce(params: GenerateParams, attempt = 0): Promise<GenerateResult> {
    const startedAt = Date.now();
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

    // ═══ 会话 10（GLM-only 限流容错）═══
    // pi-ai openai-completions 不检查 response.ok——HTTP 429（GLM 1302/1305 速率限制）时
    // 读空 body 返回空结果（text=''、usage=0），调用方拿到"空文本"而非错误 → 全链路静默失败。
    // 修复：经 onResponse 回调检测 429/5xx → 抛 RateLimitError（调用方可退避重试，batch-run 已有）。
    let httpStatus: number | null = null;
    try {
      // ═══ 会话 16o（本地 MiniCPM5 接入）：调用方 maxTokens 不超模型定义上限 ═══
      // 编排层默认 maxTokens=32000（bootstrap-unified 的 `?? 32000`），而本地 1B 思考型模型
      // 会无节制生成到该上限（单次 ~15min）。钳到模型定义 maxTokens（config 驱动，如 minicpm=4096）
      // 以控制单次生成预算；仅当调用方显式传 maxTokens 时钳制（未传保持原行为）。
      const modelMaxTokens = (model as { maxTokens?: number }).maxTokens;
      const maxTokens =
        params.maxTokens != null && typeof modelMaxTokens === 'number' && modelMaxTokens > 0
          ? Math.min(params.maxTokens, modelMaxTokens)
          : params.maxTokens;
      const result = await m.complete(model, { messages }, {
        temperature: params.temperature,
        maxTokens,
        // ═══ 会话 17i.10：思考开关——模型 reasoning=true 时请求思考（clampThinkingLevel 需具体级别，true 会落到 off）═══
        ...(model.reasoning ? { reasoning: 'high' as const } : {}),
        onResponse: (resp: { status?: number }) => { httpStatus = resp.status ?? null; },
      } as Record<string, unknown>);

      if (httpStatus !== null && (httpStatus === 429 || httpStatus >= 500)) {
        const code = httpStatus === 429 ? 'GLM_RATE_LIMIT' : `GLM_HTTP_${httpStatus}`;
        throw new RateLimitError(code, `LLM 网关返回 HTTP ${httpStatus}（限流/过载）——provider=${provider} model=${modelId}`);
      }

      const text = this.extractText(result);
      const usage = {
        input: (result.usage as { input?: number })?.input ?? 0,
        output: (result.usage as { output?: number })?.output ?? 0,
        total: (result.usage as { totalTokens?: number })?.totalTokens ?? 0,
      };

      // ═══ 会话 16j（C1 限流检测）═══
      // 内置 provider（builtin，如 opencode）的 complete 不暴露 onResponse → 限流/配额耗尽时
      // 静默返回空文本 + 零 usage（实测: text='' usage=0）。检测空结果+零 usage → 显式抛
      // RateLimitError（可重试），不再静默空返回（此前多会话遗留的静默失败源）。
      if (params.prompt && params.prompt.trim().length > 0 && !text.trim() && usage.total === 0) {
        throw new RateLimitError('EMPTY_RESPONSE', `LLM 返回空结果且零 usage（疑似限流/配额耗尽）——provider=${provider} model=${modelId}`);
      }

      const resultObj: GenerateResult = {
        text,
        modelUsed: `${provider}/${model.id as string}`,
        finishReason: (result.stopReason as string) ?? 'unknown',
        usage,
      };

      // ═══ 去黑盒化：记录 LLM 交互（成功）═══
      this.recordLlmCall(params, {
        provider,
        modelId,
        startedAt,
        attempt,
        result: resultObj,
        estimatedCost: this.estimateCost(model, usage),
      });

      return resultObj;
    } catch (err) {
      // ═══ 去黑盒化：记录 LLM 交互（失败/异常，强制全记）═══
      this.recordLlmCall(params, {
        provider,
        modelId,
        startedAt,
        attempt,
        error: err,
        estimatedCost: 0,
      });
      // 透传 RateLimitError（含上面构造的）；其余异常包装为带状态的上抛，避免静默空结果
      if (err instanceof RateLimitError) throw err;
      throw err;
    }
  }

  /**
   * recordLlmCall — 去黑盒化黑盒①/②：记录每次 LLM 交互（摘要 L1 永久 + 全文 L2 采样 + 成本）
   *
   * 摘要字段：调用方/模型/prompt 摘要/响应摘要/耗时/输入输出 token/成本估算/成败/失败原因/重试序号
   */
  private recordLlmCall(
    params: GenerateParams,
    info: {
      provider: string;
      modelId: string;
      startedAt: number;
      attempt: number;
      result?: GenerateResult;
      error?: unknown;
      estimatedCost: number;
    }
  ): void {
    try {
      const recorder = getSharedDeblackboxRecorder();
      const isError = info.error !== undefined;
      const usage = info.result?.usage;
      recorder.record({
        category: 'llm.call',
        source: 'pi-bridge',
        executionId: params.executionId ?? 'kernel',
        level: 'L1',
        isError,
        summary: {
          caller: params.caller ?? 'unknown',
          model: info.result?.modelUsed ?? `${info.provider}/${info.modelId}`,
          promptSummary: params.prompt.slice(0, 200),
          responseSummary: info.result ? info.result.text.slice(0, 200) : '',
          durationMs: Date.now() - info.startedAt,
          inputTokens: usage?.input ?? 0,
          outputTokens: usage?.output ?? 0,
          totalTokens: usage?.total ?? 0,
          estimatedCost: info.estimatedCost,
          finishReason: info.result?.finishReason ?? 'error',
          attempt: info.attempt,
          success: !isError,
          error: isError ? (info.error instanceof Error ? info.error.message.slice(0, 300) : String(info.error).slice(0, 300)) : '',
          reasoning: isError ? 'LLM 调用失败（重试中/最终失败）' : 'LLM 交互成功',
        },
        // L2 详情（采样；异常全记）：prompt/系统/响应全文 + 重试序号
        detail: {
          caller: params.caller ?? 'unknown',
          system: params.system ?? '',
          prompt: params.prompt,
          response: info.result?.text ?? '',
          attempt: info.attempt,
        },
      });
    } catch (err) {
      // 记录器自身异常绝不影响 LLM 主流程
      console.warn('[PiBridge] ⚠️ LLM 交互记录失败（忽略）:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * estimateCost — 估算一次调用的成本（美元）
   *
   * 模型 cost 字段约定（pi-ai / 网关）：{ input, output, cacheRead, cacheWrite }，单位 = 每百万 token 价格。
   * 缺失时按 0 计（成本未知也如实记录为 0，避免虚报）。
   */
  private estimateCost(model: Record<string, unknown>, usage: { input: number; output: number }): number {
    const cost = model.cost as { input?: number; output?: number } | undefined;
    if (!cost || typeof cost !== 'object') return 0;
    const inputPrice = typeof cost.input === 'number' ? cost.input : 0;
    const outputPrice = typeof cost.output === 'number' ? cost.output : 0;
    return (usage.input / 1_000_000) * inputPrice + (usage.output / 1_000_000) * outputPrice;
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
    // 17i.12：订阅 harness 流式事件（message_update → text_delta/thinking_delta），供实时终端转录
    subscribe: (listener: (event: Record<string, unknown>) => void) => () => void;
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
      // ═══ 会话 16l·7（通用空参保险）：透传 prepareArguments——在 schema 校验前处理参数
      //     （空参注入 goal 等可推断值），使任意模型（含老模型 GLM）的空参都能被保险层兜住。
      prepareArguments: (t as { prepareArguments?: (args: unknown) => unknown }).prepareArguments,
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
      // ═══ 会话 17i.10：思考开关——透传给 streamSimple（agent-loop 的 config.reasoning；需具体级别）═══
      ...(model.reasoning ? { reasoning: 'high' as const } : {}),
      // ⬅️ 会话 15（工具可靠性 P0）：工具执行前钩子透传——空参拦截/知识 goal 兜底在工具执行前生效
      beforeToolCall: config.beforeToolCall,
    });

    return harness as {
      prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      abort: () => Promise<void>;
      subscribe: (listener: (event: Record<string, unknown>) => void) => () => void;
    };
  }

  /**
   * generateChatStream — 流式文本生成（17i.32：闲聊直答逐 token 输出）。
   * 复用 createAgentHarness 的 subscribe（text_delta），onDelta 每 token 回调一次，返回完整文本。
   */
  async generateChatStream(params: { system: string; prompt: string }, onDelta: (d: string) => void): Promise<string> {
    if (!this.models) await this.init();
    const harness = await this.createAgentHarness({
      systemPrompt: params.system,
      sessionId: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tools: [],
    });
    let full = '';
    let unsub: (() => void) | undefined;
    if (typeof harness.subscribe === 'function') {
      unsub = harness.subscribe((evt) => {
        const e = evt as Record<string, unknown>;
        if (e.type !== 'message_update') return;
        const ae = (e.assistantMessageEvent ?? {}) as Record<string, unknown>;
        if (ae.type === 'text_delta' && typeof ae.delta === 'string' && ae.delta) {
          full += ae.delta;
          onDelta(ae.delta);
        }
      });
    }
    try {
      const res = await harness.prompt(params.prompt);
      const text = this.extractText(res as unknown as Record<string, unknown>);
      return text || full;
    } finally {
      unsub?.();
    }
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
    return idx === -1 ? ['opencode', model] : [model.substring(0, idx), model.substring(idx + 1)];
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

// ═══════════════════════════════════════════════════════════════
// 进程级共享单例（会话 16l P0-2：PiBridge 连接复用）
// ═══════════════════════════════════════════════════════════════
//
// PiBridge 是「配置驱动 + 无每实例可变状态」的客户端：
//   - 构造器从 config/morpex.yaml 解析默认模型（config 是唯一来源）
//   - init() 加载 builtinModels / 网关 provider（模块级共享）
//   - createAgentHarness / generateText 均为纯函数（models 只在内部读）
// 因此同进程所有调用方（agent-spawner / ServiceContainer / bootstrap）应复用同一实例，
// 避免每次 spawn/启动都 new + init（模型表重复加载、网关重复注册）。
//
// 与 memory/activationRegistry 的全局注册表模式一致（setGlobal/getGlobal 成对暴露）。

let sharedPiBridge: PiBridge | null = null;

/**
 * getSharedPiBridge — 获取进程级共享 PiBridge 实例（懒创建，重复调用返回同一实例）
 *
 * 参数 defaultModel 仅当首次创建时生效（此后以 config/morpex.yaml 解析结果为准，
 * config 是唯一模型来源，各调用方解析结果一致，无需按调用方区分）。
 */
export function getSharedPiBridge(defaultModel = DEFAULT_MODEL): PiBridge {
  if (!sharedPiBridge) {
    sharedPiBridge = new PiBridge(defaultModel);
  }
  return sharedPiBridge;
}

/**
 * resetSharedPiBridge — 重置共享单例（测试用；业务代码不应调用）
 */
export function resetSharedPiBridge(): void {
  sharedPiBridge = null;
}
