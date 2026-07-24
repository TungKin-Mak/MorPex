/**
 * SOPEngine — 经验 → 标准操作流程引擎
 *
 * Phase 5 / VCOS 升级 — P1: Company Memory → SOP
 *
 * 将成功任务经验转化为可复用的 SOP（标准操作流程）。
 *
 * 触发链：
 *   任务完成 → BrainFacade.learn() → SOPEngine.extractSOP()
 *     → LLM 分类（PiBridge，每次任务 1 次调用）
 *     → 基于分类匹配相似历史任务
 *     → 相似 ≥ 3 次成功 → 自动生成 SOP
 *     → 存入 SOP 库
 *     → Future Planning Bias（DeliveryPlanner 读取 SOP）
 *
 * 分类策略：
 *   - 每次任务用 LLM 做一次分类（category + task_type + keywords）
 *   - 后续匹配基于分类字段而非字符重叠
 *   - PiBridge 不可用时降级到关键词提取
 */

import { EventBus } from '../common/EventBus.js';
import type { BrainExperience } from '../cognition/BrainFacade.js';
import type { DepartmentId } from '../department/types.js';

// ── Types ──

/** LLM 对任务的分类结果 */
export interface TaskClassification {
  /** 主类别: code | analysis | design | debug | content | data | general */
  category: string;
  /** 子类型，如 'web_scraping' | 'api_development' | 'market_analysis' */
  taskType: string;
  /** 关键特征词（3-5 个） */
  keywords: string[];
  /** 复杂度: simple | moderate | complex */
  complexity: 'simple' | 'moderate' | 'complex';
  /** 推荐工具/能力 */
  recommendedCapabilities: string[];
}

export interface SOPStep {
  order: number;
  action: string;
  capability: string;
  expectedOutput: string;
  tips?: string;
}

export interface SOP {
  id: string;
  title: string;
  departmentId: string;
  category: string;
  taskType: string;
  steps: SOPStep[];
  successCount: number;
  avgDuration: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SOPStats {
  totalSOPs: number;
  byDepartment: Record<string, number>;
  byCategory: Record<string, number>;
  avgSuccessCount: number;
}

// ── SOP 步骤模板（按 category） ──

const SOP_TEMPLATES: Record<string, SOPStep[]> = {
  code: [
    { order: 1, action: '分析需求，明确输入输出', capability: 'analyze', expectedOutput: '需求规格说明' },
    { order: 2, action: '设计方案，选择技术栈', capability: 'design', expectedOutput: '技术方案' },
    { order: 3, action: '编写代码实现功能', capability: 'code', expectedOutput: '可运行代码' },
    { order: 4, action: '编写和运行测试', capability: 'test', expectedOutput: '测试通过报告', tips: '覆盖边界情况和异常路径' },
    { order: 5, action: '代码审查和优化', capability: 'review', expectedOutput: '审查通过的代码' },
  ],
  analysis: [
    { order: 1, action: '收集相关数据和信息', capability: 'research', expectedOutput: '数据集' },
    { order: 2, action: '处理和分析数据', capability: 'analyze', expectedOutput: '分析结果' },
    { order: 3, action: '生成分析报告', capability: 'write', expectedOutput: '分析报告' },
    { order: 4, action: '提炼关键洞察和建议', capability: 'synthesize', expectedOutput: '洞察清单' },
  ],
  design: [
    { order: 1, action: '调研参考案例', capability: 'research', expectedOutput: '参考清单' },
    { order: 2, action: '绘制草图/线框图', capability: 'design', expectedOutput: '草图' },
    { order: 3, action: '制作原型', capability: 'prototype', expectedOutput: '可交互原型' },
    { order: 4, action: '收集反馈并迭代', capability: 'iterate', expectedOutput: '改进版本' },
  ],
  debug: [
    { order: 1, action: '复现问题', capability: 'reproduce', expectedOutput: '复现步骤' },
    { order: 2, action: '定位根因', capability: 'diagnose', expectedOutput: '根因分析' },
    { order: 3, action: '实施修复', capability: 'fix', expectedOutput: '修复代码' },
    { order: 4, action: '验证修复并回归测试', capability: 'verify', expectedOutput: '验证通过' },
  ],
  content: [
    { order: 1, action: '确定目标受众和核心信息', capability: 'plan', expectedOutput: '内容大纲' },
    { order: 2, action: '调研和收集素材', capability: 'research', expectedOutput: '素材库' },
    { order: 3, action: '撰写初稿', capability: 'write', expectedOutput: '初稿' },
    { order: 4, action: '编辑润色和发布', capability: 'edit', expectedOutput: '终稿' },
  ],
  data: [
    { order: 1, action: '定义数据需求', capability: 'analyze', expectedOutput: '需求文档' },
    { order: 2, action: '数据采集/清洗', capability: 'process', expectedOutput: '清洗后数据' },
    { order: 3, action: '数据建模/分析', capability: 'model', expectedOutput: '模型/分析结果' },
    { order: 4, action: '可视化/报告', capability: 'visualize', expectedOutput: '可视化报告' },
  ],
  general: [
    { order: 1, action: '制定执行计划', capability: 'plan', expectedOutput: '计划' },
    { order: 2, action: '逐步执行', capability: 'execute', expectedOutput: '执行结果' },
    { order: 3, action: '验证结果质量', capability: 'verify', expectedOutput: '验证报告' },
    { order: 4, action: '交付最终产物', capability: 'deliver', expectedOutput: '最终产物' },
  ],
};

// ── SOPEngine ──

export class SOPEngine {
  name = 'SOPEngine';
  version = '2.0.0';

