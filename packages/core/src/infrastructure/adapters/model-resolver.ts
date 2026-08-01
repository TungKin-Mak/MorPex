/**
 * ModelResolver — Type-safe wrapper around pi-ai's getModel().
 *
 * Uses pi-ai/compat for backward compatibility.
 */

import { getModel, getProviders } from '@earendil-works/pi-ai/compat';

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
      return getModel(provider as never, modelId as never) as unknown as Record<string, unknown>;
    } catch { /* fall through */ }
  }

  // Fallback order
  const fallbacks = [
    ['deepseek', 'deepseek-v4-flash'],
    ['openai', 'gpt-4o-mini'],
  ];

  for (const [fbProvider, fbModelId] of fallbacks) {
    try {
      return getModel(fbProvider as never, fbModelId as never) as unknown as Record<string, unknown>;
    } catch { continue; }
  }

  throw new Error(`Cannot resolve model: ${provider}/${modelId}`);
}
