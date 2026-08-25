/**
 * inflight — 通用在飞去重 helper（P1 #2 抽取）
 * 三处（EmbeddingProvider / Reranker / ContextAssemblyEngine）同构，抽取避免重复。
 * 调用方传入 Map 与 key，factory 仅在无在飞时执行；finally 清理防泄漏。
 * @packageDocumentation
 */
export async function withInflight<K, V>(
  inflight: Map<K, Promise<V>>,
  key: K,
  factory: () => Promise<V>,
): Promise<V> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = factory();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
