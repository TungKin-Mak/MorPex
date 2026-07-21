/**
 * DecisionMemory — 决策记忆存储
 *
 * Phase 6 / MorPex v8: 存储用户的决策模式，用于预测和推荐。
 *
 * 职责:
 *   1. 存储关键决策记录
 *   2. 分析常见决策因素
 *   3. 按上下文搜索相似决策
 *   4. 为 Planner 提供决策依据
 *
 * 与 PersonalTwinGraph 的关系:
 *   - PersonalTwinGraph 存储决策节点（图谱视角）
 *   - DecisionMemory 存储决策细节（记忆视角）
 *   - DecisionMemory.getCommonFactors() → TwinGraph 的决策画像
 */

import type { DecisionMemoryEntry } from './types.js';

// ═══════════════════════════════════════════════════════════════
// DecisionMemory
// ═══════════════════════════════════════════════════════════════

export class DecisionMemory {
  /** 所有决策记忆（id → DecisionMemoryEntry） */
  private entries: Map<string, DecisionMemoryEntry> = new Map();

  /** 上下文索引（context keyword → entry ids） */
  private contextIndex: Map<string, Set<string>> = new Map();

  // ═══════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * storeDecision — 存储决策记忆
   *
   * @param entry - 决策记忆条目
   */
  async storeDecision(entry: DecisionMemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    this.indexEntry(entry);
  }

  /**
   * getDecision — 获取决策记忆
   *
   * @param id - 决策 ID
   */
  getDecision(id: string): DecisionMemoryEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * removeDecision — 删除决策记忆
   *
   * @param id - 决策 ID
   */
  removeDecision(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.unindexEntry(entry);
  }

  /**
   * getAll — 获取所有决策记忆（按时间降序）
   */
  getAll(): DecisionMemoryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ═══════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════

  /**
   * findSimilar — 按上下文搜索相似决策
   *
   * @param context - 上下文描述
   * @param topK - 返回条数上限
   */
  findSimilar(context: string, topK: number = 5): DecisionMemoryEntry[] {
    const lower = context.toLowerCase();
    const scored: Array<{ entry: DecisionMemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      let score = 0;

      // 上下文内容匹配
      if (entry.decision.context.toLowerCase().includes(lower)) {
        score += 0.8;
      }
      // 选项匹配
      for (const opt of entry.decision.options) {
        if (opt.toLowerCase().includes(lower)) {
          score += 0.4;
          break;
        }
      }
      // 推理内容匹配
      if (entry.decision.reasoning.toLowerCase().includes(lower)) {
        score += 0.3;
      }
      // 因素匹配
      for (const factor of Object.keys(entry.decision.factors)) {
        if (factor.toLowerCase().includes(lower)) {
          score += 0.2;
          break;
        }
      }
      // 标签匹配
      for (const tag of entry.tags) {
        if (tag.toLowerCase().includes(lower)) {
          score += 0.1;
          break;
        }
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.entry);
  }

  /**
   * getByContext — 按上下文关键词搜索决策
   *
   * @param keyword - 上下文关键词
   */
  getByContext(keyword: string): DecisionMemoryEntry[] {
    const lower = keyword.toLowerCase();
    const results: DecisionMemoryEntry[] = [];

    for (const entry of this.entries.values()) {
      if (entry.decision.context.toLowerCase().includes(lower)) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * getCommonFactors — 获取常见决策因素及其出现次数
   *
   * 返回 Map<因素名称, 出现次数>，按次数降序排列。
   */
  getCommonFactors(): Map<string, number> {
    const factorCounts = new Map<string, number>();

    for (const entry of this.entries.values()) {
      for (const [factor] of Object.entries(entry.decision.factors)) {
        const key = factor.toLowerCase().replace(/_/g, ' ');
        factorCounts.set(key, (factorCounts.get(key) || 0) + 1);
      }
    }

    // 按出现次数降序排序
    return new Map(
      [...factorCounts.entries()].sort((a, b) => b[1] - a[1])
    );
  }

  /**
   * getRecentDecisions — 获取最近的决策
   *
   * @param limit - 条数上限（默认 10）
   */
  getRecentDecisions(limit: number = 10): DecisionMemoryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * getDecisionsByOutcome — 按结果分类获取决策
   *
   * @param outcome - 结果描述
   */
  getDecisionsByOutcome(outcome: string): DecisionMemoryEntry[] {
    return [...this.entries.values()]
      .filter(e => e.decision.outcome?.toLowerCase().includes(outcome.toLowerCase()))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * getStats — 获取决策存储统计
   */
  getStats(): { total: number; uniqueFactors: number; topFactors: Array<[string, number]> } {
    const factors = this.getCommonFactors();
    return {
      total: this.entries.size,
      uniqueFactors: factors.size,
      topFactors: [...factors.entries()].slice(0, 10),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 索引维护
  // ═══════════════════════════════════════════════════════════

  private indexEntry(entry: DecisionMemoryEntry): void {
    // 从上下文提取关键词
    const words = entry.decision.context
      .toLowerCase()
      .split(/[\s,.-]+/)
      .filter(w => w.length > 2);

    for (const word of words) {
      if (!this.contextIndex.has(word)) {
        this.contextIndex.set(word, new Set());
      }
      this.contextIndex.get(word)!.add(entry.id);
    }
  }

  private unindexEntry(entry: DecisionMemoryEntry): void {
    const words = entry.decision.context
      .toLowerCase()
      .split(/[\s,.-]+/)
      .filter(w => w.length > 2);

    for (const word of words) {
      this.contextIndex.get(word)?.delete(entry.id);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  /**
   * toJSON — 序列化为 JSON 数组
   */
  toJSON(): DecisionMemoryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * fromJSON — 从 JSON 数组恢复
   *
   * @param entries - 决策记忆条目数组
   */
  fromJSON(entries: DecisionMemoryEntry[]): void {
    this.entries.clear();
    this.contextIndex.clear();

    for (const entry of entries) {
      this.entries.set(entry.id, entry);
      this.indexEntry(entry);
    }
  }

  /**
   * clear — 清空所有数据
   */
  clear(): void {
    this.entries.clear();
    this.contextIndex.clear();
  }
}