  private eventBus: EventBus;
  private sops: Map<string, SOP> = new Map();
  /** 任务历史（含 LLM 分类结果） */
  private taskHistory: Array<{ goal: string; departmentId: string; classification: TaskClassification; duration: number }> = [];
  private sopCounter = 0;

  /** 分类缓存：goal → classification，避免重复 LLM 调用 */
  private classificationCache: Map<string, TaskClassification> = new Map();

  /** 模式检测阈值：同一 taskType 成功 N 次后触发 SOP 提取 */
  private static readonly PATTERN_THRESHOLD = 3;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[SOPEngine] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  // ═══════════════════════════════════════════════════════════════
  // LLM 分类
  // ═══════════════════════════════════════════════════════════════

  /**
   * classifyGoal — 用 LLM 对任务目标做一次分类
   *
   * 分类结果缓存，同一 goal 不重复调用。
   * PiBridge 不可用时降级到关键词提取。
   */
  private async classifyGoal(goal: string): Promise<TaskClassification> {
    // 缓存命中
    const cached = this.classificationCache.get(goal);
    if (cached) return cached;

    let classification: TaskClassification;

    try {
      const { PiBridge } = await import('../adapters/pi-bridge/PiBridge.js');
      const bridge = new PiBridge('deepseek/deepseek-v4-flash');
      await bridge.init();

      const prompt = `分析以下任务，返回 JSON 格式分类：

任务: "${goal}"

返回严格 JSON（不要 markdown 代码块）:
{
  "category": "code|analysis|design|debug|content|data|general",
  "taskType": "简短英文标识，如 web_scraping, api_development, bug_fix, market_analysis, ui_design",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "complexity": "simple|moderate|complex",
  "recommendedCapabilities": ["能力1", "能力2"]
}

category 判断标准:
- code: 写代码、开发、编程、脚本、爬虫、API
- analysis: 分析、报告、调研、评估、数据
- design: UI、UX、界面、原型、设计
- debug: 调试、修复、bug、报错、问题
- content: 写作、文案、翻译、内容
- data: 数据采集、清洗、建模、可视化
- general: 其他`;

      const result = await bridge.generateText({
        prompt,
        maxTokens: 300,
        temperature: 0.1,
      });

      classification = this.parseClassification(result.text, goal);
    } catch (err) {
      // 降级：关键词提取
      console.warn('[SOPEngine] LLM 分类失败，降级到关键词:', (err as Error).message);
      classification = this.keywordFallback(goal);
    }

    this.classificationCache.set(goal, classification);
    // 限制缓存大小
    if (this.classificationCache.size > 500) {
      const keys = [...this.classificationCache.keys()];
      for (let i = 0; i < 100; i++) {
        this.classificationCache.delete(keys[i]!);
      }
    }

    return classification;
  }

  /**
   * parseClassification — 解析 LLM 返回的分类 JSON
   */
  private parseClassification(raw: string, goal: string): TaskClassification {
    try {
      // 提取 JSON（LLM 可能包裹在 ```json 中）
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        category: (parsed.category as string)?.toLowerCase() ?? 'general',
        taskType: (parsed.taskType as string) ?? 'unknown',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords as string[] : [],
        complexity: (parsed.complexity as TaskClassification['complexity']) ?? 'moderate',
        recommendedCapabilities: Array.isArray(parsed.recommendedCapabilities)
          ? parsed.recommendedCapabilities as string[]
          : [],
      };
    } catch {
      return this.keywordFallback(goal);
    }
  }

