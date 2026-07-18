/**
 * Intent Plugin — 意图理解 + 澄清插件
 *
 * 实现 MorPexPlugin 接口，通过 EventBus 与 Kernel 通信。
 *
 * 数据流：
 *   User Input (via EventBus 'intent.input')
 *     │
 *     ▼
 *   IntentResolver.resolve(input)
 *     │
 *     ├─ confidence ≥ threshold → emit('intent.resolved')
 *     │
 *     ├─ confidence ≥ clarifyThreshold
 *     │   └─ emit('intent.needs_clarification')  // 由外部处理澄清
 *     │
 *     └─ confidence < clarifyThreshold → emit('intent.rejected')
 *
 * LLM 调用方式：
 *   通过 config.callLLM 注入（可在 Kernel 配置中传入）
 *   默认使用 ExecutionGateway 或直接 fetch LLM API
 *
 * 事件协议：
 *   - 监听: 'intent.input'                     ← 外部传入用户输入
 *   - 监听: 'intent.clarification.answer'      ← 用户回答澄清问题
 *   - 监听: 'intent.clarification.abort'       ← 用户放弃澄清
 *   - 广播: 'intent.resolved'                  → 下游组件
 *   - 广播: 'intent.needs_clarification'       → 返回澄清问题
 *   - 广播: 'intent.clarification.questions'   → 澄清问题更新
 *   - 广播: 'intent.rejected'                  → 无法理解输入
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { IntentResolver } from './IntentResolver.js';
import type { IntentPluginConfig, IntentResult } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<IntentPluginConfig> = {
  directThreshold: 0.85,
  clarifyThreshold: 0.6,
  maxClarificationRounds: 3,
  clarificationTimeout: 120_000,
  model: 'claude-sonnet-4',
};

/** LLM 调用函数类型 */
export type CallLLMFn = (prompt: string) => Promise<string>;

/**
 * IntentPlugin — 意图理解插件
 *
 * 作为 Control Plane 的第一个组件，负责理解用户输入并做出决策。
 * LLM 调用通过注入的 callLLM 函数实现，默认闭包内可访问 ExecutionGateway。
 */
export class IntentPlugin implements MorPexPlugin {
  name = 'intent-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private resolver!: IntentResolver;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private config!: Required<IntentPluginConfig>;
  private callLLM!: CallLLMFn;
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  /**
   * 插件初始化
   */
  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    // 合并配置
    const userConfig = (context.config?.intent ?? {}) as IntentPluginConfig;
    this.config = { ...DEFAULT_CONFIG };
    if (userConfig.directThreshold !== undefined) this.config.directThreshold = userConfig.directThreshold;
    if (userConfig.clarifyThreshold !== undefined) this.config.clarifyThreshold = userConfig.clarifyThreshold;
    if (userConfig.maxClarificationRounds !== undefined) this.config.maxClarificationRounds = userConfig.maxClarificationRounds;
    if (userConfig.clarificationTimeout !== undefined) this.config.clarificationTimeout = userConfig.clarificationTimeout;
    if (userConfig.model !== undefined) this.config.model = userConfig.model;

    // 获取 LLM 调用函数（从 config 或使用默认闭包）
    const configCallLLM = (context.config?.callLLM as CallLLMFn | undefined);
    this.callLLM = configCallLLM ?? this.defaultCallLLM.bind(this);

    // 创建 IntentResolver
    this.resolver = new IntentResolver({
      callLLM: (prompt: string) => this.callLLM(prompt),
    });

