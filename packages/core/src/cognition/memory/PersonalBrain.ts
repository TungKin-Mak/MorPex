/**
 * PersonalBrain — 个人大脑（统一记忆门面）
 *
 * Phase 6 / MorPex v8: 五层记忆体系的统一入口。
 *
 * 记忆分层:
 *   working    — 工作记忆（短期、会话级，30 分钟 TTL）
 *   episodic   — 情景记忆（事件、经历，7 天 TTL）
 *   semantic   — 语义记忆（事实、知识，永久）
 *   preference — 偏好记忆（用户喜好，永久）
 *   workflow   — 工作流记忆（已学流程，永久，委托给 WorkflowMemory）
 *
 * 设计原则:
 *   1. 统一 API 访问所有记忆层
 *   2. 每层可独立查询
 *   3. 跨层联合查询
 *   4. 自动 TTL 过期清理
 *   5. 序列化/反序列化支持持久化
 *
 * 与现有 MemoryWiki 的关系:
 *   - PersonalBrain 是认知层的内存级记忆管理
 *   - MemoryWiki 是持久化后端
 *   - PersonalBrain.toJSON() → MemoryWiki.remember() 实现持久化
 *   - PersonalBrain.fromJSON() ← MemoryWiki.retrieve() 实现恢复
 */

import type {
  MemoryLayer,
  MemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  BrainStats,
  PreferenceMemoryEntry,
  ALL_LAYERS,
} from './types.js';
import { LAYER_TTL } from './types.js';
import { WorkflowMemory } from './WorkflowMemory.js';
import { DecisionMemory } from './DecisionMemory.js';

// ═══════════════════════════════════════════════════════════════
// PersonalBrain
// ═══════════════════════════════════════════════════════════════

export class PersonalBrain {
  /** 五层记忆存储（layer → id → entry） */
  private layers: Map<MemoryLayer, Map<string, MemoryEntry>> = new Map();

  /** 工作流记忆（独立存储层） */
  public workflow: WorkflowMemory;

  /** 决策记忆（semantic 层独立索引） */
  public decision: DecisionMemory;

  /** 清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 初始化 5 层
    for (const layer of ['working', 'episodic', 'semantic', 'preference', 'workflow'] as MemoryLayer[]) {
      this.layers.set(layer, new Map());
    }

    this.workflow = new WorkflowMemory();
    this.decision = new DecisionMemory();

    // 启动自动清理（每 5 分钟清理过期条目）
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * destroy — 销毁 PersonalBrain，释放资源
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 工作记忆（Working Memory）
  // ═══════════════════════════════════════════════════════════

  /**
   * rememberWorking — 记录到工作记忆
   *
   * 工作记忆是短期、会话级的记忆。
   * 会话结束后应调用 clearWorking()。
   *
   * @param content - 记忆内容
   * @param metadata - 扩展元数据
   * @param tags - 标签（可选）
   * @returns 记忆条目 ID
   */
  async rememberWorking(
    content: string,
    metadata?: Record<string, unknown>,
    tags?: string[]
  ): Promise<string> {
    return this.addEntry('working', content, 0.7, 0.9, metadata, tags);
  }

  /**
   * recallWorking — 从工作记忆中检索
   *
   * @param query - 搜索文本
   * @returns 匹配的记忆条目
   */
  recallWorking(query: string): MemoryEntry[] {
    return this.recallFromLayer('working', query);
  }

  /**
   * clearWorking — 清空工作记忆（会话结束时调用）
   */
  clearWorking(): void {
    this.layers.get('working')?.clear();
  }

  // ═══════════════════════════════════════════════════════════
  // 情景记忆（Episodic Memory）
  // ═══════════════════════════════════════════════════════════

  /**
   * recordEpisode — 记录情景记忆
   *
   * 情景记忆用于记录发生过的事件和经历。
   * 例如：用户完成了某个任务、用户遇到了某个问题。
   *
   * @param content - 事件描述
   * @param metadata - 扩展元数据（如 missionId, result 等）
   * @param tags - 标签
   * @returns 记忆条目 ID
   */
  async recordEpisode(
    content: string,
    metadata?: Record<string, unknown>,
    tags?: string[]
  ): Promise<string> {
    return this.addEntry('episodic', content, 0.5, 0.8, metadata, tags);
  }

  /**
   * recallEpisodes — 检索情景记忆
   *
   * @param query - 搜索文本
   * @param limit - 结果数量上限（默认 10）
   */
  recallEpisodes(query: string, limit: number = 10): MemoryEntry[] {
    return this.recallFromLayer('episodic', query, limit);
  }

  // ═══════════════════════════════════════════════════════════
  // 语义记忆（Semantic Memory）
  // ═══════════════════════════════════════════════════════════

  /**
   * storeFact — 存储事实/知识
   *
   * 语义记忆用于存储事实性知识。
   * 例如："用户使用 TypeScript 开发"、"用户偏好 DeepSeek 模型"。
   *
   * @param content - 事实描述
   * @param tags - 标签
   * @returns 记忆条目 ID
   */
  async storeFact(content: string, tags?: string[]): Promise<string> {
    return this.addEntry('semantic', content, 0.6, 0.7, undefined, tags);
  }

