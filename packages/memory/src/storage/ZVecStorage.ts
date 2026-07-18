/**
 * ZVecStorage — zvec 向量持久化存储适配器
 *
 * 实现 MemoryStorageAdapter 接口。
 * 使用 zvec C++ 原生库进行高性能向量索引和相似度搜索。
 */

import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { recoverZVecLocks } from '../vector/ZVecLockRecovery.js';
import { EmbeddingClient } from '../vector/EmbeddingClient.js';
import type { MemoryItem, MemoryQuery, MemoryStorageAdapter } from '../types.js';

const require = createRequire(import.meta.url);

export class ZVecStorage implements MemoryStorageAdapter {
  private collection: any = null;
  private zvec: any = null;
  private embedder: EmbeddingClient;
  private dataPath: string;
  private collectionName: string;
  private dimension: number;
  private _ready = false;

  constructor(config: {
    dataPath?: string;
    collectionName?: string;
    dimension?: number;
    embedUrl?: string;
  }) {
    this.dataPath = path.resolve(config.dataPath || './data/zvec');
    this.collectionName = config.collectionName || 'morpex_memory';
    this.dimension = config.dimension || 1024;
    this.embedder = new EmbeddingClient(config.embedUrl);
  }

  get ready(): boolean { return this._ready; }
  get embedderClient(): EmbeddingClient { return this.embedder; }

  async initialize(): Promise<void> {
    // 0. 确保 dataPath 不是文件（修复 Windows 上同名文件导致初始化失败）
    //    注意：不创建目录！ZVecCreateAndOpen 要求路径不存在，由它自己创建。
    try {
      if (fs.existsSync(this.dataPath)) {
        const stat = fs.statSync(this.dataPath);
        if (stat.isFile()) {
          console.warn(`[Memory:ZVec] ⚠️ dataPath 是文件而非目录，正在修复: ${this.dataPath}`);
          fs.unlinkSync(this.dataPath);
          console.log(`[Memory:ZVec] ✅ 已删除文件（不创建目录，由 zvec 负责）`);
        }
        // 如果是目录，什么都不做（zvec 会打开已存在的数据库）
      }
      // 路径不存在时也不创建 — ZVecCreateAndOpen 会负责
    } catch (fsErr: any) {
      console.warn(`[Memory:ZVec] ⚠️ 无法准备数据目录: ${fsErr.message}`);
    }

    // 1. 清理残留 LOCK
    console.log('[Memory:ZVec] 清理残留锁...');
    const { cleaned, warning } = recoverZVecLocks(this.dataPath);
    if (cleaned > 0) console.log(`[Memory:ZVec] 已清理 ${cleaned} 个 LOCK 文件`);
    for (const w of warning) {
      console.warn(`[Memory:ZVec] ⚠️ ${w}`);
    }

    // 2. 检查嵌入服务（BGE-M3 模型加载约需 12-15 秒，留足够重试时间）
    const embedOk = await this.embedder.healthCheck(10, 2000);
    if (!embedOk) {
      console.warn('[Memory:ZVec] ⚠️ 嵌入服务不可用（等待20秒后仍未就绪），向量搜索将不可用');
      console.warn('[Memory:ZVec]    请确认 Embedding Server 已启动: python tools-python/embedding-server.py --port 3100');
    } else {
      console.log('[Memory:ZVec] 🔗 嵌入服务已连接');
    }

    // 3. 打开 zvec（先尝试打开已有库，失败则创建）
    try {
      this.zvec = require('@zvec/zvec');

      const schema = new this.zvec.ZVecCollectionSchema({
        name: this.collectionName,
        vectors: {
          name: 'embedding',
          dataType: this.zvec.ZVecDataType.VECTOR_FP32,
          dimension: this.dimension,
        },
        fields: [
          { name: 'doc_id', dataType: this.zvec.ZVecDataType.STRING },
          { name: 'mem_type', dataType: this.zvec.ZVecDataType.STRING },
          { name: 'tags', dataType: this.zvec.ZVecDataType.ARRAY_STRING },
          { name: 'importance', dataType: this.zvec.ZVecDataType.INT32 },
        ],
      });

      // 优先尝试打开已有数据库（路径存在且有效）
      try {
        this.collection = this.zvec.ZVecOpen(this.dataPath);
        console.log(`[Memory:ZVec] 📂 打开已有向量库: ${this.dataPath}`);
      } catch (openErr: any) {
        // 打开失败，尝试创建新库
        try {
          this.collection = this.zvec.ZVecCreateAndOpen(this.dataPath, schema);
          console.log(`[Memory:ZVec] 🆕 创建新向量库: ${this.dataPath}`);
        } catch (createErr: any) {
          // 创建也失败（路径存在但版本不兼容）→ 尝试备份旧数据，失败则使用新路径
          // ★ 修复: Windows 上 zvec 可能持有文件句柄导致 rename/rm 失败（EPERM）
          const backupPath = this.dataPath + '.backup.' + Date.now();
          let rebuiltOnNewPath = false;
          console.warn(`[Memory:ZVec] ⚠️ 旧向量库不兼容，尝试备份到: ${path.basename(backupPath)}`);
          try {
            fs.renameSync(this.dataPath, backupPath);
            // 备份成功，在原路径上重建
            this.collection = this.zvec.ZVecCreateAndOpen(this.dataPath, schema);
            console.log(`[Memory:ZVec] 🆕 重建向量库: ${this.dataPath}`);
          } catch (renameErr: any) {
            // ⚠️ Windows 上 rename 可能失败（EPERM），改为使用新路径
            const newPath = this.dataPath + '_' + Date.now();
            console.warn(`[Memory:ZVec] ⚠️ 备份失败: ${renameErr.message}`);
            console.warn(`[Memory:ZVec]    Windows 上使用新路径: ${path.basename(newPath)}`);
            try {
              this.collection = this.zvec.ZVecCreateAndOpen(newPath, schema);
              // 更新 dataPath 指向新路径
              this.dataPath = newPath;
              rebuiltOnNewPath = true;
              console.log(`[Memory:ZVec] 🆕 在新路径创建向量库: ${newPath}`);
            } catch (newPathErr: any) {
              // 新路径也失败 → 跳过 zvec（向量搜索降级）
              console.warn(`[Memory:ZVec] ⚠️ 新路径也失败: ${newPathErr.message}，向量搜索降级`);
              throw newPathErr;
            }
          }
          if (!rebuiltOnNewPath) {
            console.log(`[Memory:ZVec] 🆕 重建向量库: ${this.dataPath}`);
          }
        }
      }
      this._ready = true;

      const count = this.collection.stats?.docCount ?? 0;
      console.log(`[Memory:ZVec] ✅ 向量库就绪: ${count} 条记录`);
    } catch (err: any) {
      console.error(`[Memory:ZVec] ❌ 初始化失败: ${err.message}`);
      throw new Error(`ZVecStorage 初始化失败: ${err.message}`);
    }
  }

