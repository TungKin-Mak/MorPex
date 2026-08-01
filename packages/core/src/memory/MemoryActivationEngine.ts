/**
 * MemoryActivationEngine — 记忆激活引擎
 *
 * 根据当前状态、任务和执行上下文，
 * 主动从 Memory Store 检索最相关的记忆并注入 Agent 上下文。
 *
 * 支持：
 * - state-aware recall  — 根据执行状态检索
 * - task-aware recall   — 根据任务目标检索
 * - execution-aware recall — 根据执行历史和模式检索
 */

import type { MemoryRecord } from '../agent/harness/types.js';

export interface ActivationContext {
  /** 当前执行状态 */
  executionStatus: string;
  /** 当前任务目标 */
  goal: string;
  /** 当前步骤 */
  currentStep: number;
  /** 总步骤 */
  totalSteps: number;
  /** 已完成的步骤 */
  completedSteps: string[];
  /** 遇到的错误 */
  errors: string[];
  /** 领域/上下文标签 */
  tags: string[];
}

export interface ActivationResult {
  memories: MemoryRecord[];
  contextBias: string;
  activationScore: number;
  /** 各维度的激活分数明细 */
  scores: {
    stateRelevance: number;
    taskRelevance: number;
    executionRelevance: number;
    recency: number;
    frequency: number;
  };
}

/**
 * MemoryActivationSource — working memory 数据源（L7 深水区统一）
 *
 * 由装配层从统一记忆层（MemoryAPI/cognee）注入，替代手动 addMemory 填充。
 * 引擎保持同步 activate()，数据新鲜度由 refresh() 异步拉快照保证。
 */
export interface MemoryActivationSource {
  /** 从统一层拉取 working memories 快照（离线/无证据 → 空数组，不抛） */
  load(): Promise<MemoryRecord[]>;
  /** 数据源可用性（MemoryAPI/cognee 在线） */
  available(): Promise<boolean>;
}

export class MemoryActivationEngine {
  private memoryStore: MemoryRecord[] = [];
  private source: MemoryActivationSource | null = null;
  private _lastRefreshedAt: number | null = null;

  /** 注册记忆存储（直接注入数组，测试/兼容用） */
  setMemoryStore(store: MemoryRecord[]): void { this.memoryStore = store; }

  /** 添加记忆到存储 */
  addMemory(memory: MemoryRecord): void { this.memoryStore.push(memory); }

  /** 添加批量记忆 */
  addMemories(memories: MemoryRecord[]): void { this.memoryStore.push(...memories); }

  /** 装配层注入数据源（统一记忆层 MemoryAPI-backed） */
  setSource(source: MemoryActivationSource): void { this.source = source; }

  /**
   * 从数据源拉取 working memory 快照（L7 统一：数据源由装配层注入）
   * - 数据源离线 → 保留现有快照，返回 available=false（不抛、不清空）
   * - 在线 → 以最新快照替换内存存储
   */
  async refresh(): Promise<{ loaded: number; available: boolean }> {
    if (!this.source) return { loaded: 0, available: false };
    let available = false;
    try { available = await this.source.available(); } catch { /* 探测失败视为离线 */ }
    if (!available) return { loaded: 0, available: false };
    try {
      const records = await this.source.load();
      this.memoryStore = records;
      this._lastRefreshedAt = Date.now();
      return { loaded: records.length, available: true };
    } catch {
      return { loaded: 0, available: false };
    }
  }

  /** 数据源可用性探测（离线时 false） */
  async isSourceAvailable(): Promise<boolean> {
    if (!this.source) return false;
    try { return await this.source.available(); } catch { return false; }
  }

  /** 最近一次 refresh 成功时间（未 refresh 过为 null） */
  get lastRefreshedAt(): number | null { return this._lastRefreshedAt; }

  /** 根据上下文激活记忆 */
  activate(context: ActivationContext, topK: number = 5): ActivationResult {
    const scored = this.memoryStore.map(memory => {
      const stateRelevance = this.calcStateRelevance(memory, context);
      const taskRelevance = this.calcTaskRelevance(memory, context);
      const executionRelevance = this.calcExecutionRelevance(memory, context);
      const recency = this.calcRecency(memory);
      const frequency = this.calcFrequency(memory);

      const totalScore =
        stateRelevance * 0.25 +
        taskRelevance * 0.30 +
        executionRelevance * 0.20 +
        recency * 0.15 +
        frequency * 0.10;

      return { memory, score: totalScore, scores: { stateRelevance, taskRelevance, executionRelevance, recency, frequency } };
    });

    scored.sort((a, b) => b.score - a.score);
    const topMemories = scored.slice(0, topK);

    const avgScore = topMemories.length > 0
      ? topMemories.reduce((s, r) => s + r.score, 0) / topMemories.length
      : 0;

    // 生成 context bias
    const contextBias = this.generateContextBias(topMemories, context);

    return {
      memories: topMemories.map(r => r.memory),
      contextBias,
      activationScore: avgScore,
      scores: topMemories.length > 0 ? topMemories[0].scores : { stateRelevance: 0, taskRelevance: 0, executionRelevance: 0, recency: 0, frequency: 0 },
    };
  }

