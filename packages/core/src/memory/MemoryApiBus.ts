/**
 * memory/MemoryApiBus — 记忆总线 → 统一记忆层（MemoryAPI）适配
 *
 * 收敛碎片：把 MemoryHooks / Agent 侧对记忆的读写统一路由到 MemoryAPI（唯一入口）。
 * - remember（自动写回）→ MemoryApi.rememberEpisode（情景低门槛直写）
 * - recall（上下文注入）→ MemoryApi.query（强制检索 + need_human）
 * 依赖注入：不直接 new，由 bootstrap 装配注入 memoryApi。
 */

import type { MemoryApi } from '../adapters/memory/index.js';
import type { MemoryBus } from './MemoryHooks.js';

export function createMemoryApiBus(memoryApi: MemoryApi): MemoryBus {
  return {
    async remember(params: { content: string; source: string; sourceId: string; tags: string[]; importance: number }): Promise<void> {
      await memoryApi.rememberEpisode(params.content, {
        source: params.source,
        tags: params.tags,
        importance: params.importance,
      });
    },
    async recall(params: { text: string; topK: number }): Promise<string[]> {
      const r = await memoryApi.query({ text: params.text, limit: params.topK });
      return r.hits.map((h) => h.content);
    },
  };
}
