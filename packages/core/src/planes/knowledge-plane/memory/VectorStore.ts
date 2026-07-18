/**
 * VectorStore — zvec 向量存储集成
 *
 * 架构:
 *   MemoryEngine.write()
 *     └── VectorStore.index(id, text, tags)
 *           ├── 调用 Embedding Server (POST /embed)
 *           └── zvec.upsertSync({ id, vectors, fields })
 *
 *   MemoryEngine.query({ text })
 *     └── VectorStore.search(text, topK)
 *           ├── 调用 Embedding Server (POST /embed)
 *           └── zvec.querySync({ vector, fieldName, topK }) → ids[]
 *
 * 故障恢复:
 *   见 ZVecLockRecovery.ts — 启动时自动检测并清理残留 LOCK 文件
 *   进程退出时优雅关闭，10s 超时强制释放
 *   初始化失败时降级到内存搜索
 */

import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { recoverZVecLocks } from '../../../../../memory/src/index.js';

const require = createRequire(import.meta.url);

// ── 配置 ──

export interface VectorStoreConfig {
  dataPath: string;
  collectionName: string;
  dimension: number;
  embedUrl: string;
}

export { recoverZVecLocks };

// ═══════════════════════════════════════════════════════════════
// VectorStore
// ═══════════════════════════════════════════════════════════════

export class VectorStore {
  private config: VectorStoreConfig;
  private collection: any = null;
  private zvec: any = null;
  private _ready = false;
  private _shuttingDown = false;

  // ★ P0: Embedding 缓存（LRU）+ 请求去重
  private embedCache = new Map<string, Float32Array>();
  private embedPending = new Map<string, Promise<Float32Array | null>>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly MAX_CACHE_SIZE = 500;