  /**
   * recallFacts — 检索语义记忆
   *
   * @param query - 搜索文本
   * @param limit - 结果数量上限（默认 10）
   */
  recallFacts(query: string, limit: number = 10): MemoryEntry[] {
    return this.recallFromLayer('semantic', query, limit);
  }

  // ═══════════════════════════════════════════════════════════
  // 偏好记忆（Preference Memory）
  // ═══════════════════════════════════════════════════════════

  /**
   * storePreference — 存储偏好记忆
   *
   * @param category - 偏好类别（如 technology, communication, work_style）
   * @param key - 偏好键名
   * @param value - 偏好值
   * @param strength - 偏好强度（默认 'moderate'）
   * @returns 记忆条目 ID
   */
  async storePreference(
    category: string,
    key: string,
    value: string,
    strength: 'weak' | 'moderate' | 'strong' = 'moderate'
  ): Promise<string> {
    const now = Date.now();
    const id = `pref_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const entry: PreferenceMemoryEntry = {
      id,
      layer: 'preference',
      content: `Preference: ${category}.${key} = ${value} (${strength})`,
      metadata: { category, key, value, strength },
      importance: strength === 'strong' ? 0.9 : strength === 'moderate' ? 0.6 : 0.3,
      confidence: 0.7,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      tags: ['preference', category, key],
      preference: { category, key, value, strength },
    };

    this.layers.get('preference')!.set(id, entry);
    return id;
  }

  /**
   * getPreferences — 获取偏好记忆
   *
   * @param category - 可选，按类别过滤
   */
  getPreferences(category?: string): PreferenceMemoryEntry[] {
    const prefs = [...this.layers.get('preference')!.values()] as PreferenceMemoryEntry[];
    if (category) {
      return prefs.filter(p => p.preference.category === category);
    }
    return prefs;
  }

  // ═══════════════════════════════════════════════════════════
  // 通用查询
  // ═══════════════════════════════════════════════════════════

  /**
   * recall — 跨层检索记忆
   *
   * @param query - 搜索文本
   * @param layers - 目标层（默认搜索所有层）
   * @param limit - 结果数量上限（默认 10）
   */
  recall(
    query: string,
    layers?: MemoryLayer[],
    limit: number = 10
  ): MemoryEntry[] {
    const targetLayers = layers ?? (['working', 'episodic', 'semantic', 'preference'] as MemoryLayer[]);
    const results: Array<{ entry: MemoryEntry; score: number }> = [];
    const lower = query.toLowerCase();

    for (const layer of targetLayers) {
      if (layer === 'workflow') {
        // Workflow 层通过 WorkflowMemory 查询
        const workflows = this.workflow.findSimilar(query, limit);
        for (const wf of workflows) {
          results.push({ entry: wf, score: 0.5 }); // 简化评分
        }
        continue;
      }

      const entries = this.layers.get(layer);
      if (!entries) continue;

      for (const entry of entries.values()) {
        let score = 0;
        if (entry.content.toLowerCase().includes(lower)) score += 0.8;
        for (const tag of entry.tags) {
          if (tag.toLowerCase().includes(lower)) score += 0.5;
        }
        score *= entry.importance; // 重要性加权
        if (score > 0) {
          results.push({ entry, score });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => {
        r.entry.lastAccessedAt = Date.now();
        r.entry.accessCount++;
        return r.entry;
      });
  }

  /**
   * query — 高级查询
   *
   * @param query - 查询参数
   */
  query(query: MemoryQuery): MemoryQueryResult {
    const entries = this.recall(
      query.text,
      query.layers,
      query.limit
    );

    let filtered = entries;

    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(e =>
        query.tags!.some(t => e.tags.includes(t))
      );
    }

    if (query.minImportance !== undefined) {
      filtered = filtered.filter(e => e.importance >= query.minImportance!);
    }

    if (query.since !== undefined) {
      filtered = filtered.filter(e => e.createdAt >= query.since!);
    }

    if (query.until !== undefined) {
      filtered = filtered.filter(e => e.createdAt <= query.until!);
    }

    return {
      entries: filtered,
      total: filtered.length,
      query,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 记忆管理
  // ═══════════════════════════════════════════════════════════

  /**
   * getEntry — 获取单条记忆
   *
   * @param id - 记忆条目 ID
   */
  getEntry(id: string): MemoryEntry | undefined {
    for (const [, entries] of this.layers) {
      const entry = entries.get(id);
      if (entry) return entry;
    }
    // 也检查 WorkflowMemory
    const wf = this.workflow.getWorkflow(id);
    if (wf) return wf;
    return undefined;
  }

  /**
   * removeEntry — 删除记忆条目
   *
   * @param id - 记忆条目 ID
   */
  removeEntry(id: string): boolean {
    for (const [, entries] of this.layers) {
      if (entries.has(id)) {
        entries.delete(id);
        return true;
      }
    }
    this.workflow.removeWorkflow(id);
    return false;
  }

  /**
   * getLayerSize — 获取指定层的大小
   */
  getLayerSize(layer: MemoryLayer): number {
    if (layer === 'workflow') {
      return this.workflow.getAll().length;
    }
    return this.layers.get(layer)?.size ?? 0;
  }

  /**
   * getStats — 获取大脑统计信息
   */
  getStats(): BrainStats {
    let totalEntries = 0;
    let totalImportance = 0;
    let totalConfidence = 0;
    const byLayer: Record<MemoryLayer, number> = {
      working: 0,
      episodic: 0,
      semantic: 0,
      preference: 0,
      workflow: 0,
    };
    let oldestEntry = Date.now();
    let newestEntry = 0;

    for (const [layer, entries] of this.layers) {
      byLayer[layer] = entries.size;
      totalEntries += entries.size;

      for (const entry of entries.values()) {
        totalImportance += entry.importance;
        totalConfidence += entry.confidence;
        if (entry.createdAt < oldestEntry) oldestEntry = entry.createdAt;
        if (entry.createdAt > newestEntry) newestEntry = entry.createdAt;
      }
    }

    // Workflow layer
    const workflowCount = this.workflow.getAll().length;
    byLayer.workflow = workflowCount;
    totalEntries += workflowCount;

    return {
      totalEntries,
      byLayer,
      totalImportance,
      averageConfidence: totalEntries > 0 ? totalConfidence / totalEntries : 0,
      oldestEntry,
      newestEntry,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * addEntry — 添加记忆条目到指定层
   */
  private async addEntry(
    layer: MemoryLayer,
    content: string,
    importance: number,
    confidence: number,
    metadata?: Record<string, unknown>,
    tags?: string[]
  ): Promise<string> {
    const now = Date.now();
    const id = `mem_${layer}_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const entry: MemoryEntry = {
      id,
      layer,
      content,
      metadata: metadata ?? {},
      importance,
      confidence,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      tags: tags ?? [],
    };

    this.layers.get(layer)!.set(id, entry);
    return id;
  }

