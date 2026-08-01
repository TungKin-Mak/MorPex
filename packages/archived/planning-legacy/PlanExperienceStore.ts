/**
 * PlanExperienceStore — 计划经验持久化存储
 *
 * 职责：
 *   1. 持久化 PlanExecutionRecord（每次 orchestrate 完成后）
 *   2. 持久化 PlanTemplate（从高分执行中提炼）
 *   3. 按标签/关键词检索历史记录
 *   4. 相似度匹配（基于标签 Jaccard + 文本关键词）
 *   5. 统计聚合（失败模式、耗时趋势、Token 趋势）
 *
 * 存储格式：
 *   experiences/plan-records.jsonl     — 执行记录（一行一 JSON）
 *   experiences/plan-templates.jsonl   — 计划模板
 *   experiences/plan-metrics.jsonl     — 聚合指标快照
 *
 * 设计约束：
 *   - 完全异步非阻塞 I/O（fs.promises）
 *   - JSONL 格式兼容现有 JSONLStorage
 *   - 内存索引加速查询
 *   - 不支持删除（append-only），通过 maxRecords 滚动
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ExperienceExtractor } from '../../learning/ExperienceExtractor.js';
import { PlanEvaluator } from '../../learning/PlanEvaluator.js';
import { StrategyOptimizer } from '../../learning/StrategyOptimizer.js';
import { TemplateEvolutionEngine } from '../../learning/TemplateEvolutionEngine.js';
import { MemoryWiki } from '../../../../memory/src/index.js';
import type {
  PlanExecutionRecord,
  PlanTemplate,
  PlanMatchResult,
  PlanAdjustment,
  PlanNodeSkeleton,
  DAGNodeRecord,
  FailureDetail,
  FailureCategory,
  MetaPlannerConfig,
} from './types.js';
import { DEFAULT_META_PLANNER_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════
// PlanExperienceStore
// ═══════════════════════════════════════════════════════════════

export class PlanExperienceStore {
  private config: MetaPlannerConfig;

  /** 内存索引：recordId → PlanExecutionRecord */
  private recordIndex = new Map<string, PlanExecutionRecord>();

  /** 内存索引：templateId → PlanTemplate */
  private templateIndex = new Map<string, PlanTemplate>();

  /** 标签倒排索引：tag → recordId[] */
  private tagIndex = new Map<string, string[]>();

  /** ★ MemoryWiki 实例（SQLite 优先读取） */
  private wiki: MemoryWiki | null = null;

  /** 初始化完成标志 */
  private initialized = false;

  /** Phase 6: Learning loop integration */
  private _experienceExtractor: ExperienceExtractor | null = null;
  private _planEvaluator: PlanEvaluator | null = null;
  private _strategyOptimizer: StrategyOptimizer | null = null;
  private _templateEvolution: TemplateEvolutionEngine | null = null;

  constructor(config?: Partial<MetaPlannerConfig>) {
    this.config = { ...DEFAULT_META_PLANNER_CONFIG, ...config };
  }

  getExperienceExtractor(): ExperienceExtractor {
    if (!this._experienceExtractor) this._experienceExtractor = new ExperienceExtractor();
    return this._experienceExtractor;
  }
  getPlanEvaluator(): PlanEvaluator {
    if (!this._planEvaluator) this._planEvaluator = new PlanEvaluator();
    return this._planEvaluator;
  }
  getStrategyOptimizer(): StrategyOptimizer {
    if (!this._strategyOptimizer) this._strategyOptimizer = new StrategyOptimizer();
    return this._strategyOptimizer;
  }
  getTemplateEvolution(): TemplateEvolutionEngine {
    if (!this._templateEvolution) this._templateEvolution = new TemplateEvolutionEngine();
    return this._templateEvolution;
  }

  // ── 初始化 ──

  /**
   * initialize — 从磁盘加载已有数据到内存索引
   */
  async initialize(): Promise<void> {
    await fsp.mkdir(this.config.experienceStorePath, { recursive: true });
    await fsp.mkdir(this.config.templateStorePath, { recursive: true });

    // 从 JSONL 加载已有数据到内存索引（已迁移至 SQLite 后作为内存缓存）
    await Promise.all([
      this.loadRecords(),
      this.loadTemplates(),
    ]);

    this.initialized = true;
  }

  // ═══════════════════════════════════════════════════════════
  // 执行记录 CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * saveRecord — 持久化一条执行记录（内存索引 + SQLite 双写，不再写入 JSONL）
   */
  async saveRecord(record: PlanExecutionRecord): Promise<void> {
    this.ensureInitialized();

    // 更新内存索引
    this.recordIndex.set(record.recordId, record);

    // 更新标签倒排索引
    for (const tag of record.inputTags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, []);
      }
      this.tagIndex.get(tag)!.push(record.recordId);
    }
  }

  /**
   * getRecord — 通过 recordId 查询（SQLite 优先 → JSONL 回退）
   */
  getRecord(recordId: string): PlanExecutionRecord | undefined {
    if (this.wiki?.ready) {
      try {
        const row = this.wiki.getById('plan_records', recordId);
        if (row) return this.rowToPlanRecord(row);
      } catch { /* fall through */ }
    }
    return this.recordIndex.get(recordId);
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  /** ★ SQLite 行 → PlanExecutionRecord */
  private rowToPlanRecord(row: Record<string, unknown>): PlanExecutionRecord {
    return {
      recordId: row.id as string ?? '',
      executionId: row.execution_id as string ?? '',
      userInput: row.user_input as string ?? '',
      inputTags: typeof row.input_tags === 'string' ? JSON.parse(row.input_tags as string) : (row.input_tags as string[] ?? []),
      dagNodes: [],
      success: (row.execution_success ?? 1) === 1,
      totalDurationMs: (row.duration_ms ?? 0) as number,
      totalTokensUsed: (row.total_tokens_used ?? 0) as number,
      artifactCount: (row.artifact_count ?? 0) as number,
      selfHealingRetries: 0,
      pruningTokensSaved: 0,
      score: (row.plan_score ?? 0) as number,
      createdAt: (row.created_at ?? Date.now()) as number,
    };
  }

  /**
   * getAllRecords — 获取所有执行记录
   */
  getAllRecords(): PlanExecutionRecord[] {
    return [...this.recordIndex.values()];
  }

  /**
   * getRecordsByExecution — 通过 executionId 查询（SQLite 优先 → JSONL 回退）
   */
  getRecordsByExecution(executionId: string): PlanExecutionRecord[] {
    if (this.wiki?.ready) {
      try {
        const rows = this.wiki.queryByField('plan_records', 'execution_id', executionId);
        if (rows.length > 0) return rows.map(r => this.rowToPlanRecord(r));
      } catch { /* fall through */ }
    }
    const results: PlanExecutionRecord[] = [];
    for (const record of this.recordIndex.values()) {
      if (record.executionId === executionId) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * queryByTags — 按标签查询记录（优先 SQLite，回退 JSONL 内存索引）
   */
  queryByTags(tags: string[], limit = 50): PlanExecutionRecord[] {
    // ★ SQLite 优先（通过 MemoryWiki 高层 API）
    if (this.wiki?.ready && tags.length > 0) {
      try {
        const rows = this.wiki.queryByTags('plan_records', tags, { orderBy: 'plan_score DESC', limit }) as Record<string, unknown>[];
        if (rows.length > 0) {
          return rows.map(r => this.rowToPlanRecord(r));
        }
      } catch { /* fall through */ }
    }

    // 回退 JSONL 内存索引
    const candidateIds = new Set<string>();

    for (const tag of tags) {
      const ids = this.tagIndex.get(tag);
      if (ids) {
        for (const id of ids) {
          candidateIds.add(id);
        }
      }
    }

    const records: PlanExecutionRecord[] = [];
    for (const id of candidateIds) {
      const record = this.recordIndex.get(id);
      if (record) records.push(record);
    }

    // 按评分降序
    records.sort((a, b) => b.score - a.score);

    return records.slice(0, limit);
  }

  /**
   * queryRecent — 查询最近的记录
   */
  queryRecent(limit = 50): PlanExecutionRecord[] {
    const records = [...this.recordIndex.values()];
    records.sort((a, b) => b.createdAt - a.createdAt);
    return records.slice(-limit).reverse();
  }

  /**
   * querySuccessful — 查询成功的记录
   */
  querySuccessful(limit = 50): PlanExecutionRecord[] {
    const records = [...this.recordIndex.values()]
      .filter(r => r.success)
      .sort((a, b) => b.score - a.score);
    return records.slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════
  // 模板 CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * saveTemplate — 持久化一个计划模板
   */
  async saveTemplate(template: PlanTemplate): Promise<void> {
    this.ensureInitialized();

    this.templateIndex.set(template.templateId, template);
  }

  /**
   * getTemplate — 通过 templateId 查询
   */
  getTemplate(templateId: string): PlanTemplate | undefined {
    return this.templateIndex.get(templateId);
  }

  /**
   * getAllTemplates — 获取所有模板
   */
  getAllTemplates(): PlanTemplate[] {
    return [...this.templateIndex.values()].sort((a, b) => b.qualityScore - a.qualityScore);
  }

  /**
   * deleteTemplate — 从索引中删除模板（不物理删除 JSONL，追加删除标记）
   */
  deleteTemplate(templateId: string): void {
    this.templateIndex.delete(templateId);
  }

  /**
   * extractTemplate — 从执行记录中提炼模板
   *
   * 当一条执行记录评分超过阈值且成功时，自动提炼为可复用模板。
   */
  async extractTemplate(record: PlanExecutionRecord): Promise<PlanTemplate | null> {
    if (record.score < this.config.templateExtractionScoreThreshold) return null;
    if (!record.success) return null;

    // 检查是否已有相似模板（避免重复）
    const existingSimilar = this.findSimilarTemplate(record);
    if (existingSimilar) {
      // 更新已有模板的统计信息
      existingSimilar.usageCount++;
      existingSimilar.successRate =
        (existingSimilar.successRate * (existingSimilar.usageCount - 1) + 1) / existingSimilar.usageCount;
      existingSimilar.avgDurationMs =
        (existingSimilar.avgDurationMs * (existingSimilar.usageCount - 1) + record.totalDurationMs) / existingSimilar.usageCount;
      existingSimilar.avgTokensUsed = Math.round(
        (existingSimilar.avgTokensUsed * (existingSimilar.usageCount - 1) + record.totalTokensUsed) / existingSimilar.usageCount,
      );
      existingSimilar.lastUsedAt = Date.now();
      existingSimilar.sourceExecutionIds.push(record.executionId);

      await this.saveTemplate(existingSimilar);
      return existingSimilar;
    }

    // 创建新模板
    const template: PlanTemplate = {
      templateId: `tpl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      name: this.inferTemplateName(record),
      description: this.inferTemplateDescription(record),
      tags: [...record.inputTags],
      nodeSkeletons: record.dagNodes.map(n => ({
        role: n.role,
        domain: n.domain,
        deps: [], // 简化为空，实际依赖由 DAG 拓扑决定
        expectedArtifacts: n.artifactUris.length > 0 ? ['*'] : [],
        optional: n.status === 'skipped',
        typicalTimeoutMs: n.durationMs > 0 ? n.durationMs : undefined,
      })),
      successRate: 1,
      avgDurationMs: record.totalDurationMs,
      avgTokensUsed: record.totalTokensUsed,
      usageCount: 1,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      sourceExecutionIds: [record.executionId],
      version: 1,
      qualityScore: record.score,
    };

    await this.saveTemplate(template);
    return template;
  }

  // ═══════════════════════════════════════════════════════════
  // 相似度匹配
  // ═══════════════════════════════════════════════════════════

  /**
   * findSimilarTemplates — 查找与当前任务最匹配的模板
   *
   * 匹配策略：
   *   1. 标签 Jaccard 相似度（权重 0.6）
   *   2. 文本关键词重叠度（权重 0.4）
   *   3. 过滤低于 similarityThreshold 的结果
   *   4. 按 qualityScore × similarityScore 降序排列
   *
   * @param userInput - 用户输入文本
   * @param tags       - 输入标签
   * @returns 匹配结果列表
   */
  findSimilarTemplates(userInput: string, tags: string[]): PlanMatchResult[] {
    const inputTokens = this.tokenize(userInput);
    const results: PlanMatchResult[] = [];

    for (const template of this.templateIndex.values()) {
      // 仅考虑使用次数足够的模板
      if (template.usageCount < this.config.minUsageThreshold) continue;

      // 标签 Jaccard 相似度
      const tagSimilarity = this.jaccardSimilarity(
        new Set(tags),
        new Set(template.tags),
      );

      // 文本关键词重叠度
      const textSimilarity = this.keywordOverlap(inputTokens, template);

      // 加权综合相似度
      const similarityScore = tagSimilarity * 0.6 + textSimilarity * 0.4;

      if (similarityScore >= this.config.similarityThreshold) {
        const matchReasons: string[] = [];
        if (tagSimilarity > 0.3) matchReasons.push(`标签匹配度 ${(tagSimilarity * 100).toFixed(0)}%`);
        if (textSimilarity > 0.3) matchReasons.push(`关键词匹配度 ${(textSimilarity * 100).toFixed(0)}%`);
        if (template.successRate > 0.8) matchReasons.push(`历史成功率 ${(template.successRate * 100).toFixed(0)}%`);
        if (matchReasons.length === 0) matchReasons.push('综合相似度达标');

        const adjustments = this.generateAdjustments(template, tags, inputTokens);

        results.push({
          template,
          similarityScore,
          matchReasons,
          suggestedAdjustments: adjustments,
        });
      }
    }

    // 按 qualityScore × similarityScore 降序
    results.sort((a, b) => {
      const scoreA = a.template.qualityScore * a.similarityScore;
      const scoreB = b.template.qualityScore * b.similarityScore;
      return scoreB - scoreA;
    });

    return results.slice(0, this.config.maxMatches);
  }

  /**
   * findSimilarTemplate — 查找与记录最相似的单个模板
   */
  private findSimilarTemplate(record: PlanExecutionRecord): PlanTemplate | undefined {
    const matches = this.findSimilarTemplates(record.userInput, record.inputTags);
    if (matches.length === 0) return undefined;

    // 相似度 > 0.8 认为是同一模板
    const best = matches[0];
    if (best.similarityScore > 0.8) return best.template;

    return undefined;
  }

  // ═══════════════════════════════════════════════════════════
  // 统计聚合
  // ═══════════════════════════════════════════════════════════

  /**
   * getFailurePatterns — 获取失败模式统计
   *
   * 聚合所有失败记录，提取高频失败类别和节点角色。
   */
  getFailurePatterns(): FailurePatternReport[] {
    const categoryCount = new Map<string, { count: number; examples: string[] }>();

    for (const record of this.recordIndex.values()) {
      if (!record.failureDetails) continue;

      for (const detail of record.failureDetails) {
        const key = `${detail.category}:${detail.nodeId}`;
        if (!categoryCount.has(key)) {
          categoryCount.set(key, { count: 0, examples: [] });
        }
        const entry = categoryCount.get(key)!;
        entry.count++;
        if (entry.examples.length < 3) {
          entry.examples.push(detail.summary.slice(0, 200));
        }
      }
    }

    const patterns: FailurePatternReport[] = [];
    for (const [key, entry] of categoryCount) {
      if (entry.count >= this.config.minFailurePatternCount) {
        const [category, nodeId] = key.split(':') as [FailureCategory, string];
        patterns.push({
          category,
          nodeRole: nodeId,
          occurrenceCount: entry.count,
          examples: entry.examples,
          suggestedAction: this.suggestActionForFailure(category),
        });
      }
    }

    patterns.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    return patterns;
  }

  /**
   * getStats — 获取全局统计
   */
  getStats(): PlanStoreStats {
    const records = [...this.recordIndex.values()];
    const successful = records.filter(r => r.success);
    const failed = records.filter(r => !r.success);

    return {
      totalRecords: records.length,
      totalTemplates: this.templateIndex.size,
      successRate: records.length > 0 ? successful.length / records.length : 0,
      avgDurationMs: records.length > 0
        ? records.reduce((s, r) => s + r.totalDurationMs, 0) / records.length
        : 0,
      avgTokensUsed: records.length > 0
        ? Math.round(records.reduce((s, r) => s + r.totalTokensUsed, 0) / records.length)
        : 0,
      totalTokensSaved: records.reduce((s, r) => s + r.pruningTokensSaved, 0),
      totalSelfHealingRecoveries: records.reduce((s, r) => s + r.selfHealingRetries, 0),
      recentSuccessRate: this.computeRecentSuccessRate(20),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PlanExperienceStore 未初始化，请先调用 initialize()');
    }
  }

  /** 加载执行记录 */
  private async loadRecords(): Promise<void> {
    const filePath = path.join(this.config.experienceStorePath, 'plan-records.jsonl');
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const record: PlanExecutionRecord = JSON.parse(line);
          this.recordIndex.set(record.recordId, record);
          for (const tag of record.inputTags) {
            if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, []);
            this.tagIndex.get(tag)!.push(record.recordId);
          }
        } catch { /* 跳过损坏行 */ }
      }
    } catch {
      // 文件不存在，跳过
    }
  }

  /** 加载模板 */
  private async loadTemplates(): Promise<void> {
    const filePath = path.join(this.config.templateStorePath, 'plan-templates.jsonl');
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const template: PlanTemplate = JSON.parse(line);
          this.templateIndex.set(template.templateId, template);
        } catch { /* 跳过损坏行 */ }
      }
    } catch {
      // 文件不存在，跳过
    }
  }

  /** 滚动记录（超过 maxRecords 时从内存索引删除最旧的） */
  private maybeRollRecords(): void {
    if (this.recordIndex.size <= this.config.maxRecords) return;

    const records = [...this.recordIndex.values()]
      .sort((a, b) => a.createdAt - b.createdAt);

    const toDelete = records.slice(0, records.length - this.config.maxRecords);
    for (const record of toDelete) {
      this.recordIndex.delete(record.recordId);
      for (const tag of record.inputTags) {
        const ids = this.tagIndex.get(tag);
        if (ids) {
          const idx = ids.indexOf(record.recordId);
          if (idx >= 0) ids.splice(idx, 1);
        }
      }
    }
  }

  // ── 文本处理 ──

  /** 简单分词 */
  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    // 提取中英文关键词
    const words = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);

    for (const w of words) {
      tokens.add(w);
      // 生成 2-gram（适用于中文）
      if (/[\u4e00-\u9fff]/.test(w) && w.length >= 4) {
        for (let i = 0; i < w.length - 1; i++) {
          tokens.add(w.slice(i, i + 2));
        }
      }
    }

    return tokens;
  }

  /** Jaccard 相似度 */
  private jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /** 关键词重叠度 */
  private keywordOverlap(inputTokens: Set<string>, template: PlanTemplate): number {
    // 用模板描述和标签作为模板的文本特征
    const templateText = `${template.name} ${template.description} ${template.tags.join(' ')}`;
    const templateTokens = this.tokenize(templateText);

    if (inputTokens.size === 0 || templateTokens.size === 0) return 0;

    const overlap = new Set([...inputTokens].filter(t => templateTokens.has(t)));
    return overlap.size / Math.min(inputTokens.size, templateTokens.size);
  }

  /** 推断模板名称 */
  private inferTemplateName(record: PlanExecutionRecord): string {
    const roles = record.dagNodes.map(n => n.role).join('_');
    const tags = record.inputTags.slice(0, 2).join('_');
    return tags ? `${tags}_strategy` : `strategy_${roles.slice(0, 40)}`;
  }

  /** 推断模板描述 */
  private inferTemplateDescription(record: PlanExecutionRecord): string {
    return `从执行 ${record.executionId} 自动提炼。${record.dagNodes.length} 节点，评分 ${record.score.toFixed(2)}。`;
  }

  /** 生成参数调整建议 */
  private generateAdjustments(
    template: PlanTemplate,
    inputTags: string[],
    _inputTokens: Set<string>,
  ): PlanAdjustment[] {
    const adjustments: PlanAdjustment[] = [];

    // 若模板包含 inputTags 中没有的节点角色，建议添加
    const inputTagSet = new Set(inputTags.map(t => t.toLowerCase()));
    for (const skeleton of template.nodeSkeletons) {
      const roleLower = skeleton.role.toLowerCase();
      if (!inputTagSet.has(roleLower) && template.successRate > 0.8) {
        adjustments.push({
          type: 'add_node',
          description: `建议添加 "${skeleton.role}" 节点（模板成功率 ${(template.successRate * 100).toFixed(0)}%）`,
          targetRole: skeleton.role,
        });
      }
    }

    return adjustments;
  }

  /** 失败应对策略建议 */
  private suggestActionForFailure(category: FailureCategory): string {
    switch (category) {
      case 'llm_timeout': return '增加节点超时时间或切换更快模型';
      case 'llm_hallucination': return '添加验证节点（Validation Node）或降低 temperature';
      case 'tool_error': return '检查工具前置条件，添加 pre-condition check 节点';
      case 'mcp_crash': return '启用 McpProcessGuard 并增加 maxRestarts';
      case 'token_exhaustion': return '启用 ContextPruner 或增加 Token 预算';
      case 'validation_failure': return '在产出节点后添加自动验证步骤';
      case 'dependency_missing': return '检查上游节点的 requiredArtifacts 配置';
      case 'timeout': return '将节点标记为 optional 或增加超时时间';
      default: return '检查节点日志，必要时人工介入';
    }
  }

  /** 最近 N 条记录的成功率 */
  private computeRecentSuccessRate(n: number): number {
    const records = [...this.recordIndex.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, n);

    if (records.length === 0) return 0;
    return records.filter(r => r.success).length / records.length;
  }
}

// ═══════════════════════════════════════════════════════════════
// 辅助类型
// ═══════════════════════════════════════════════════════════════

/** 失败模式报告 */
export interface FailurePatternReport {
  category: FailureCategory;
  nodeRole: string;
  occurrenceCount: number;
  examples: string[];
  suggestedAction: string;
}

/** 存储统计 */
export interface PlanStoreStats {
  totalRecords: number;
  totalTemplates: number;
  successRate: number;
  avgDurationMs: number;
  avgTokensUsed: number;
  totalTokensSaved: number;
  totalSelfHealingRecoveries: number;
  recentSuccessRate: number;
}
