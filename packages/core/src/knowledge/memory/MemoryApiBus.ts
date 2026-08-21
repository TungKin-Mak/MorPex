/**
 * memory/MemoryApiBus — 记忆总线 → 统一记忆层（MemoryAPI）适配
 *
 * 收敛碎片：把 MemoryHooks / Agent 侧对记忆的读写统一路由到 MemoryAPI（唯一入口）。
 * - remember（自动写回）→ MemoryApi.rememberEpisode（情景低门槛直写）
 * - recall（上下文注入）→ MemoryApi.query（强制检索 + need_human）
 * 依赖注入：不直接 new，由 bootstrap 装配注入 memoryApi。
 */

import type { MemoryApi, MemoryHit } from '../../infrastructure/adapters/memory/index.js';
import { getSharedDeblackboxRecorder } from '../../infrastructure/observability/deblackbox/DeblackboxRecorder.js';
import type { MemoryBus } from './MemoryHooks.js';
import type { MemoryActivationSource } from './MemoryActivationEngine.js';
import type { MemoryRecord } from './types.js';

export function createMemoryApiBus(memoryApi: MemoryApi): MemoryBus {
  return {
    async remember(params: { content: string; source: string; sourceId: string; tags: string[]; importance: number }): Promise<void> {
      await memoryApi.rememberEpisode(params.content, {
        source: params.source,
        tags: params.tags,
        importance: params.importance,
      });
      // ═══ 去黑盒化（黑盒⑮）：记忆写入审计（L1 永久）——可追溯来源 ═══
      try {
        getSharedDeblackboxRecorder().record({
          category: 'knowledge.write',
          source: 'memory-api-bus',
          executionId: params.sourceId || 'kernel',
          level: 'L1',
          isError: false,
          summary: {
            content: params.content.substring(0, 200),
            contentLength: params.content.length,
            source: params.source,
            sourceId: params.sourceId,
            tags: params.tags,
            importance: params.importance,
            decision: '记忆写入',
            reasoning: `情景记忆写入（来源=${params.source}，重要度=${params.importance}）`,
          },
        });
      } catch (err) {
        console.warn('[MemoryApiBus] ⚠️ 记忆写入审计失败（忽略）:', err instanceof Error ? err.message : String(err));
      }
    },
    async recall(params: { text: string; topK: number }): Promise<string[]> {
      const r = await memoryApi.query({ text: params.text, limit: params.topK });
      return r.hits.map((h) => h.content);
    },
  };
}

/**
 * createMemoryActivationSource — MemoryActivationEngine working 数据源（L7 深水区统一）
 *
 * 把统一记忆层（MemoryAPI）包装成 MemoryActivationSource，由装配层注入引擎：
 * - load(): 从统一层检索 working memories（experience/pattern/error/task）并转 MemoryRecord
 * - available(): 由引擎实例探测（cognee 离线 → false，激活引擎保留现有快照不误清空）
 */
export function createMemoryActivationSource(
  memoryApi: MemoryApi,
  engine?: { available(): Promise<boolean> },
): MemoryActivationSource {
  return {
    async available(): Promise<boolean> {
      try {
        if (engine) return await engine.available();
        return true;
      } catch {
        return false;
      }
    },
    async load(): Promise<MemoryRecord[]> {
      // 工作记忆种子检索：统一层按经验/模式/规则/错误召回（图证据优先，空 → need_human）
      const r = await memoryApi.query({
        text: 'experience pattern rule error',
        domain: 'general',
        scope: 'company',
        limit: 30,
      });
      if (r.need_human) return [];
      return r.hits.map(hitToMemoryRecord).filter(Boolean) as MemoryRecord[];
    },
  };
}

/** MemoryHit → MemoryRecord 转换（type 从 metadata 推断，缺省 experience） */
export function hitToMemoryRecord(h: MemoryHit): MemoryRecord | null {
  const content = h.content?.trim();
  if (!content) return null;
  // cognee 内部工件噪音（TextSummary_/DocumentChunk_ 等）不当作工作记忆
  if (/^(TextSummary|DocumentChunk|Document|Summary|GraphNode|Node)_/i.test(content)) return null;
  const meta = h.metadata ?? {};
  const rawType = String(meta.type ?? meta.entityType ?? 'experience');
  const validTypes: MemoryRecord['type'][] = ['task', 'domain', 'pattern', 'error', 'experience'];
  const type = (validTypes as string[]).includes(rawType)
    ? (rawType as MemoryRecord['type'])
    : 'experience';
  const ts = typeof h.validFrom === 'string' ? Date.parse(h.validFrom) : NaN;
  return {
    id: h.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    type,
    relevanceScore: typeof h.score === 'number' ? h.score : 0.5,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    metadata: meta,
  };
}
