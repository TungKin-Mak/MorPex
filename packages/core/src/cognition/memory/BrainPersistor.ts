/**
 * BrainPersistor — PersonalBrain（内存大脑）持久化桥接
 *
 * 记忆统一入口：优先经 MemoryAPI（统一层，SQLite/cognee 保存），回退旧 MemoryWiki 兼容。
 * - persist  → memoryApi.rememberEpisode（情景低门槛直写统一层）
 * - restore  → 从统一层 query 恢复（按层关键词），或 wiki 兼容
 */
import { PersonalBrain } from './PersonalBrain.js';
import type { MemoryApi } from '../../infrastructure/adapters/memory/index.js';

/** 兼容旧 MemoryWiki 参数（remember 签名宽松，兼容 MemoryWiki.remember(MemoryItem)） */
type WikiLike = { ready: boolean; remember(p: any): Promise<unknown>; getAll?(): Promise<unknown[]> };

type PersistSink = { memoryApi?: MemoryApi; wiki?: WikiLike } | WikiLike;

/** 归一化第二参数：支持 {memoryApi,wiki} 或直接传 wiki 实例（兼容旧调用） */
function normalizeSink(sink: PersistSink | undefined): { memoryApi?: MemoryApi; wiki?: WikiLike } {
  if (!sink) return {};
  if ('ready' in sink) return { wiki: sink as WikiLike };
  return sink as { memoryApi?: MemoryApi; wiki?: WikiLike };
}

export class BrainPersistor {
  static async restore(brain: PersonalBrain, sink?: PersistSink): Promise<void> {
    const { memoryApi, wiki } = normalizeSink(sink);
    if (memoryApi) {
      try {
        const layers = ['episodic', 'semantic', 'preference', 'workflow', 'decision'];
        const data: Record<string, import('./types.js').MemoryEntry[]> = {};
        for (const layer of layers) {
          // 从统一层按层关键词召回（情景/语义层）
          const r = await memoryApi.query({ text: layer, limit: 20 });
          const items = r.hits
            .filter((h) => (h.metadata?.layer as string | undefined) === layer)
            .map((h) => ({
              id: h.id,
              layer: layer as import('./types.js').MemoryLayer,
              content: h.content,
              metadata: h.metadata ?? {},
              importance: 0.5,
              confidence: 0.5,
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
              accessCount: 1,
              tags: [],
            }));
          if (items.length > 0) data[layer] = items;
        }
        if (Object.keys(data).length > 0 && typeof brain.fromJSON === 'function') {
          brain.fromJSON(data);
        }
        return;
      } catch (err: any) {
        console.warn('[BrainPersistor] restore(memoryApi):', err?.message || err);
      }
    }
    if (!wiki || !wiki.ready) return;
    try {
      const data: any = {};
      const layers = ['episodic', 'semantic', 'preference', 'workflow', 'decision'];
      for (const layer of layers) {
        const items = await BrainPersistor.queryLayer(wiki, layer);
        if (items.length > 0) data[layer] = items;
      }
      if (Object.keys(data).length > 0 && typeof brain.fromJSON === 'function') {
        brain.fromJSON(data);
      }
    } catch (err: any) {
      console.warn('[BrainPersistor] restore(wiki):', err?.message || err);
    }
  }

  static async persist(brain: PersonalBrain, sink?: PersistSink): Promise<void> {
    const { memoryApi, wiki } = normalizeSink(sink);
    const data = typeof (brain as { toJSON?: () => Record<string, unknown> }).toJSON === 'function' ? (brain as { toJSON: () => Record<string, unknown> }).toJSON() : {};
    let count = 0;

    // 统一入口：经 MemoryAPI 持久化（SQLite 保存）
    if (memoryApi) {
      try {
        for (const [layer, entries] of Object.entries(data)) {
          if (!Array.isArray(entries)) continue;
          for (const entry of entries) {
            const content = ((entry as { content?: string }).content ?? '').substring(0, 2000);
            if (!content) continue;
            await memoryApi.rememberEpisode(content, {
              source: 'brain',
              tags: ['brain', layer],
              dataset: 'company',
            });
            count++;
          }
        }
        console.log(`[BrainPersistor] 已经统一记忆层持久化 ${count} 条`);
        return;
      } catch (err: any) {
        console.warn('[BrainPersistor] persist(memoryApi):', err?.message || err);
      }
    }

    if (!wiki || !wiki.ready) return;
    try {
      for (const [layer, entries] of Object.entries(data)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          await wiki.remember({
            id: 'brain:' + layer + ':' + (entry as { id?: string }).id,
            type: 'brain_memory',
            name: ((entry as { content?: string }).content || '').substring(0, 200),
            data: entry,
            relations: [],
          });
          count++;
        }
      }
      console.log('[BrainPersistor] Persisted ' + count + ' entries (wiki)');
    } catch (err: any) {
      console.warn('[BrainPersistor] persist(wiki):', err?.message || err);
    }
  }

  private static async queryLayer(wiki: WikiLike, layer: string): Promise<any[]> {
    try {
      const prefix = 'brain:' + layer + ':';
      if (typeof wiki.getAll === 'function') {
        const all = await wiki.getAll();
        if (Array.isArray(all)) {
          return all.filter((i: any) => i.id && i.id.startsWith(prefix)).map((i: any) => i.data || i);
        }
      }
    } catch {}
    return [];
  }
}
