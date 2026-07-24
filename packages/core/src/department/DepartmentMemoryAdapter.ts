/**
 * DepartmentMemoryAdapter — 部门记忆隔离适配器
 *
 * Phase 4.5 / 架构打磨 — P2 修复
 *
 * 在 MemoryWiki 之上加一层部门分区，不修改 MemoryWiki 内部代码。
 *
 * 工作原理：
 *   remember() 时 → 在 data.tags 注入 department_id
 *   recall() 时   → 按 department_id 过滤结果
 *
 * 设计原则：
 *   - 零侵入：不修改 MemoryWiki 一行代码
 *   - 透明降级：MemoryWiki 不可用时使用内存 fallback
 *   - 向后兼容：不传 departmentId = 全局视图
 *
 * 使用方式：
 *   const adapter = new DepartmentMemoryAdapter(memoryWiki);
 *   const wikiWrapper = adapter.createWikiWrapper();
 *   brainFacade.setMemoryWiki(wikiWrapper);
 */

import { DepartmentContext } from './DepartmentContext.js';
import type { DepartmentId } from './types.js';

// ── MemoryWiki 接口（松耦合，不直接 import MemoryWiki） ──

export interface MemoryWikiForAdapter {
  remember(item: { id: string; type: string; name: string; embedding?: number[]; data?: Record<string, unknown>; relations?: Array<{ toId: string; type: string; properties?: Record<string, unknown> }> }): Promise<void>;
  queryByField?(table: string, field: string, value: unknown, options?: { limit?: number; orderBy?: string }): Record<string, unknown>[];
  getRecentEpisodes?(table: string, limit?: number): Record<string, unknown>[];
  queryByTags?(table: string, tags: string[], options?: { limit?: number; orderBy?: string }): Record<string, unknown>[];
  ready?: boolean;
}

// ── DepartmentMemoryAdapter ──

export class DepartmentMemoryAdapter {
  private wiki: MemoryWikiForAdapter | null;

  /** 内存级 fallback（按 departmentId 分区） */
  private fallbackStore: Map<string, Array<{ content: string; timestamp: number; itemType: string }>> = new Map();
  private static readonly MAX_FALLBACK_PER_DEPT = 200;

  constructor(wiki: MemoryWikiForAdapter | null = null) {
    this.wiki = wiki;
  }

  /**
   * setWiki — 注入 MemoryWiki 实例
   */
  setWiki(wiki: MemoryWikiForAdapter | null): void {
    this.wiki = wiki;
  }

  /**
   * partitionRemember — 按部门分区写入记忆
   *
   * 1. 从 DepartmentContext 获取当前 departmentId
   * 2. 注入 department_id 到 item.data
   * 3. 写入 MemoryWiki（如果可用）或 fallback 存储
   *
   * @param item - 记忆条目（type, name, data 为必填）
   * @param departmentId - 可选，覆盖当前的 DepartmentContext
   */
  async partitionRemember(
    item: {
      id: string;
      type: string;
      name: string;
      embedding?: number[];
      data?: Record<string, unknown>;
    },
    departmentId?: DepartmentId,
  ): Promise<void> {
    const deptId = departmentId || DepartmentContext.partitionKey().replace('dept:', '');
    const data = { ...(item.data ?? {}) };

    // 注入 department_id
    data.department_id = deptId;

    // 注入 tags（含 department_id）
    const existingTags = Array.isArray(data.tags) ? [...data.tags] : [];
    const deptTag = `dept:${deptId}`;
    if (!existingTags.includes(deptTag)) {
      existingTags.push(deptTag);
    }
    data.tags = existingTags;

    // 尝试写入 MemoryWiki
    if (this.wiki?.ready !== false && this.wiki) {
      try {
        await this.wiki.remember({
          id: item.id,
          type: item.type,
          name: item.name,
          embedding: item.embedding,
          data,
        });
        return;
      } catch (err) {
        console.warn('[DepartmentMemoryAdapter] MemoryWiki 写入失败，使用 fallback:', (err as Error).message);
      }
    }

    // Fallback: 按部门分区存储到内存
    const deptStore = this.fallbackStore.get(deptId) || [];
    deptStore.push({ content: item.name, timestamp: Date.now(), itemType: item.type });
    // 限制每个部门最大条目
    while (deptStore.length > DepartmentMemoryAdapter.MAX_FALLBACK_PER_DEPT) {
      deptStore.shift();
    }
    this.fallbackStore.set(deptId, deptStore);
  }

