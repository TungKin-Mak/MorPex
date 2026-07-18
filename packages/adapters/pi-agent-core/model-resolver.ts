/**
 * ModelResolver — Type-safe wrapper for pi-agent-core adapter.
 *
 * Reuses the same validation logic as the pi-ai adapter.
 */

import { getModel, getProviders } from '@earendil-works/pi-ai';
import type { Model, Api, KnownProvider } from '@earendil-works/pi-ai';

let _knownProviders: Set<string> | null = null;

function getKnownProviderSet(): Set<string> {
  if (!_knownProviders) _knownProviders = new Set(getProviders());
  return _knownProviders;
}

function isKnownProvider(value: string): value is KnownProvider {
  return getKnownProviderSet().has(value);
}

export function resolveModel(provider: string, modelId: string): Model<Api> {
  if (isKnownProvider(provider)) {
    try { return getModel(provider, modelId as never) as Model<Api>; } catch { /* fall through */ }
  }
  for (const [p, m] of [['deepseek', 'deepseek-v4-flash'], ['openai', 'gpt-4o-mini']] as Array<[KnownProvider, string]>) {
    try { return getModel(p, m as never) as Model<Api>; } catch { continue; }
  }
  throw new Error(`Cannot resolve model: ${provider}/${modelId}`);
}

export function clearProviderCache(): void { _knownProviders = null; }
