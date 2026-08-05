/**
 * ModelResolver — Type-safe wrapper around pi-ai's getModel().
 *
 * Uses pi-ai/compat for backward compatibility.
 */

import { getModel, getProviders } from '@earendil-works/pi-ai/compat';
import { resolveDefaultModel } from './pi-bridge/index.js';

// Known provider set for runtime validation
const _knownSet = new Set<string>();
function getKnownProviderSet(): Set<string> {
  if (_knownSet.size === 0) {
    try {
      for (const p of getProviders() as unknown as string[]) {
        _knownSet.add(p);
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
