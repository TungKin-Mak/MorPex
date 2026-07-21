/**
 * WorkflowMemory — 工作流记忆存储
 *
 * Phase 6 / MorPex v8: 从已完成 Mission 中提取和存储工作流模式。
 *
 * 职责:
 *   1. 存储已学习的工作流模式
 *   2. 从 Mission 中自动提取工作流
 *   3. 按名称/领域搜索相似工作流
 *   4. 序列化/反序列化（持久化用）
 *
 * 与 PersonalTwinGraph 的关系:
 *   - PersonalTwinGraph 存储工作流节点（图谱视角）
 *   - WorkflowMemory 存储工作流的执行细节（记忆视角）
 *   - 两者互补: TwinGraph 回答"有什么"，Memory 回答"怎么执行"
 */

import type { WorkflowMemoryEntry, MemoryEntry } from './types.js';

// ═══════════════════════════════════════════════════════════════
// WorkflowMemory
// ═══════════════════════════════════════════════════════════════

export class WorkflowMemory {
  /** 所有工作流记忆（id → WorkflowMemoryEntry） */
  private entries: Map<string, WorkflowMemoryEntry> = new Map();

  /** 名称索引（name → entry ids） */
  private nameIndex: Map<string, Set<string>> = new Map();

  /** 领域索引（domain → entry ids） */
  private domainIndex: Map<string, Set<string>> = new Map();

  /** 频率索引（frequency → entry ids） */
  private frequencyIndex: Map<string, Set<string>> = new Map();

  // ═══════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * storeWorkflow — 存储工作流记忆
   *
   * @param entry - 工作流记忆条目
   */
  async storeWorkflow(entry: WorkflowMemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    this.indexEntry(entry);
  }

  /**
   * getWorkflow — 获取工作流记忆
   *
   * @param id - 工作流 ID
   */
  getWorkflow(id: string): WorkflowMemoryEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * removeWorkflow — 删除工作流记忆
   *
   * @param id - 工作流 ID
   */
  removeWorkflow(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.unindexEntry(entry);
  }

  /**
   * getAll — 获取所有工作流记忆
   */
  getAll(): WorkflowMemoryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ═══════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════