  /**
   * recallFromLayer — 从指定层检索记忆
   */
  private recallFromLayer(
    layer: MemoryLayer,
    query: string,
    limit: number = 10
  ): MemoryEntry[] {
    const entries = this.layers.get(layer);
    if (!entries || entries.size === 0) return [];

    const lower = query.toLowerCase();
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of entries.values()) {
      let score = 0;
      if (entry.content.toLowerCase().includes(lower)) score += 1.0;
      for (const tag of entry.tags) {
        if (tag.toLowerCase().includes(lower)) {
          score += 0.6;
          break;
        }
      }
      score *= entry.importance;

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.entry);

    // Update access stats
    for (const entry of results) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;
    }

    return results;
  }

  /**
   * cleanup — 清理过期条目
   *
   * 根据 LAYER_TTL 清理各层的过期条目。
   */
  private cleanup(): void {
    const now = Date.now();

    for (const [layer, entries] of this.layers) {
      const ttl = LAYER_TTL[layer];
      if (ttl === -1) continue; // 永久层

      const cutoff = now - ttl;
      for (const [id, entry] of entries) {
        if (entry.createdAt < cutoff) {
          entries.delete(id);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  /**
   * toJSON — 序列化所有记忆层（除 working 外）
   *
   * working 层不持久化（短期、会话级）。
   */
  toJSON(): Record<string, MemoryEntry[]> {
    const data: Record<string, MemoryEntry[]> = {};

    for (const [layer, entries] of this.layers) {
      if (layer === 'working') continue; // 不持久化工作记忆
      if (entries.size > 0) {
        data[layer] = [...entries.values()];
      }
    }

    // 添加 workflow 和 decision 存储
    data.workflow = this.workflow.toJSON();
    data.decision = this.decision.toJSON();

    return data;
  }

  /**
   * fromJSON — 从序列化数据恢复
   *
   * @param data - 序列化的记忆数据
   */
  fromJSON(data: Record<string, MemoryEntry[]>): void {
    const persistentLayers = ['episodic', 'semantic', 'preference'] as MemoryLayer[];

    for (const layer of persistentLayers) {
      const entries = data[layer];
      if (entries && Array.isArray(entries)) {
        const map = this.layers.get(layer)!;
        for (const entry of entries) {
          map.set(entry.id, entry);
        }
      }
    }

    // 恢复 workflow 记忆
    if (data.workflow) {
      this.workflow.fromJSON(data.workflow as any);
    }

    // 恢复 decision 记忆
    if (data.decision) {
      this.decision.fromJSON(data.decision as any);
    }
  }

  /**
   * clear — 清空所有记忆
   */
  clear(): void {
    for (const [, entries] of this.layers) {
      entries.clear();
    }
    this.workflow.clear();
    this.decision.clear();
  }
}
