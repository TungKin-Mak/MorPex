/**
 * prefetch — F13 本义预取钩子（执行前预取高频实体）
 *
 * 插入点：MorPexRuntime Phase 1.7 → Phase 2 交界（意图已明确后、上下文装配/执行前）
 * 策略：对目标文本做 Promise.all 预热，使后续 retrieveRelevant/rerank/assemble 命中 LruCache/inflight 缓存
 * 约束：零新依赖、单钩子、带超时与失败静默，不阻塞主流程
 * @packageDocumentation
 */
import type { ContextAssemblyEngine } from './ContextAssemblyEngine.js';

export interface PrefetchOptions {
  goal: string;
  domain?: string;
  missionId: string;
  /** 超时毫秒，默认 1500 */
  timeoutMs?: number;
}

/**
 * 执行前预取：预热上下文装配所需的检索路径
 * - 触发 AssembledContext 的检索（Dense+BM25）缓存
 * - 通过 LruCache/inflight 使后续真实 assemble 命中
 * - 超时或失败静默（不阻断执行）
 */
export async function prefetchHighFrequencyEntities(
  engine: ContextAssemblyEngine | null,
  opts: PrefetchOptions,
): Promise<{ hit: boolean; duration: number }> {
  if (!engine) return { hit: false, duration: 0 };
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 1500;

  // 构造与 MorPexRuntime assemble 调用等价的 key，使缓存命中（复用 ContextAssemblyEngine inflight 去重）
  const task = { taskId: opts.missionId };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('prefetch timeout')), timeoutMs);
    // 不阻塞进程退出
    (timer as unknown as { unref?: () => void })?.unref?.();
  });

  try {
    const result = await Promise.race([
      engine.assemble({
        missionId: opts.missionId,
        goal: opts.goal,
        domain: opts.domain,
        currentTask: task as never,
      }),
      timeoutPromise,
    ]);
    // 命中判定：需至少一个真实 Provider 片段或召回摘要（仅 focusedSummary / fallback 片段不算命中，防空上下文误判）
    const r = result as {
      focusedSummary?: string;
      fragments?: Array<{ attribution?: { providerType?: string } }>;
      providerAttribution?: Array<{ providerType?: string }>;
      recentSummaries?: unknown[];
    } | null | undefined;
    const hasRegisteredFragment =
      (Array.isArray(r?.providerAttribution) && r.providerAttribution.some(a => a.providerType === 'registered')) ||
      (Array.isArray(r?.fragments) && r.fragments.some(f => f.attribution?.providerType === 'registered'));
    const hasRecentSummaries = Array.isArray(r?.recentSummaries) && r.recentSummaries.length > 0;
    const hit = !!(r && (hasRegisteredFragment || hasRecentSummaries));
    return { hit, duration: Date.now() - start };
  } catch (err) {
    console.warn('[prefetch] 异常:', err);
    return { hit: false, duration: Date.now() - start };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
