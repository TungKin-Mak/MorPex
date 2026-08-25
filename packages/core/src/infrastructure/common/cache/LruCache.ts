/**
 * LruCache — 轻量 LRU 缓存（会话 16l·P1 #2）
 *
 * Map 重插实现：get 时 delete+set 移至尾部（最近使用），
 * 超容量时删除首部（最久未使用）。O(1) 均摊，无双向链表开销。
 * 容量默认 1000，key 由调用方构造（如 `${model}:${text}`）。
 *
 * @packageDocumentation
 */

export class LruCache<K, V> {
  private readonly maxSize: number;
  private readonly map: Map<K, V>;

  constructor(maxSize = 1000) {
    if (maxSize <= 0) throw new Error('[LruCache] maxSize 必须 > 0');
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val === undefined && !this.map.has(key)) return undefined;
    // 移至尾部（最近使用）— 单次 get 已取 val，命中时仅一次哈希
    this.map.delete(key);
    this.map.set(key, val as V);
    return val as V;
  }

  /** peek — 只读不提升 LRU 顺序（用于 has 后取值等场景） */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