  /** 状态感知检索：匹配最近的执行状态 */
  private calcStateRelevance(memory: MemoryRecord, context: ActivationContext): number {
    let score = 0;

    // 记忆类型与当前状态匹配
    if (context.errors.length > 0 && memory.type === 'error') score += 0.5;
    if (context.executionStatus === 'running' && memory.type === 'experience') score += 0.3;

    // 记忆内容包含当前状态关键词
    const statusKeywords = context.executionStatus.split('_');
    for (const kw of statusKeywords) {
      if (memory.content.toLowerCase().includes(kw.toLowerCase())) score += 0.1;
    }

    return Math.min(1, score);
  }

  /** 任务感知检索：匹配任务目标 */
  private calcTaskRelevance(memory: MemoryRecord, context: ActivationContext): number {
    let score = 0;

    // 目标关键词匹配
    const goalWords = context.goal.toLowerCase().split(/\s+/);
    for (const word of goalWords) {
      if (word.length < 3) continue;
      if (memory.content.toLowerCase().includes(word)) score += 0.1;
      if (memory.type === 'domain') score += 0.05;
    }

    // 标签匹配
    for (const tag of context.tags) {
      if (memory.metadata?.tags?.includes(tag)) score += 0.15;
    }

    return Math.min(1, score);
  }

  /** 执行感知检索：匹配执行历史和模式 */
  private calcExecutionRelevance(memory: MemoryRecord, context: ActivationContext): number {
    let score = 0;

    // 完成的步骤相关
    for (const step of context.completedSteps) {
      if (memory.content.toLowerCase().includes(step.toLowerCase())) score += 0.1;
    }

    // 当前步骤相关
    if (memory.metadata?.step !== undefined && memory.metadata.step === context.currentStep) score += 0.3;

    // 错误恢复模式
    if (context.errors.length > 0) {
      for (const err of context.errors) {
        if (memory.content.includes(err)) score += 0.2;
      }
    }

    return Math.min(1, score);
  }

  /** 时效性评分 */
  private calcRecency(memory: MemoryRecord): number {
    const ageMs = Date.now() - memory.timestamp;
    const ageHours = ageMs / (1000 * 3600);
    // 指数衰减：24小时内高分，1周后低分
    return Math.exp(-ageHours / 168); // 168小时 = 1周
  }

  /** 使用频率评分 */
  private calcFrequency(_memory: MemoryRecord): number {
    // 简化版：基于 relevanceScore 作为频率指标
    return _memory.relevanceScore;
  }

  /** 生成上下文偏差提示 */
  private generateContextBias(topResults: Array<{ memory: MemoryRecord; score: number }>, context: ActivationContext): string {
    if (topResults.length === 0) return 'No relevant memories found.';

    const parts: string[] = [];
    parts.push(`Found ${topResults.length} relevant memories (avg score: ${(topResults.reduce((s, r) => s + r.score, 0) / topResults.length).toFixed(2)}).`);

    const errorMemories = topResults.filter(r => r.memory.type === 'error');
    if (errorMemories.length > 0) {
      parts.push(`⚠️ ${errorMemories.length} error-related memories activated — review before proceeding.`);
    }

    const experienceMemories = topResults.filter(r => r.memory.type === 'experience');
    if (experienceMemories.length > 0) {
      const patterns = experienceMemories.map(r => r.memory.content.substring(0, 50)).join('; ');
      parts.push(`📋 Previous experiences: ${patterns}`);
    }

    const taskMemories = topResults.filter(r => r.memory.type === 'task');
    if (taskMemories.length > 0) {
      parts.push(`🎯 Task patterns detected: Consider following proven approaches.`);
    }

    return parts.join(' ');
  }

  /** 获取存储中的记忆数量 */
  get memoryCount(): number { return this.memoryStore.length; }

  /** 清除存储 */
  clear(): void { this.memoryStore = []; }
}