    this.initialized = true;
    console.log('[IntentPlugin] 已初始化');
  }

  /**
   * 插件启动 — 注册 EventBus 监听器
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[IntentPlugin] 请在 start() 前调用 initialize()');
    }

    // 监听外部传入的用户输入
    this.unsubscribers.push(
      this.eventBus.on('intent.input', (event: MorPexEvent) => {
        const input = event.payload?.input ?? event.payload;
        if (typeof input === 'string' && input.trim()) {
          this.handleInput(input, event.executionId).catch(err => {
            console.error('[IntentPlugin] handleInput 错误:', err);
          });
        }
      }),
    );

    // 监听澄清回答
    this.unsubscribers.push(
      this.eventBus.on('intent.clarification.answer', (event: MorPexEvent) => {
        const { sessionId, answers } = event.payload ?? {};
        if (sessionId && answers) {
          this.handleClarificationAnswer(sessionId, answers).catch(err => {
            console.error('[IntentPlugin] handleClarificationAnswer 错误:', err);
          });
        }
      }),
    );

    // 监听放弃澄清
    this.unsubscribers.push(
      this.eventBus.on('intent.clarification.abort', (event: MorPexEvent) => {
        const sessionId = event.payload?.sessionId;
        if (sessionId) {
          console.log(`[IntentPlugin] 放弃澄清: sessionId=${sessionId}`);
        }
      }),
    );

    console.log('[IntentPlugin] 已启动，正在监听 intent.input');
  }

  /**
   * 插件停止
   */
  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    console.log('[IntentPlugin] 已停止');
  }

  /**
   * 默认 LLM 调用函数
   * 通过 EventBus 请求外部注入（适配器模式）
   * 外部系统应监听 'intent.llm.request' 并响应 'intent.llm.response'
   */
  private async defaultCallLLM(prompt: string): Promise<string> {
    const requestId = `llm_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    return new Promise<string>((resolve, reject: (reason: Error) => void) => {
      let done = false;

      this.eventBus.once('intent.llm.response', (event: MorPexEvent) => {
        if (event.payload?.requestId === requestId && !done) {
          done = true;
          resolve(event.payload.text as string);
        }
      });

      this.emitEvent('intent.llm.request', { requestId, prompt });

      setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error('LLM 调用超时'));
        }
      }, 30_000);
    });
  }

  /**
   * 处理用户输入
   */
  private async handleInput(input: string, executionId: string): Promise<void> {
    console.log(`[IntentPlugin] 处理输入: "${input.substring(0, 100)}"`);

    const startTime = Date.now();
    const intent = await this.resolver.resolve(input);
    const processingTime = Date.now() - startTime;

    console.log(`[IntentPlugin] 意图: ${intent.type} | 置信度: ${intent.confidence.toFixed(3)} | 领域: ${intent.domain}`);

    if (intent.confidence >= this.config.directThreshold) {
      console.log(`[IntentPlugin] ✅ 直接执行 (${intent.confidence.toFixed(3)} ≥ ${this.config.directThreshold})`);
      this.emitResolved(intent);

    } else if (intent.confidence >= this.config.clarifyThreshold) {
      console.log(`[IntentPlugin] 🤔 需澄清 (${intent.confidence.toFixed(3)}，阈值 ${this.config.clarifyThreshold})`);
      // 由外部处理澄清
      this.emitEvent('intent.needs_clarification', {
        rawInput: input,
        partialIntent: intent,
        confidence: intent.confidence,
      });

    } else {
      console.log(`[IntentPlugin] ❌ 拒绝 (${intent.confidence.toFixed(3)} < ${this.config.clarifyThreshold})`);
      this.emitEvent('intent.rejected', {
        rawInput: input,
        reason: `置信度过低 (${intent.confidence.toFixed(3)})`,
        confidence: intent.confidence,
      });
    }
  }

  /**
   * 处理澄清回答
   */
  private async handleClarificationAnswer(
    _sessionId: string,
    _answers: Record<string, string>,
  ): Promise<void> {
    console.log(`[IntentPlugin] 澄清回答已转发至 StudioServer 处理`);
  }

  private emitResolved(intent: IntentResult): void {
    this.emitEvent('intent.resolved', {
      intent,
      processingTime: 0,
    });
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: 'intent-plugin',
      source: 'intent-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}