  /**
   * keywordFallback — LLM 不可用时的关键词降级方案
   *
   * 比原来的字符重叠法好：提取有意义的特征词而非字符集
   */
  private keywordFallback(goal: string): TaskClassification {
    const lower = goal.toLowerCase();

    // 类别判定
    let category = 'general';
    if (/写|代码|程序|脚本|开发|实现|编|编程|爬虫|API|接口|bug|修复|调试|debug|refactor|重构/.test(lower)) category = 'code';
    else if (/分析|report|报告|数据|统计|调研|research|评估|insight/.test(lower)) category = 'analysis';
    else if (/设计|design|UI|UX|界面|原型|prototype|草图/.test(lower)) category = 'design';
    else if (/测试|test|验证|verify|检查|check/.test(lower)) category = 'debug';
    else if (/写|文章|文案|翻译|内容|blog|article|copy/.test(lower)) category = 'content';
    else if (/采集|爬|抓取|清洗|建模|ETL|可视化/.test(lower)) category = 'data';

    // 关键词提取：按空格/标点分词，取 2-5 个字符的词
    const words = goal.split(/[\s，,。\.！!？?]+/).filter(w => w.length >= 2 && w.length <= 10);
    const keywords = [...new Set(words)].slice(0, 5);

    // 复杂度估算
    const complexity = goal.length > 80 || words.length > 12 ? 'complex'
      : goal.length > 30 || words.length > 5 ? 'moderate'
      : 'simple';

    return {
      category,
      taskType: category,
      keywords,
      complexity,
      recommendedCapabilities: [category],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SOP 提取
  // ═══════════════════════════════════════════════════════════════

  /**
   * extractSOP — 从成功经验中提取 SOP
   *
   * 流程：
   *   1. LLM 分类本次任务
   *   2. 查找同一 taskType 的历史成功任务
   *   3. ≥ PATTERN_THRESHOLD → 生成 SOP；已有 SOP → 更新 successCount
   */
  async extractSOP(experience: BrainExperience): Promise<SOP | null> {
    if (experience.result !== 'success') return null;

    const deptId = experience.departmentId ?? 'global';

    // 1. LLM 分类
    const classification = await this.classifyGoal(experience.goal);

    // 2. 记录任务（带分类）
    this.taskHistory.push({ goal: experience.goal, departmentId: deptId, classification, duration: experience.duration });
    if (this.taskHistory.length > 500) {
      this.taskHistory = this.taskHistory.slice(-300);
    }

    // 3. 查找同一 taskType 的相似任务（分类字段匹配）
    const similar = this.taskHistory.filter(t =>
      t.departmentId === deptId &&
      t.classification.taskType === classification.taskType,
    );

    // 4. 已有同名 SOP → 更新
    const existingSOP = this.findSOPByTaskType(classification.taskType, deptId);
    if (existingSOP) {
      existingSOP.successCount++;
      existingSOP.avgDuration = Math.round(
        (existingSOP.avgDuration * (existingSOP.successCount - 1) + experience.duration) /
        existingSOP.successCount,
      );
      existingSOP.updatedAt = Date.now();
      return existingSOP;
    }

    // 5. 不满足阈值
    if (similar.length < SOPEngine.PATTERN_THRESHOLD) return null;

    // 6. 生成 SOP
    const sop = this.generateSOP(experience, classification, similar, deptId);
    this.sops.set(sop.id, sop);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'sop.created',
      timestamp: Date.now(),
      executionId: experience.taskId,
      source: 'sop-engine',
      payload: { sopId: sop.id, title: sop.title, departmentId: deptId, category: classification.category, taskType: classification.taskType, steps: sop.steps.length, basedOn: similar.length },
    });

    console.log(`[SOPEngine] 📋 新 SOP: "${sop.title}" (${classification.taskType}, ${sop.steps.length} 步骤, 基于 ${similar.length} 次成功)`);
    return sop;
  }

