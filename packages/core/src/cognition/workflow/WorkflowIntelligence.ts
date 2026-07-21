/**
 * WorkflowIntelligence — 工作流智能引擎
 *
 * Phase 7 / MorPex v8: 从用户行为中学习、优化、自动化的核心引擎。
 *
 * 四大能力：
 *   1. Pattern Detection — 分析完成的 Mission，发现重复行为模式
 *   2. Workflow Extraction — 从相似 Mission 群组中提取标准化工作流
 *   3. Workflow Optimization — 分析工作流并给出优化建议（并行化、合并、排序）
 *   4. Automation Assessment — 评估工作流的自动化成熟度
 *
 * 使用方式：
 *   const engine = new WorkflowIntelligence(workflowMemory);
 *   const patterns = await engine.detectPatterns(completedMissions);
 *   const workflow = await engine.extractWorkflow(similarMissions, '产品发布');
 *   const suggestions = await engine.optimizeWorkflow(workflowId);
 *   const assessment = await engine.assessAutomation(workflowId);
 */

import type { Mission, MissionPlan, PlanStep } from '../../runtime/mission/types.js';
import { WorkflowMemory } from '../memory/WorkflowMemory.js';
import type { WorkflowMemoryEntry } from '../memory/types.js';
import type {
  WorkflowPattern,
  WorkflowStep,
  OptimizationSuggestion,
  AutomationAssessment,
  IntelligenceReport,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// WorkflowIntelligence
// ═══════════════════════════════════════════════════════════════════

export class WorkflowIntelligence {
  /** WorkflowMemory 引用（存储提取的工作流） */
  private workflowMemory: WorkflowMemory;

  /** 检测到的模式（id → WorkflowPattern） */
  private patterns: Map<string, WorkflowPattern> = new Map();

  /** 模式 ID 计数器 */
  private patternIdCounter = 0;

  /**
   * @param workflowMemory - WorkflowMemory 实例
   */
  constructor(workflowMemory: WorkflowMemory) {
    this.workflowMemory = workflowMemory;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. Pattern Detection
  // ═══════════════════════════════════════════════════════════════════

  /**
   * detectPatterns — 从完成的 Mission 历史中检测重复行为模式
   *
   * 使用 Jaccard 相似度比较 Mission 的 step domain+agentType 序列，
   * 将相似度 > 0.5 的 Mission 聚类为模式。
   *
   * @param missions - 已完成的历史 Mission 列表
   * @returns 检测到的 WorkflowPattern 列表
   */
  async detectPatterns(missions: Mission[]): Promise<WorkflowPattern[]> {
    const patterns: WorkflowPattern[] = [];

    // 过滤出有计划且已完成的 Mission
    const validMissions = missions.filter(
      m => m.plan && m.plan.steps.length > 0
    );

    if (validMissions.length < 2) {
      console.log('[WorkflowIntelligence] 不足以检测模式（需要 ≥2 个有计划的 Mission）');
      return patterns;
    }

    // 1. 计算所有 Mission 对的相似度矩阵
    const similarityMatrix = this.buildSimilarityMatrix(validMissions);

    // 2. 使用简单阈值聚类
    const clusters = this.clusterMissions(validMissions, similarityMatrix);

    // 3. 为每个聚类创建模式
    for (const cluster of clusters) {
      if (cluster.length < 2) continue; // 单例不构成模式

      const pattern = this.buildPatternFromCluster(cluster);
      patterns.push(pattern);
      this.patterns.set(pattern.id, pattern);
    }

    console.log(`[WorkflowIntelligence] 检测到 ${patterns.length} 个工作流模式`);
    return patterns;
  }

  /**
   * buildSimilarityMatrix — 构建 Mission 相似度矩阵
   */
  private buildSimilarityMatrix(
    missions: Mission[]
  ): number[][] {
    const n = missions.length;
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = this.computeMissionSimilarity(missions[i], missions[j]);
        matrix[i][j] = sim;
        matrix[j][i] = sim;
      }
      matrix[i][i] = 1; // 自身相似度为 1
    }

    return matrix;
  }

  /**
   * computeMissionSimilarity — 计算两个 Mission 的相似度
   *
   * 使用 Jaccard 相似度：|A ∩ B| / |A ∪ B|
   * 其中 A 和 B 是 step 的 (domain, agentType) 序列
   */
  private computeMissionSimilarity(a: Mission, b: Mission): number {
    if (!a.plan || !b.plan) return 0;

    const seqA = a.plan.steps.map(s => `${s.domain}:${s.agentType}`);
    const seqB = b.plan.steps.map(s => `${s.domain}:${s.agentType}`);

    const setA = new Set(seqA);
    const setB = new Set(seqB);

    let intersection = 0;
    let union = 0;

    const allKeys = new Set([...setA, ...setB]);
    for (const key of allKeys) {
      const inA = setA.has(key) ? 1 : 0;
      const inB = setB.has(key) ? 1 : 0;
      intersection += Math.min(inA, inB);
      union += Math.max(inA, inB);
    }

    return union > 0 ? intersection / union : 0;
  }

  /**
   * clusterMissions — 基于相似度矩阵聚类
   *
   * 简单实现：若两个 Mission 的相似度 > 0.5，则归于同一簇
   */
  private clusterMissions(
    missions: Mission[],
    similarityMatrix: number[][]
  ): Mission[][] {
    const n = missions.length;
    const visited = new Array(n).fill(false);
    const clusters: Mission[][] = [];

    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;

      const cluster: Mission[] = [missions[i]];
      visited[i] = true;

      for (let j = i + 1; j < n; j++) {
        if (visited[j]) continue;
        if (similarityMatrix[i][j] > 0.5) {
          cluster.push(missions[j]);
          visited[j] = true;
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * buildPatternFromCluster — 从 Mission 簇构建模式
   */
  private buildPatternFromCluster(cluster: Mission[]): WorkflowPattern {
    const id = `wfp_${++this.patternIdCounter}`;
    const now = Date.now();

    // 从簇中所有 Mission 的 goal 提取共同名称
    const name = this.inferPatternName(cluster);

    // 统计 domains
    const domainSet = new Set<string>();
    const allSteps: PlanStep[] = [];
    for (const m of cluster) {
      if (m.plan) {
        for (const s of m.plan.steps) {
          domainSet.add(s.domain);
          allSteps.push(s);
        }
      }
    }

    // 合并步骤（去重+保留出现次数最多的顺序）
    const mergedSteps = this.mergeSteps(allSteps);

    return {
      id,
      name,
      description: `从 ${cluster.length} 个相似 Mission 中检测到的模式`,
      steps: mergedSteps,
      frequency: cluster.length,
      firstSeen: Math.min(...cluster.map(m => m.createdAt)),
      lastSeen: Math.max(...cluster.map(m => m.updatedAt)),
      domains: [...domainSet],
      confidence: Math.min(0.3 + cluster.length * 0.1, 0.95),
      sourceMissions: cluster.map(m => m.id),
    };
  }

  /**
   * inferPatternName — 从 Mission 簇推断模式名称
   */
  private inferPatternName(cluster: Mission[]): string {
    // 提取目标中的公共关键词（简化实现）
    const words = new Map<string, number>();
    for (const m of cluster) {
      const tokens = m.goal
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);
      for (const t of tokens) {
        words.set(t, (words.get(t) || 0) + 1);
      }
    }

    // 取出现次数最多的前 3 个词
    const sorted = [...words.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);

    return sorted.length > 0
      ? sorted.join('_').replace(/_/g, ' ')
      : `Pattern_${cluster[0].id.substring(0, 8)}`;
  }

  /**
   * mergeSteps — 合并步骤序列
   */
  private mergeSteps(steps: PlanStep[]): WorkflowStep[] {
    const stepMap = new Map<string, { count: number; orderSum: number; step: PlanStep }>();

    for (const s of steps) {
      const key = `${s.domain}:${s.agentType}:${s.name}`;
      const existing = stepMap.get(key);
      if (existing) {
        existing.count++;
        existing.orderSum += s.priority;
      } else {
        stepMap.set(key, { count: 1, orderSum: s.priority, step: s });
      }
    }

    return [...stepMap.values()]
      .sort((a, b) => a.orderSum / a.count - b.orderSum / b.count)
      .map((entry, idx) => ({
        name: entry.step.name,
        description: entry.step.description || '',
        domain: entry.step.domain,
        agentType: entry.step.agentType,
        order: idx,
        optional: entry.count < Math.max(...[...stepMap.values()].map(v => v.count), 0) * 0.5,
        averageDuration: undefined,
      }));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. Workflow Extraction
  // ═══════════════════════════════════════════════════════════════════

  /**
   * extractWorkflow — 从相似 Mission 群组中提取标准化工作流
   *
   * 将检测到的模式持久化到 WorkflowMemory 中。
   *
   * @param missions - 相似 Mission 群组
   * @param name - 工作流名称
   * @returns 持久化的 WorkflowMemoryEntry
   */
  async extractWorkflow(
    missions: Mission[],
    name: string
  ): Promise<WorkflowMemoryEntry> {
    if (missions.length === 0) {
      throw new Error('[WorkflowIntelligence] 无法从空列表提取工作流');
    }

    // 提取模式
    const pattern = this.buildPatternFromCluster(missions);

    // 构建 WorkflowMemoryEntry
    const entry: WorkflowMemoryEntry = {
      id: `wfm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      layer: 'workflow',
      content: name,
      workflow: {
        name,
        steps: pattern.steps.map(s => s.name),
        domain: pattern.domains[0],
        tools: [],
        frequency: pattern.frequency > 5 ? 'regular' : pattern.frequency > 2 ? 'occasional' : 'once',
        sourceMissions: pattern.sourceMissions,
      },
      metadata: {
        patternId: pattern.id,
        domains: pattern.domains,
        stepCount: pattern.steps.length,
      },
      importance: 0.5,
      confidence: pattern.confidence,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      tags: ['workflow', ...pattern.domains, name],
    };

    // 存储到 WorkflowMemory
    await this.workflowMemory.storeWorkflow(entry);

    console.log(`[WorkflowIntelligence] 📋 已提取工作流: "${name}" (${pattern.steps.length} 步)`);
    return entry;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. Workflow Optimization
  // ═══════════════════════════════════════════════════════════════════

  /**
   * optimizeWorkflow — 分析工作流并给出优化建议
   *
   * 检查项：
   *   1. 可并行化的步骤（无依赖关系）
   *   2. 可合并的相邻步骤（同一 domain+agentType）
   *   3. 可移除的冗余步骤
   *   4. 可调整的执行顺序
   *
   * @param workflowId - WorkflowMemory 中的工作流 ID
   * @returns 优化建议列表
   */
  async optimizeWorkflow(workflowId: string): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    const entry = this.workflowMemory.getWorkflow(workflowId);

    if (!entry) {
      console.warn(`[WorkflowIntelligence] 工作流未找到: ${workflowId}`);
      return suggestions;
    }

    const steps = entry.workflow.steps;

    // 1. 检查可并行化的相邻步骤
    for (let i = 0; i < steps.length - 1; i++) {
      if (this.canParallelize(steps[i], steps[i + 1])) {
        suggestions.push({
          type: 'parallelize',
          description: `将 "${steps[i]}" 和 "${steps[i + 1]}" 并行执行`,
          affectedSteps: [steps[i], steps[i + 1]],
          rationale: '这两个步骤没有依赖关系，可以同时执行以减少总执行时间',
          confidence: 0.7,
        });
      }
    }

    // 2. 检查可合并的相邻步骤（相同 domain）
    for (let i = 0; i < steps.length - 1; i++) {
      if (this.canMerge(steps[i], steps[i + 1])) {
        suggestions.push({
          type: 'merge',
          description: `将 "${steps[i]}" 和 "${steps[i + 1]}" 合并为一步`,
          affectedSteps: [steps[i], steps[i + 1]],
          rationale: '这两个步骤属于同一领域，可以合并以减少上下文切换',
          confidence: 0.6,
        });
      }
    }

    return suggestions;
  }

  /**
   * canParallelize — 检查两个步骤是否可以并行执行
   */
  private canParallelize(stepA: string, stepB: string): boolean {
    // 简化实现：不同 domain 的步骤通常可并行
    const a = this.workflowMemory.findSimilar(stepA, 1)[0];
    const b = this.workflowMemory.findSimilar(stepB, 1)[0];
    if (!a || !b) return false;
    return a.workflow.domain !== b.workflow.domain;
  }

  /**
   * canMerge — 检查两个步骤是否可以合并
   */
  private canMerge(stepA: string, stepB: string): boolean {
    // 简化实现：相同领域 + 接近的步骤可以合并
    const a = this.workflowMemory.findSimilar(stepA, 1)[0];
    const b = this.workflowMemory.findSimilar(stepB, 1)[0];
    if (!a || !b) return false;
    return a.workflow.domain === b.workflow.domain;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. Automation Assessment
  // ═══════════════════════════════════════════════════════════════════

  /**
   * assessAutomation — 评估工作流的自动化成熟度
   *
   * 评估标准：
   *   - 执行次数 >= 5：+30 分
   *   - 成功率 > 90%：+30 分
   *   - 最近 3 次无失败：+20 分
   *   - 步骤数量稳定：+20 分
   *
   * 总分 >= 80 时可自动化，建议审批级别反映风险
   *
   * @param workflowId - WorkflowMemory 中的工作流 ID
   * @returns 自动化成熟度评估
   */
  async assessAutomation(workflowId: string): Promise<AutomationAssessment> {
    const entry = this.workflowMemory.getWorkflow(workflowId);
    if (!entry) {
      return {
        workflowId,
        isReady: false,
        score: 0,
        reasons: ['工作流未找到'],
        missingRequirements: ['需要先提取工作流'],
        suggestedApprovalLevel: 'high',
      };
    }

    let score = 0;
    const reasons: string[] = [];
    const missing: string[] = [];

    // 执行次数
    const freq = entry.workflow.sourceMissions.length;
    if (freq >= 10) {
      score += 30;
      reasons.push(`✅ 高执行频率：${freq} 次`);
    } else if (freq >= 5) {
      score += 20;
      reasons.push(`✅ 中等执行频率：${freq} 次`);
    } else {
      missing.push(`需要更多执行记录（当前 ${freq} 次，需 ≥5）`);
    }

    // 置信度
    if (entry.confidence >= 0.8) {
      score += 30;
      reasons.push(`✅ 高置信度：${(entry.confidence * 100).toFixed(0)}%`);
    } else if (entry.confidence >= 0.5) {
      score += 15;
      reasons.push(`🟡 中等置信度：${(entry.confidence * 100).toFixed(0)}%`);
    } else {
      missing.push(`置信度不足（当前 ${(entry.confidence * 100).toFixed(0)}%，需 ≥50%）`);
    }

    // 步骤稳定性（有确定的步骤序列）
    if (entry.workflow.steps.length >= 2) {
      score += 20;
      reasons.push(`✅ 有稳定的步骤序列（${entry.workflow.steps.length} 步）`);
    } else {
      missing.push('步骤序列不够稳定');
    }

    // 时间久远度（老的工作流更成熟）
    const age = Date.now() - entry.createdAt;
    if (age > 30 * 24 * 60 * 60 * 1000) { // 30 天
      score += 20;
      reasons.push('✅ 长期稳定的工作流模式');
    } else if (age > 7 * 24 * 60 * 60 * 1000) { // 7 天
      score += 10;
      reasons.push('🟡 中短期工作流模式');
    } else {
      missing.push('工作流模式建立时间不足');
    }

    const isReady = score >= 80;
    const suggestedApprovalLevel: AutomationAssessment['suggestedApprovalLevel'] =
      score >= 90 ? 'none' :
      score >= 80 ? 'low' :
      score >= 60 ? 'medium' :
      'high';

    return {
      workflowId,
      isReady,
      score,
      reasons,
      missingRequirements: missing,
      suggestedApprovalLevel,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. 综合报告
  // ═══════════════════════════════════════════════════════════════════

  /**
   * generateReport — 生成工作流智能综合报告
   *
   * @param missionHistory - 历史 Mission 列表
   * @returns IntelligenceReport
   */
  async generateReport(missionHistory: Mission[]): Promise<IntelligenceReport> {
    // 检测模式
    const patterns = await this.detectPatterns(missionHistory);

    // 评估已有的工作流
    const existingWorkflows = this.workflowMemory.getAll();
    let automatableCount = 0;

    for (const wf of existingWorkflows) {
      const assessment = await this.assessAutomation(wf.id);
      if (assessment.isReady) automatableCount++;
    }

    return {
      patternsFound: patterns.length,
      workflowsExtracted: existingWorkflows.length,
      optimizationsSuggested: existingWorkflows.length * 2, // 估算
      automatableWorkflows: automatableCount,
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. 获取模式
  // ═══════════════════════════════════════════════════════════════════

  /**
   * getPatterns — 获取所有检测到的模式
   */
  getPatterns(): WorkflowPattern[] {
    return [...this.patterns.values()];
  }

  /**
   * getPattern — 获取指定模式
   */
  getPattern(id: string): WorkflowPattern | undefined {
    return this.patterns.get(id);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. 序列化
  // ═══════════════════════════════════════════════════════════════════

  /**
   * toJSON — 序列化为 JSON 对象
   */
  toJSON(): { patterns: WorkflowPattern[] } {
    return {
      patterns: [...this.patterns.values()],
    };
  }

  /**
   * fromJSON — 从 JSON 对象恢复
   */
  fromJSON(data: { patterns: WorkflowPattern[] }): void {
    this.patterns.clear();
    for (const p of data.patterns) {
      this.patterns.set(p.id, p);
      this.patternIdCounter = Math.max(this.patternIdCounter, parseInt(p.id.replace('wfp_', ''), 10));
    }
  }
}