  get cacheStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      size: this.embedCache.size,
    };
  }

  invalidateCache(text?: string): void {
    if (text) {
      this.embedCache.delete(text);
      this.embedPending.delete(text);
    } else {
      this.embedCache.clear();
      this.embedPending.clear();
      this.cacheHits = 0;
      this.cacheMisses = 0;
    }
  }

  constructor(config: Partial<VectorStoreConfig> = {}) {
    this.config = {
      dataPath: config.dataPath ?? './data/zvec',
      collectionName: config.collectionName ?? 'morpex_memory',
      dimension: config.dimension ?? 1024,
      embedUrl: config.embedUrl ?? 'http://localhost:3100',
    };
  }

  get ready(): boolean { return this._ready; }

  async initialize(): Promise<void> {
    const dataPath = path.resolve(this.config.dataPath);

    // Step 1: 清理残留锁文件
    console.log('[VectorStore] 🔍 检查 zvec 锁状态...');
    const { cleaned, warning } = recoverZVecLocks(dataPath);
    if (cleaned > 0) {
      console.log(`[VectorStore] ✅ 已清理 ${cleaned} 个残留文件`);
    }
    for (const w of warning) {
      console.warn(`[VectorStore] ⚠️ ${w}`);
    }

    // Step 1.5: 确保 dataPath 不是文件（修复同名文件导致初始化失败）
    //    注意：不创建目录！ZVecCreateAndOpen 要求路径不存在，由它自己创建。
    try {
      if (fs.existsSync(dataPath)) {
        const stat = fs.statSync(dataPath);
        if (stat.isFile()) {
          console.warn(`[VectorStore] ⚠️ dataPath 是文件而非目录，正在修复: ${dataPath}`);
          fs.unlinkSync(dataPath);
          console.log(`[VectorStore] ✅ 已删除文件（不创建目录，由 zvec 负责）`);
        }
      }
    } catch (fsErr: any) {
      console.warn(`[VectorStore] ⚠️ 无法准备数据目录: ${fsErr.message}`);
    }

    // Step 2: 尝试加载 zvec (先打开已有库，失败则创建)
    try {
      this.zvec = require('@zvec/zvec');

      const schema = new this.zvec.ZVecCollectionSchema({
        name: this.config.collectionName,
        vectors: {
          name: 'embedding',
          dataType: this.zvec.ZVecDataType.VECTOR_FP32,
          dimension: this.config.dimension,
        },
        fields: [
          { name: 'doc_id', dataType: this.zvec.ZVecDataType.STRING },
          { name: 'tags', dataType: this.zvec.ZVecDataType.ARRAY_STRING },
        ],
      });

      // 优先尝试打开已有数据库
      try {
        this.collection = this.zvec.ZVecOpen(dataPath);
        console.log(`[VectorStore] 📂 打开已有向量库: ${dataPath}`);
      } catch (openErr: any) {
        // 打开失败，尝试创建新库
        try {
          this.collection = this.zvec.ZVecCreateAndOpen(dataPath, schema);
          console.log(`[VectorStore] 🆕 创建新向量库: ${dataPath}`);
        } catch (createErr: any) {
          // 创建也失败（路径存在但版本不兼容）→ 备份旧数据，重建
          const backupPath = dataPath + '.backup.' + Date.now();
          console.warn(`[VectorStore] ⚠️ 旧向量库不兼容，备份到: ${path.basename(backupPath)}`);
          try {
            fs.renameSync(dataPath, backupPath);
          } catch (renameErr: any) {
            console.warn(`[VectorStore] ⚠️ 备份失败，删除重建: ${renameErr.message}`);
            fs.rmSync(dataPath, { recursive: true, force: true });
          }
          this.collection = this.zvec.ZVecCreateAndOpen(dataPath, schema);
          console.log(`[VectorStore] 🆕 重建向量库: ${dataPath}`);
        }
      }

      this._ready = true;
      try {
        const docCount = this.collection.stats?.docCount ?? 0;
        console.log(`[VectorStore] ✅ zvec ready`);
        console.log(`  ├─ collection: ${this.config.collectionName}`);
        console.log(`  ├─ dimension:  ${this.config.dimension}`);
        console.log(`  ├─ path:       ${dataPath}`);
        console.log(`  └─ documents:  ${docCount}`);
      } catch { /* stats not critical */ }

      this.registerShutdown();

    } catch (err: any) {
      console.error(`[VectorStore] ❌ zvec init failed: ${err.message}`);
      throw new Error(`VectorStore zvec 初始化失败: ${err.message}`);
    }
  }

  private _shutdownRegistered = false;

  private registerShutdown(): void {
    // 防止重复注册 process.on 监听器
    if (this._shutdownRegistered) return;
    this._shutdownRegistered = true;

    const shutdown = async () => {
      if (this._shuttingDown) return;
      this._shuttingDown = true;
      console.log('[VectorStore] 优雅关闭 zvec (10s 超时)...');
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            if (this.collection) { try { this.collection.closeSync(); } catch {} }
            resolve();
          }),
          new Promise(r => setTimeout(r, 10000)),
        ]);
      } catch {}
      console.log('[VectorStore] zvec 已关闭');
    };

    for (const sig of ['SIGINT', 'SIGTERM', 'SIGQUIT']) {
      try { process.on(sig, shutdown); } catch {}
    }
    try {
      process.on('exit', () => {
        if (this.collection) { try { this.collection.closeSync(); } catch {} }
      });
    } catch {}
  }

  // ── Embedding API ──

  // ★ P0: Embedding 缓存 + 请求去重
  async getEmbedding(text: string): Promise<Float32Array | null> {
    // 缓存命中
    if (this.embedCache.has(text)) {
      this.cacheHits++;
      return this.embedCache.get(text)!;
    }
    // 相同文本的并发请求合并
    if (this.embedPending.has(text)) {
      this.cacheHits++;
      return this.embedPending.get(text)!;
    }
    this.cacheMisses++;
    const promise = this._fetchEmbedding(text);
    this.embedPending.set(text, promise);
    try {
      const vec = await promise;
      if (vec && this.embedCache.size < this.MAX_CACHE_SIZE) {
        this.embedCache.set(text, vec);
      }
      return vec;
    } finally {
      this.embedPending.delete(text);
    }
  }

  /** 实际的 HTTP embedding 调用 */
  private async _fetchEmbedding(text: string): Promise<Float32Array | null> {
    try {
      const resp = await fetch(`${this.config.embedUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as Record<string, any>;
      if (!data.ok || !data.vector) return null;
      return new Float32Array(data.vector);
    } catch { return null; }
  }

  async getEmbeddings(texts: string[]): Promise<Float32Array[] | null> {
    // 优先查缓存，只对未命中部分发起 HTTP 批调用
    const results: (Float32Array | null)[] = new Array(texts.length).fill(null);
    const uncached: string[] = [];
    const uncachedIdx: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.embedCache.get(texts[i]);
      if (cached) {
        results[i] = cached;
        this.cacheHits++;
      } else {
        uncached.push(texts[i]);
        uncachedIdx.push(i);
      }
    }

    if (uncached.length > 0) {
      this.cacheMisses += uncached.length;
      try {
        const resp = await fetch(`${this.config.embedUrl}/embed-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: uncached }),
          signal: AbortSignal.timeout(30000),
        });
        if (resp.ok) {
          const data = await resp.json() as Record<string, any>;
          if (data.ok && data.vectors) {
            for (let j = 0; j < uncached.length; j++) {
              const vec = new Float32Array(data.vectors[j] as number[]);
              results[uncachedIdx[j]] = vec;
              if (this.embedCache.size < this.MAX_CACHE_SIZE) {
                this.embedCache.set(uncached[j], vec);
              }
            }
          }
        }
      } catch { /* batch failed */ }
    }

    // 全部成功则返回，否则 null
    return results.every(r => r !== null) ? (results as Float32Array[]) : null;
  }

  // ── 索引 & 搜索 ──

  async index(id: string, text: string, tags?: string[]): Promise<boolean> {
    if (!this._ready || !this.collection) return false;
    const vec = await this.getEmbedding(text);
    if (!vec) return false;
    try {
      this.collection.upsertSync({
        id,
        vectors: { embedding: vec },
        fields: { doc_id: id, tags: tags || [] },
      });
      return true;
    } catch (err: any) {
      console.warn(`[VectorStore] index failed: ${err.message}`);
      return false;
    }
  }

  async search(text: string, topK: number = 10): Promise<string[]> {
    if (!this._ready || !this.collection) return [];
    const vec = await this.getEmbedding(text);
    if (!vec) return [];
    try {
      const results = this.collection.querySync({
        fieldName: 'embedding',
        vector: vec,
        topk: topK,
        outputFields: ['doc_id'],
      });
      return results.map((r: any) => r.doc_id || r.id);
    } catch (err: any) {
      console.warn(`[VectorStore] search failed: ${err.message}`);
      return [];
    }
  }

  delete(id: string): void {
    if (!this._ready || !this.collection) return;
    try { this.collection.deleteSync(id); } catch {}
  }

  count(): number {
    if (!this._ready || !this.collection) return 0;
    try { return this.collection.stats?.docCount ?? 0; } catch { return 0; }
  }

  close(): void {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    if (this.collection) {
      try {
        console.log('[VectorStore] closing zvec...');
        this.collection.closeSync();
        console.log('[VectorStore] ✅ zvec closed');
      } catch (e: any) {
        console.warn(`[VectorStore] ⚠️ close error: ${e.message}`);
      }
      this.collection = null;
    }
    this._ready = false;
  }
}