  async write(item: MemoryItem): Promise<boolean> {
    if (!this._ready || !this.collection) return false;

    // 获取向量
    const vec = await this.embedder.embed(item.content);
    if (!vec) return false;

    try {
      this.collection.upsertSync({
        id: item.id,
        vectors: { embedding: vec },
        fields: {
          doc_id: item.id,
          mem_type: item.type,
          tags: item.tags,
          importance: item.importance,
        },
      });
      return true;
    } catch (err: any) {
      console.warn(`[Memory:ZVec] 写入失败: ${err.message}`);
      return false;
    }
  }

  async writeMany(items: MemoryItem[]): Promise<number> {
    let written = 0;
    for (const item of items) {
      if (await this.write(item)) written++;
    }
    return written;
  }

  async query(query: MemoryQuery): Promise<MemoryItem[]> {
    if (!this._ready || !this.collection) return [];

    // 文本查询 → 语义搜索
    if (query.text) {
      const vec = await this.embedder.embed(query.text);
      if (!vec) return [];

      const topK = query.limit || 10;
      try {
        const results = this.collection.querySync({
          fieldName: 'embedding',
          vector: vec,
          topk: topK,
          outputFields: ['doc_id', 'mem_type', 'importance'],
        });

        return results.map((r: any) => ({
          id: r.doc_id || r.id,
          type: r.mem_type || 'observation',
          content: '',  // 需要从 JSONL 获取完整内容
          tags: [],
          importance: r.importance || 0,
          createdAt: 0,
          lastAccessedAt: 0,
          accessCount: 0,
        }));
      } catch {
        return [];
      }
    }

    return [];
  }

  async get(id: string): Promise<MemoryItem | undefined> {
    if (!this._ready || !this.collection) return undefined;
    try {
      const results = this.collection.fetchSync(id);
      const doc = results[id];
      if (!doc) return undefined;
      return {
        id: doc.doc_id || id,
        type: doc.mem_type || 'observation',
        content: '',
        tags: doc.tags || [],
        importance: doc.importance || 0,
        createdAt: 0,
        lastAccessedAt: 0,
        accessCount: 0,
      };
    } catch { return undefined; }
  }

  async delete(id: string): Promise<boolean> {
    if (!this._ready || !this.collection) return false;
    try { this.collection.deleteSync(id); return true; }
    catch { return false; }
  }

  async count(): Promise<number> {
    if (!this._ready || !this.collection) return 0;
    try { return this.collection.stats?.docCount ?? 0; }
    catch { return 0; }
  }

  async close(): Promise<void> {
    if (this.collection) {
      try {
        console.log('[Memory:ZVec] 关闭连接...');
        this.collection.closeSync();
        console.log('[Memory:ZVec] ✅ 已关闭');
      } catch (e: any) {
        console.warn(`[Memory:ZVec] 关闭异常: ${e.message}`);
      }
      this.collection = null;
    }
    this._ready = false;
  }
}