  /**
   * partitionRecall — 按部门分区检索记忆
   *
   * @param table - 表名（如 'memory_entries', 'kg_entities'）
   * @param departmentId - 可选，默认为当前 DepartmentContext
   * @returns 该部门的记忆条目
   */
  partitionRecall(
    table: string = 'memory_entries',
    departmentId?: DepartmentId,
  ): Array<Record<string, unknown>> {
    const deptId = departmentId || DepartmentContext.partitionKey().replace('dept:', '');

    // 尝试从 MemoryWiki 查询（通过 tags 过滤 department_id）
    if (this.wiki?.queryByField && this.wiki.ready !== false) {
      try {
        // 策略 1：按 tags 模糊匹配 dept:xxx
        if (this.wiki.queryByTags) {
          const results = this.wiki.queryByTags(table, [`dept:${deptId}`], { limit: 100 });
          if (results.length > 0) return results;
        }

        // 策略 2：按 data_json 模糊匹配 department_id
        const fieldResults = this.wiki.queryByField(table, 'source_id', deptId, { limit: 100 });
        if (fieldResults.length > 0) return fieldResults;
      } catch {
        // 降级到 fallback
      }
    }

    // Fallback: 从内存分区读取
    const deptStore = this.fallbackStore.get(deptId);
    if (deptStore) {
      return deptStore.map(item => ({
        id: `fb_${item.timestamp}`,
        content: item.content,
        type: item.itemType,
        created_at: item.timestamp,
        source: 'fallback',
        department_id: deptId,
      }));
    }

    return [];
  }

  /**
   * partitionSearch — 跨部门文本搜索（CEO 全局视图）
   *
   * @param query - 搜索关键词
   * @param departmentId - 可选，指定部门
   * @returns 匹配的记忆条目
   */
  partitionSearch(query: string, departmentId?: DepartmentId): Array<{ content: string; departmentId: string; timestamp: number }> {
    const results: Array<{ content: string; departmentId: string; timestamp: number }> = [];
    const keyword = query.toLowerCase();

    if (departmentId) {
      // 指定部门：只搜索该部门
      const items = this.partitionRecall('memory_entries', departmentId);
      for (const item of items) {
        const content = String(item.content || item.name || '');
        if (content.toLowerCase().includes(keyword)) {
          results.push({
            content,
            departmentId,
            timestamp: Number(item.created_at ?? item.timestamp ?? Date.now()),
          });
        }
      }
    } else {
      // 全局搜索：搜索所有部门
      for (const [deptId, store] of this.fallbackStore) {
        for (const item of store) {
          if (item.content.toLowerCase().includes(keyword)) {
            results.push({ content: item.content, departmentId: deptId, timestamp: item.timestamp });
          }
        }
      }

      // 也尝试从 MemoryWiki 全局搜索
      if (this.wiki?.ready !== false && this.wiki && this.wiki.queryByField) {
        try {
          const globalResults = this.wiki.queryByField('memory_entries', 'content', `%${query}%`, { limit: 50 });
          for (const item of globalResults) {
            const content = String(item.content ?? '');
            const deptId = String((item.data as Record<string, unknown> as Record<string, string> | undefined)?.department_id ?? (item as Record<string, unknown>).source_id ?? 'global');
            if (content.toLowerCase().includes(keyword)) {
              results.push({
                content,
                departmentId: deptId,
                timestamp: Number(item.created_at ?? Date.now()),
              });
            }
          }
        } catch {
          // 降级
        }
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  }

  /**
   * getMemoriesByDepartment — 获取指定部门的所有记忆
   */
  getMemoriesByDepartment(departmentId: DepartmentId): Array<{ content: string; timestamp: number }> {
    const deptStore = this.fallbackStore.get(departmentId);
    if (deptStore) {
      return deptStore.map(item => ({ content: item.content, timestamp: item.timestamp }));
    }
    return [];
  }

  /**
   * getStats — 获取分区统计
   */
  getStats(): { totalDepartments: number; totalItems: number } {
    let totalItems = 0;
    for (const store of this.fallbackStore.values()) {
      totalItems += store.length;
    }
    return {
      totalDepartments: this.fallbackStore.size,
      totalItems,
    };
  }

  /**
   * createWikiWrapper — 创建包裹式 MemoryWiki 兼容接口
   *
   * 匹配 BrainFacade 的 MemoryWikiLike 接口：
   *   remember(content: string, metadata?: Record): Promise<void>
   *   search(query: string, options?: Record): Promise<Array<{content, score}>>
   *
   * 用于注入到 BrainFacade.setMemoryWiki()。
   * 自动对 remember/search 做部门分区。
   */
  createWikiWrapper(): {
    remember(content: string, metadata?: Record<string, unknown>): Promise<void>;
    search(query: string, options?: Record<string, unknown>): Promise<Array<{ content: string; score: number }>>;
    readonly name: string;
  } {
    const self = this;
    return {
      name: 'DepartmentMemoryAdapter',

      async remember(content: string, metadata?: Record<string, unknown>): Promise<void> {
        const deptId = (metadata?.departmentId as string) || undefined;
        await self.partitionRemember({
          id: `deptmem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: (metadata?.source as string) || 'DepartmentMemory',
          name: content.substring(0, 200),
          data: {
            content,
            ...metadata as Record<string, unknown>,
            timestamp: Date.now(),
          },
        }, deptId);
      },

      async search(query: string, options?: Record<string, unknown>): Promise<Array<{ content: string; score: number }>> {
        const deptId = options?.departmentId as string | undefined;
        const results = self.partitionSearch(query, deptId);
        return results.map(r => ({
          content: r.content,
          score: 1.0,
        }));
      },
    };
  }
}
