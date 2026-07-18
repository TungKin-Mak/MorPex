/**
 * VectorStoreAdapter — VectorStore 的 MemoryBus 适配器
 *
 * 连接 v2.4 MemoryHooks（自动写回 + 推理注入）与现有 VectorStore（zvec 向量存储）。
 * 实现 MemoryBus 接口，使记忆系统能够统一工作。
 *
 * 使用方式：
 *   const vectorStore = new VectorStore(config);
 *   await vectorStore.initialize();
 *   const adapter = new VectorStoreAdapter(vectorStore);
 *   harness.subscribe(createAutoMemoryHook(adapter, executionId));
 *   harness.on('context', createReasoningMemoryHook(adapter));
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 基于已有类型，不重复定义
 *   0.4 (删除优先法则): 不重写 VectorStore，只做适配
 */

import type { MemoryBus } from './MemoryHooks.js';
import { VectorStore } from '../planes/knowledge-plane/memory/VectorStore.js';

/**
 * VectorStoreAdapter — MemoryBus 的 VectorStore 实现
 *
 * 将 VectorStore 的 index/search 适配为 MemoryBus 的 remember/recall。
 * 兼容 zvec 向量存储的 doc_id + tags 字段结构。
 */
export class VectorStoreAdapter implements MemoryBus {
  private store: VectorStore;

  constructor(store: VectorStore) {
    this.store = store;
  }

  /**
   * remember — 写入记忆到向量存储
   *
   * 将对话/执行内容索引到 zvec 向量库，
   * 供后续语义检索使用。
   */
  async remember(params: {
    content: string;
    source: string;
    sourceId: string;
    tags: string[];
    importance: number;
  }): Promise<void> {
    if (!this.store.ready) {
      console.warn('[VectorStoreAdapter] VectorStore 未就绪，跳过记忆写入');
      return;
    }

    const id = params.sourceId || `mem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    try {
      await this.store.index(id, params.content, params.tags);
    } catch (err: any) {
      console.error('[VectorStoreAdapter] 记忆写入失败:', err.message);
    }
  }

  /**
   * recall — 从向量存储检索相关记忆
   *
   * 将用户查询向量化后检索最相似的 topK 条记忆。
   *
   * @returns 记忆文本数组（按相似度排序）
   */
  async recall(params: {
    text: string;
    topK: number;
  }): Promise<string[]> {
    if (!this.store.ready) {
      console.warn('[VectorStoreAdapter] VectorStore 未就绪，跳过记忆检索');
      return [];
    }

    try {
      return await this.store.search(params.text, params.topK);
    } catch (err: any) {
      console.error('[VectorStoreAdapter] 记忆检索失败:', err.message);
      return [];
    }
  }

  /**
   * isReady — 检查底层 VectorStore 是否就绪
   */
  get isReady(): boolean {
    return this.store.ready;
  }
}

/**
 * createMemoryBus — 创建 MemoryBus 实例（便捷工厂）
 *
 * 如果 VectorStore 可用，返回 VectorStoreAdapter；
 * 否则返回 null，调用方应优雅降级（记忆系统不工作但系统正常运行）。
 *
 * @param config - VectorStore 配置，可选。不传返回 fallback（null）
 * @returns MemoryBus 实例或 null
 */
export async function createMemoryBus(
  vectorStore?: VectorStore,
): Promise<MemoryBus | null> {
  if (!vectorStore) {
    console.warn('[createMemoryBus] 未提供 VectorStore，记忆系统不工作');
    return null;
  }

  // 确保 VectorStore 已初始化
  if (!vectorStore.ready) {
    try {
      await vectorStore.initialize();
    } catch (err: any) {
      console.warn('[createMemoryBus] VectorStore 初始化失败:', err.message);
      return null;
    }
  }

  return new VectorStoreAdapter(vectorStore);
}
