/**
 * PiModelRegistry — LLM 模型注册表
 *
 * 通过 PiBridge 抽象层调用 pi-ai，隔离版本变更。
 * PiBridge 内部使用 pi-ai 0.81.x 新 API（Models.complete）。
 *
 * @packageDocumentation
 */

import { getSharedPiBridge, DEFAULT_MODEL, type PiBridge } from '@morpex/core';

// ═══════════════════════════════════════════════════════════════════
// 公开类型
// ═══════════════════════════════════════════════════════════════════

export interface GenerateParams {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: string;
}

export interface GenerateResult {
  content: string;
  text: string;
  modelUsed: string;
}

// ═══════════════════════════════════════════════════════════════════
// PiModelRegistry
// ═══════════════════════════════════════════════════════════════════

export class PiModelRegistry {
  private bridge: PiBridge;
  private modelName: string;
  private apiKey: boolean;

  constructor(model = DEFAULT_MODEL) {
    // ═══ 会话 16l（P0-2 连接复用）：复用进程级共享单例（此前每次 new + init）
    this.bridge = getSharedPiBridge(model);
    this.modelName = model;
    this.apiKey = !!(process.env.OPENCODE_API_KEY ?? process.env.GLM_API_KEY ?? process.env.OPENAI_API_KEY);
    console.log(`[PiModelRegistry] ✅ ${model}${this.apiKey ? '' : ' (无 API key)'}`);
  }

  get ready(): boolean {
    return this.apiKey;
  }

  get modelUsed(): string {
    return this.modelName;
  }

  /**
   * generate — 调用 LLM 生成文本
   *
   * 优先通过 PiBridge（pi-ai 新 API），失败回退到直接 HTTP。
   */
  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (!this.apiKey) {
      console.warn('[PiModelRegistry] 无 API key');
      return { content: '', text: '', modelUsed: this.modelName };
    }

    // 尝试 PiBridge
    try {
      const result = await this.bridge.generateText({
        model: this.modelName,
        system: params.system,
        prompt: params.prompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      });

      if (result.text) {
        return {
          content: result.text,
          text: result.text,
          modelUsed: result.modelUsed,
        };
      }
    } catch (err) {
      console.warn('[PiModelRegistry] PiBridge 失败，回退 HTTP');
    }

    // 回退 HTTP
    return this.directHttpGenerate(params);
  }

  // ═══════════════════════════════════════════════════════════════
  // HTTP 回退（会话 10：直调 GLM-4.7-Flash 网关 bigmodel）
  // ═══════════════════════════════════════════════════════════════

  private async directHttpGenerate(params: GenerateParams): Promise<GenerateResult> {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.prompt });

    const apiKey = process.env.OPENCODE_API_KEY ?? process.env.GLM_API_KEY ?? process.env.OPENAI_API_KEY;

    try {
      const response = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash-free',
          messages,
          temperature: params.temperature ?? 0.3,
          max_tokens: params.maxTokens ?? 32000,
        }),
        signal: AbortSignal.timeout(600_000), // 会话 11c：LLM 思考模式可能超 30s，放宽到 10 分钟
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[PiModelRegistry] HTTP ${response.status}: ${errText.substring(0, 200)}`);
        return { content: '', text: '', modelUsed: 'http-failed' };
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? '';

      return { content: text, text, modelUsed: 'deepseek-v4-flash-free (HTTP)' };
    } catch (err) {
      console.warn('[PiModelRegistry] HTTP 调用失败:', err);
      return { content: '', text: '', modelUsed: this.modelName };
    }
  }
}
