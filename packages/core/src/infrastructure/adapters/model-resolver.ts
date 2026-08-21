/**
 * ModelResolver — Type-safe wrapper around pi-ai's getModel().
 *
 * Uses pi-ai/compat for backward compatibility.
 */

import { getModel, getProviders } from '@earendil-works/pi-ai/compat';
import { resolveDefaultModel } from './pi-bridge/index.js';
import { loadMorpexConfig, getEnabledExtraLlms } from './pi-bridge/yamlConfig.js';

// Known provider set for runtime validation
const _knownSet = new Set<string>();
function getKnownProviderSet(): Set<string> {
  if (_knownSet.size === 0) {
    try {
      for (const p of getProviders() as unknown as string[]) {
        _knownSet.add(p);
      }
    } catch { /* ignore */ }
    // ═══ 附加模型：config 中 llm_* 网关块也视为已知 provider（compat 静态目录不含）═══
    // 过滤条件与 PiBridge / model-registry 共用 isExtraLlmUsable（yamlConfig），防止三处漂移
    try {
      for (const g of getEnabledExtraLlms(loadMorpexConfig())) {
        if (g.provider) _knownSet.add(g.provider);
      }
    } catch { /* ignore */ }
  }
  return _knownSet;
}

export function isKnownProvider(value: string): boolean {
  return getKnownProviderSet().has(value);
}

/**
 * Resolve a model by provider+modelId strings.
 */
export function resolveModel(
  provider: string,
  modelId: string,
): Record<string, unknown> {
  // ═══ 附加网关模型优先（compat 静态目录不含运行时注册的自定义 provider）═══
  // 从 config 构建等价模型定义（provider.id 形式，与 pi-ai Model 形状一致）
  const extra = getEnabledExtraLlms(loadMorpexConfig()).find(
    (g) => g.provider === provider && g.model === modelId,
  );
  if (extra) {
    return {
      id: modelId,
      name: modelId,
      provider: { id: provider },
      api: 'openai-completions',
      baseUrl: extra.baseUrl,
      reasoning: extra.reasoning ?? false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: extra.contextWindow ?? 128000,
      maxTokens: extra.maxTokens ?? 32000,
    };
  }

  // Try the requested provider
  if (isKnownProvider(provider)) {
    try {
      return getModel(provider as unknown as Parameters<typeof getModel>[0], modelId as unknown as Parameters<typeof getModel>[1]) as unknown as Record<string, unknown>;
    } catch { /* fall through */ }
  }

  // Fallback order（会话 11：config 驱动默认模型 + openai 兜底）
  const resolved = resolveDefaultModel();
  const idx = resolved.indexOf('/');
  const cfgProvider = idx === -1 ? 'opencode' : resolved.substring(0, idx);
  const cfgModel = idx === -1 ? 'deepseek-v4-flash-free' : resolved.substring(idx + 1);
  const fallbacks = [
    [cfgProvider, cfgModel],
    ['openai', 'gpt-4o-mini'],
  ];

  for (const [fbProvider, fbModelId] of fallbacks) {
    try {
      return getModel(fbProvider as unknown as Parameters<typeof getModel>[0], fbModelId as unknown as Parameters<typeof getModel>[1]) as unknown as Record<string, unknown>;
    } catch { continue; }
  }

  throw new Error(`Cannot resolve model: ${provider}/${modelId}`);
}
