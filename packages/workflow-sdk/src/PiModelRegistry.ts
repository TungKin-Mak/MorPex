/**
 * PiModelRegistry — LLM 模型注册表
 *
 * 通过 PiBridge 抽象层调用 pi-ai，隔离版本变更。
 * PiBridge 内部使用 pi-ai 0.81.x 新 API（Models.complete）。
 *
 * @packageDocumentation
 */

import { PiBridge } from '@morpex/core';

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

  constructor(model = 'deepseek/deepseek-v4-flash') {
    this.bridge = new PiBridge(model);
    this.modelName = model;
    this.apiKey = !!(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY);
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
  // HTTP 回退（直接调 DeepSeek API）
  // ═══════════════════════════════════════════════════════════════

  private async directHttpGenerate(params: GenerateParams): Promise<GenerateResult> {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.prompt });

    const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature: params.temperature ?? 0.3,
          max_tokens: params.maxTokens ?? 2000,
        }),
        signal: AbortSignal.timeout(30000),
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

      return { content: text, text, modelUsed: 'deepseek-chat (HTTP)' };
    } catch (err) {
      console.warn('[PiModelRegistry] HTTP 调用失败:', err);
      return { content: '', text: '', modelUsed: this.modelName };
    }
  }
}