  /**
   * findSimilar — 按名称或领域搜索相似工作流
   *
   * @param nameOrDomain - 名称或领域关键词
   * @param topK - 返回条数上限
   */
  findSimilar(nameOrDomain: string, topK: number = 5): WorkflowMemoryEntry[] {
    const lower = nameOrDomain.toLowerCase();
    const scored: Array<{ entry: WorkflowMemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      let score = 0;

      // 名称精确匹配
      if (entry.workflow.name.toLowerCase() === lower) {
        score += 1.0;
      }
      // 名称部分匹配
      else if (entry.workflow.name.toLowerCase().includes(lower)) {
        score += 0.7;
      }
      // 领域匹配
      if (entry.workflow.domain?.toLowerCase().includes(lower)) {
        score += 0.5;
      }
      // 步骤内容匹配
      for (const step of entry.workflow.steps) {
        if (step.toLowerCase().includes(lower)) {
          score += 0.3;
          break;
        }
      }
      // 工具匹配
      for (const tool of entry.workflow.tools) {
        if (tool.toLowerCase().includes(lower)) {
          score += 0.2;
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
   * getByFrequency — 按频率获取工作流
   *
   * @param frequency - 频率类型
   */
  getByFrequency(frequency: WorkflowMemoryEntry['workflow']['frequency']): WorkflowMemoryEntry[] {
    const ids = this.frequencyIndex.get(frequency);
    if (!ids || ids.size === 0) return [];
    return [...ids]
      .map(id => this.entries.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * getByDomain — 按领域获取工作流
   *
   * @param domain - 领域名称
   */
  getByDomain(domain: string): WorkflowMemoryEntry[] {
    const ids = this.domainIndex.get(domain.toLowerCase());
    if (!ids || ids.size === 0) return [];
    return [...ids]
      .map(id => this.entries.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * getLowConfidence — 获取低置信度工作流（需要人工确认）
   *
   * @param threshold - 置信度阈值（默认 0.5）
   */
  getLowConfidence(threshold: number = 0.5): WorkflowMemoryEntry[] {
    return [...this.entries.values()]
      .filter(e => e.confidence < threshold)
      .sort((a, b) => a.confidence - b.confidence);
  }

  /**
   * getStats — 获取工作流存储统计
   */
  getStats(): { total: number; byFrequency: Record<string, number>; byDomain: Record<string, number> } {
    const byFrequency: Record<string, number> = {};
    const byDomain: Record<string, number> = {};

    for (const entry of this.entries.values()) {
      byFrequency[entry.workflow.frequency] = (byFrequency[entry.workflow.frequency] || 0) + 1;
      const domain = entry.workflow.domain || 'unknown';
      byDomain[domain] = (byDomain[domain] || 0) + 1;
    }

    return {
      total: this.entries.size,
      byFrequency,
      byDomain,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 索引维护
  // ═══════════════════════════════════════════════════════════

  private indexEntry(entry: WorkflowMemoryEntry): void {
    // 名称索引
    const nameLower = entry.workflow.name.toLowerCase();
    if (!this.nameIndex.has(nameLower)) {
      this.nameIndex.set(nameLower, new Set());
    }
    this.nameIndex.get(nameLower)!.add(entry.id);

    // 领域索引
    if (entry.workflow.domain) {
      const domainLower = entry.workflow.domain.toLowerCase();
      if (!this.domainIndex.has(domainLower)) {
        this.domainIndex.set(domainLower, new Set());
      }
      this.domainIndex.get(domainLower)!.add(entry.id);
    }

    // 频率索引
    const freq = entry.workflow.frequency;
    if (!this.frequencyIndex.has(freq)) {
      this.frequencyIndex.set(freq, new Set());
    }
    this.frequencyIndex.get(freq)!.add(entry.id);
  }

  private unindexEntry(entry: WorkflowMemoryEntry): void {
    const nameLower = entry.workflow.name.toLowerCase();
    this.nameIndex.get(nameLower)?.delete(entry.id);
    if (entry.workflow.domain) {
      const domainLower = entry.workflow.domain.toLowerCase();
      this.domainIndex.get(domainLower)?.delete(entry.id);
    }
    this.frequencyIndex.get(entry.workflow.frequency)?.delete(entry.id);
  }

  // ═══════════════════════════════════════════════════════════
  // 从 Mission 提取工作流（暂存，Phase 7 完整实现）
  // ═══════════════════════════════════════════════════════════

  /**
   * extractFromMission — 从 Mission 结果中提取工作流
   *
   * 当前为简化实现: 从 Mission Plan 的步骤生成工作流。
   * Phase 7 Workflow Intelligence 将提供更复杂的提取逻辑。
   *
   * @param missionId - Mission ID
   * @param goal - Mission 目标
   * @param steps - 执行步骤列表
   * @param domain - 领域（可选）
   */
  async extractFromMission(
    missionId: string,
    goal: string,
    steps: string[],
    domain?: string
  ): Promise<WorkflowMemoryEntry | null> {
    if (!steps || steps.length === 0) return null;

    // 检查是否已有相似工作流
    const similar = this.findSimilar(goal, 1);
    if (similar.length > 0) {
      // 更新已有工作流（增加置信度）
      const existing = similar[0];
      existing.workflow.sourceMissions.push(missionId);
      existing.workflow.frequency = 'occasional';
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      existing.lastAccessedAt = Date.now();
      existing.accessCount++;
      return existing;
    }

    // 创建新工作流
    const now = Date.now();
    const entry: WorkflowMemoryEntry = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 8)}`,
      layer: 'workflow',
      content: `Workflow: ${goal}`,
      metadata: { extractedFrom: missionId },
      importance: 0.6,
      confidence: 0.4,  // 初始置信度较低，需要多次确认
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      tags: domain ? ['workflow', domain] : ['workflow'],
      workflow: {
        name: goal.substring(0, 80),
        steps,
        domain,
        tools: [],
        frequency: 'once',
        sourceMissions: [missionId],
      },
    };

    await this.storeWorkflow(entry);
    return entry;
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  /**
   * toJSON — 序列化为 JSON 数组
   */
  toJSON(): WorkflowMemoryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * fromJSON — 从 JSON 数组恢复
   *
   * @param entries - 工作流记忆条目数组
   */
  fromJSON(entries: WorkflowMemoryEntry[]): void {
    this.entries.clear();
    this.nameIndex.clear();
    this.domainIndex.clear();
    this.frequencyIndex.clear();

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
    this.nameIndex.clear();
    this.domainIndex.clear();
    this.frequencyIndex.clear();
  }
}
