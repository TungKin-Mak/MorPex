/**
 * PiBridge 限流检测测试（会话 10：GLM-only 限流容错）
 *
 * 背景：pi-ai openai-completions 不检查 response.ok——GLM HTTP 429（1302/1305 速率限制）
 * 时静默返回空结果（text='' usage=0）→ 调用方拿到"空文本"而非错误 → 全链路静默失败。
 * 修复：generateText 经 onResponse 回调检测 429/5xx → 抛 RateLimitError（可退避重试）。
 *
 * 覆盖：
 *   - onResponse 429 → generateText 抛 RateLimitError（code=GLM_RATE_LIMIT）
 *   - onResponse 503 → 抛 RateLimitError（code=GLM_HTTP_503）
 *   - onResponse 200 → 正常返回
 *   - 无 onResponse 回调（旧 complete 不调）→ 不抛（保持兼容）
 */

import { describe, it, expect } from 'vitest';
import { PiBridge, RateLimitError } from '../src/infrastructure/adapters/pi-bridge/PiBridge.js';

/** 构造一个 PiBridge，替换内部 models 为可控 mock（complete 可触发 onResponse） */
function makeBridge(status: number | null) {
  const bridge = new PiBridge();
  // 直接替换内部 models（绕过 init/网关——测试不调真实 LLM）
  (bridge as unknown as { models: unknown }).models = {
    getModel: () => ({ id: 'glm-4.7-flash', provider: 'zhipu-glm' }),
    complete: async (_model: unknown, _ctx: unknown, opts?: Record<string, unknown>) => {
      const onResponse = opts?.onResponse as ((resp: { status?: number }) => void) | undefined;
      if (onResponse && status !== null) onResponse({ status });
      return {
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'stop',
        usage: { input: 10, output: 20, totalTokens: 30 },
      };
    },
  } as never;
  (bridge as unknown as { initialized: boolean }).initialized = true;
  return bridge;
}

describe('PiBridge.generateText — 限流检测（会话 10）', () => {
  it('onResponse 429 → 抛 RateLimitError（code=GLM_RATE_LIMIT），不再静默返回空', async () => {
    const bridge = makeBridge(429);
    await expect(
      bridge.generateText({ prompt: 'hi' }),
    ).rejects.toThrowError(RateLimitError);
    try {
      await bridge.generateText({ prompt: 'hi' });
    } catch (e) {
      expect((e as RateLimitError).code).toBe('GLM_RATE_LIMIT');
      expect((e as RateLimitError).message).toContain('429');
    }
  });

  it('onResponse 503 → 抛 RateLimitError（code=GLM_HTTP_503）', async () => {
    const bridge = makeBridge(503);
    try {
      await bridge.generateText({ prompt: 'hi' });
      expect.fail('应抛 RateLimitError');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).code).toBe('GLM_HTTP_503');
    }
  });

  it('onResponse 200 → 正常返回文本（不误伤）', async () => {
    const bridge = makeBridge(200);
    const r = await bridge.generateText({ prompt: 'hi' });
    expect(r.text).toBe('ok');
    expect(r.usage.total).toBe(30);
  });

  it('complete 不触发 onResponse（旧实现）→ 不抛，返回文本（兼容）', async () => {
    const bridge = makeBridge(null); // null → 不调 onResponse
    const r = await bridge.generateText({ prompt: 'hi' });
    expect(r.text).toBe('ok');
  });
});