  /**
   * generateSOP — 基于 LLM 分类生成 SOP
   */
  private generateSOP(
    experience: BrainExperience,
    classification: TaskClassification,
    similar: Array<{ goal: string; classification: TaskClassification; duration: number }>,
    deptId: string,
  ): SOP {
    const id = `sop_${++this.sopCounter}_${Date.now()}`;
    const avgDuration = Math.round(similar.reduce((sum, t) => sum + t.duration, 0) / similar.length);

    // 用 LLM 分类的 category 匹配 SOP 模板
    const steps = SOP_TEMPLATES[classification.category] ?? SOP_TEMPLATES['general']!;

    // 如果 LLM 推荐了特定能力，注入到步骤中
    if (classification.recommendedCapabilities.length > 0) {
      const tailoredSteps = steps.map((step, i) => {
        if (i < classification.recommendedCapabilities.length) {
          return { ...step, capability: classification.recommendedCapabilities[i]! };
        }
        return step;
      });
      return {
        id,
        title: this.extractTitle(experience.goal, classification),
        departmentId: deptId,
        category: classification.category,
        taskType: classification.taskType,
        steps: tailoredSteps,
        successCount: similar.length,
        avgDuration,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: { basedOnTasks: similar.length, complexity: classification.complexity, keywords: classification.keywords },
      };
    }

    return {
      id,
      title: this.extractTitle(experience.goal, classification),
      departmentId: deptId,
      category: classification.category,
      taskType: classification.taskType,
      steps,
      successCount: similar.length,
      avgDuration,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: { basedOnTasks: similar.length, complexity: classification.complexity, keywords: classification.keywords },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SOP 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * findRelevantSOPs — 查找与新任务相关的 SOP
   *
   * 匹配策略（按优先级）：
   *   1. 同一 taskType（LLM 分类） → 最精确
   *   2. 同一 category + 关键词重叠 → 次精确
   *   3. 同一 departmentId → 部门级匹配
   */
  async findRelevantSOPs(goal: string, departmentId?: string): Promise<SOP[]> {
    // 先对 goal 做 LLM 分类
    let classification: TaskClassification;
    try {
      classification = await this.classifyGoal(goal);
    } catch {
      classification = this.keywordFallback(goal);
    }

    const candidates = [...this.sops.values()];

    // 三层打分
    const scored = candidates.map(sop => {
      let score = 0;

      // 1. 同一 taskType（权重最高）
      if (sop.taskType === classification.taskType) score += 10;

      // 2. 同一 category
      if (sop.category === classification.category) score += 5;

      // 3. 关键词重叠
      const sopKeywords = (sop.metadata?.keywords as string[]) ?? [];
      const overlap = classification.keywords.filter(k => sopKeywords.includes(k)).length;
      score += overlap * 2;

      // 4. 同部门加分
      if (departmentId && sop.departmentId === departmentId) score += 3;

      return { sop, score };
    });

    return scored
      .filter(s => s.score > 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.sop);
  }

  /**
   * getDepartmentSOPs — 获取部门的 SOP 库
   */
  getDepartmentSOPs(departmentId: string): SOP[] {
    return [...this.sops.values()]
      .filter(s => s.departmentId === departmentId)
      .sort((a, b) => b.successCount - a.successCount);
  }

  /**
   * getSOP — 按 ID 获取 SOP
   */
  getSOP(id: string): SOP | undefined {
    return this.sops.get(id);
  }

  /**
   * findSOPByTaskType — 按 taskType 查找已有 SOP
   */
  private findSOPByTaskType(taskType: string, departmentId: string): SOP | undefined {
    return [...this.sops.values()].find(
      s => s.departmentId === departmentId && s.taskType === taskType,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  getStats(): SOPStats {
    const byDepartment: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalSuccess = 0;

    for (const sop of this.sops.values()) {
      byDepartment[sop.departmentId] = (byDepartment[sop.departmentId] || 0) + 1;
      byCategory[sop.category] = (byCategory[sop.category] || 0) + 1;
      totalSuccess += sop.successCount;
    }

    return {
      totalSOPs: this.sops.size,
      byDepartment,
      byCategory,
      avgSuccessCount: this.sops.size > 0 ? Math.round(totalSuccess / this.sops.size) : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 辅助
  // ═══════════════════════════════════════════════════════════════

  /**
   * extractTitle — 生成 SOP 标题
   */
  private extractTitle(goal: string, classification: TaskClassification): string {
    // 优先用 taskType
    const readableType = classification.taskType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    // 限制长度
    if (readableType.length <= 40) return readableType;
    return goal.substring(0, 50);
  }
}
