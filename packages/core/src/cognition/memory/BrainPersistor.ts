/**
 * BrainPersistor — PersonalBrain ↔ MemoryWiki 桥接
 */
import { PersonalBrain } from './PersonalBrain.js';

export class BrainPersistor {
  static async restore(brain: any, wiki: any): Promise<void> {
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
      console.warn('[BrainPersistor] restore:', err?.message || err);
    }
  }

  static async persist(brain: any, wiki: any): Promise<void> {
    if (!wiki || !wiki.ready) return;
    try {
      const data = typeof brain.toJSON === 'function' ? brain.toJSON() : {};
      let count = 0;
      for (const [layer, entries] of Object.entries(data)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          await wiki.remember({
            id: 'brain:' + layer + ':' + (entry as any).id,
            type: 'brain_memory',
            name: ((entry as any).content || '').substring(0, 200),
            data: entry,
            relations: [],
          });
          count++;
        }
      }
      console.log('[BrainPersistor] Persisted ' + count + ' entries');
    } catch (err: any) {
      console.warn('[BrainPersistor] persist:', err?.message || err);
    }
  }

  private static async queryLayer(wiki: any, layer: string): Promise<any[]> {
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
