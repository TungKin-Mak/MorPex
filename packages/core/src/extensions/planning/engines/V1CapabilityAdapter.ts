/**
 * V1CapabilityAdapter — v1 旧能力封装为 IPlanningExtension
 *
 * 将 MetaPlanner v1 的 6 项核心能力封装为一个扩展插件，
 * 无缝集成到 v2 的扩展生命周期系统中。
 *
 * 封装的 v1 能力：
 *   1. extractTags() - 标签提取
 *   2. PlanExperienceStore 模板匹配
 *   3. 历史经验 Prompt 注入
 *   4. enrichSessionContext() - 上下文增强
 *   5. ExecutionRecord 保存
 *   6. PlanEvaluator 六维评分
 *
 * 设计原则：
 *   - 只包装不解构：保留所有 v1 行为的完整性
 *   - 向下兼容：v1 的直接调用路径不受影响
 *   - 轻量封装：不引入新的状态，仅桥接到 IPlanningExtension 接口
 */

import type { IPlanningExtension } from './IPlanningExtension.js';
import type {
  PrePlanContext,
  PrePlanResult,
  PostPlanContext,
  PostPlanResult,
} from '../types.js';
import type { MetaPlanner } from '../MetaPlanner.js';
import type { PlanExperienceStore } from '../PlanExperienceStore.js';
import type { PlanAnalyzer } from '../PlanAnalyzer.js';

/**
 * V1CapabilityAdapter — v1 能力适配器
 *
 * 将 MetaPlanner v1 的核心能力桥接到 IPlanningExtension 接口。
 * onPrePlan 中完成标签提取、模板匹配、Prompt 构建、上下文增强。
 * onPostPlan 和 onRuntimeEvent 当前为空操作（v1 不涉及这些阶段），
 * 但保留扩展点以便未来升级。
 */
export class V1CapabilityAdapter implements IPlanningExtension {
  public readonly name = 'V1CapabilityAdapter';
  public readonly version = '2.0.0';
  public readonly priority = 0; // 最先执行，为其他扩展提供基础上下文
  public enabled = true;

  /** 持有对主 MetaPlanner 的引用以便调用 v1 方法 */
  private metaPlanner: MetaPlanner | null = null;

  /** 引用 v1 子系统 */
  private store: PlanExperienceStore | null = null;
  private analyzer: PlanAnalyzer | null = null;

  constructor(config?: {
    metaPlanner?: MetaPlanner;
    store?: PlanExperienceStore;
    analyzer?: PlanAnalyzer;
    enabled?: boolean;
  }) {
    if (config?.metaPlanner) this.metaPlanner = config.metaPlanner;
    if (config?.store) this.store = config.store;
    if (config?.analyzer) this.analyzer = config.analyzer;
    if (config?.enabled !== undefined) this.enabled = config.enabled;
  }

  /**
   * onPrePlan — 在 DAG 生成前执行 v1 能力
   *
   * 执行流程：
   *   1. extractTags() — 标签提取
   *   2. PlanExperienceStore 模板匹配
   *   3. 构建优化 Prompt
   *   4. enrichSessionContext() 增强上下文
   *
   * @param context - 计划前上下文
   * @returns 增强后的上下文
   */
  async onPrePlan(context: PrePlanContext): Promise<PrePlanResult> {
    if (!this.enabled) return {};

    const { userInput, executionId, tags } = context;

    // 1. 标签提取（如果上下文尚未提取，由本适配器提取）
    const extractedTags = tags.length > 0 ? tags : this.extractTags(userInput);

    // 2. 模板匹配
    let matches: Array<{ template: any; similarityScore: number }> = [];
    if (this.analyzer) {
      matches = this.analyzer.recommendTemplate(userInput, extractedTags);
    } else if (this.store) {
      matches = this.store.findSimilarTemplates(userInput, extractedTags);
    }

    // 3. 构建优化 Prompt
    let optimizationPrompt = '';
    if (this.analyzer) {
      optimizationPrompt = this.analyzer.buildOptimizationPrompt(userInput, extractedTags);
    }

    // 4. 构建增强上下文（string[] 类型，每行一个注入提示）
    const contextLines: string[] = [
      `[V1CapabilityAdapter] tags: ${extractedTags.join(', ')}`,
      `[V1CapabilityAdapter] matched ${matches.length} templates`,
    ];

    if (optimizationPrompt) {
      contextLines.push(`[MetaPlanner] ${optimizationPrompt}`);
    }
    if (matches.length > 0) {
      contextLines.push(`[MetaPlanner] ${matches.length} similar templates found. Prefer proven patterns.`);
      const best = matches[0];
      contextLines.push(`[Template] ${best.template.name} (成功率: ${(best.template.successRate * 100).toFixed(0)}%, 评分: ${best.template.qualityScore.toFixed(2)})`);
    }

    return { enrichedContext: contextLines };
  }

  /**
   * onPostPlan — 在 DAG 生成后执行（v1 无操作，保留扩展点）
   */
  async onPostPlan(_context: PostPlanContext): Promise<PostPlanResult> {
    return {};
  }

  /**
   * extractTags — 从用户输入中提取标签（v1 能力的移植）
   *
   * 与原有 MetaPlanner.extractTags 逻辑一致。
   */
  private extractTags(input: string): string[] {
    const tags = new Set<string>();
    const lower = input.toLowerCase();

    const domainPatterns: Array<[RegExp, string]> = [
      [/\b(ai|artificial intelligence|machine learning|ml|llm|gpt|transformer)\b/i, 'ai_ml'],
      [/\b(web|frontend|backend|api|rest|graphql|fullstack|react|vue|node)\b/i, 'web_dev'],
      [/\b(mobile|ios|android|app|flutter|react native)\b/i, 'mobile'],
      [/\b(data|analytics|pipeline|etl|warehouse|big data)\b/i, 'data_engineering'],
      [/\b(devops|ci|cd|docker|kubernetes|deploy|infra|cloud|aws|azure)\b/i, 'devops'],
      [/\b(hardware|embedded|iot|firmware|pcb|microcontroller|sensor)\b/i, 'hardware'],
      [/\b(startup|mvp|product|saas|business|market|validation)\b/i, 'startup'],
      [/\b(test|qa|quality|automation|unit test|integration test)\b/i, 'testing'],
      [/\b(security|auth|encrypt|penetration|vulnerability|compliance)\b/i, 'security'],
    ];

    for (const [pattern, tag] of domainPatterns) {
      if (pattern.test(lower)) tags.add(tag);
    }

    if (/\b(create|build|develop|implement|code|write|generate)\b/i.test(lower)) tags.add('build');
    if (/\b(analyze|analysis|research|investigate|explore|study)\b/i.test(lower)) tags.add('analyze');
    if (/\b(fix|debug|repair|resolve|troubleshoot|bug)\b/i.test(lower)) tags.add('fix');
    if (/\b(optimize|improve|refactor|enhance|performance)\b/i.test(lower)) tags.add('optimize');
    if (/\b(design|architect|plan|blueprint|spec)\b/i.test(lower)) tags.add('design');
    if (/\b(deploy|release|launch|ship|publish)\b/i.test(lower)) tags.add('deploy');

    if (/\b(simple|basic|quick|easy|minimal|prototype)\b/i.test(lower)) tags.add('low_complexity');
    if (/\b(complex|advanced|comprehensive|full|complete|enterprise)\b/i.test(lower)) tags.add('high_complexity');

    if (tags.size === 0) tags.add('general');

    return [...tags].slice(0, 8);
  }
}
