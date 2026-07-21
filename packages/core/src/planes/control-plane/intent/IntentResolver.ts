// @ts-nocheck
/**
 * IntentResolver — 意图分类 + 置信度评估
 *
 * 直接调 LLM 进行意图理解，不经过关键词规则降级。
 * Intent 层是系统入口，准确度直接影响后续所有决策质量。
 *
 * 分类维度：
 *   - 意图类型：directive / query / ambiguous / chat
 *   - 置信度：0-1
 *   - 领域识别：software / video / ecommerce / general
 *
 * 决策逻辑：
 *   ≥0.85  → 直接执行
 *   0.6–0.85 → 需澄清
 *   <0.6   → 拒绝
 */

import type { IntentResult, IntentType, Domain, IntentResolverDeps } from './types.js';
import { LLMProvider } from '../../../services/LLMProvider.js';
import { extractJson } from '../../../utils/extractJson.js';
import { GoalExtractor } from './GoalExtractor.js';
import { ConstraintAnalyzer } from './ConstraintAnalyzer.js';
import { PriorityEngine } from './PriorityEngine.js';
import { RiskDetector } from './RiskDetector.js';
import { ExecutionPolicyGenerator } from './ExecutionPolicyGenerator.js';
import type { MemoryActivationEngine, ActivationContext } from '../../../memory/MemoryActivationEngine.js';

/**
 * 获取 parseJsonWithRepair 适配器
 * 优先使用 pi-ai 的版本（通过适配层），回退到本地 extractJson
 */
import { mpParseJsonWithRepair } from '../../../adapters/pi-utils.js';

async function getParseJsonWithRepair(): Promise<((json: string) => any) | null> {
  return mpParseJsonWithRepair ?? null;
}

/** 默认分类系统提示词 */
const DEFAULT_SYSTEM_PROMPT = `你是一个意图分类引擎。请分析用户输入，返回严格的 JSON 格式。

分类规则：
1. "directive" — 用户明确要求执行任务（写代码、生成文档、创建项目等）
2. "query" — 用户询问信息、寻求建议（"什么是…"、"如何…"、"帮我分析…"）
3. "ambiguous" — 意图不明确，可做多种解释
4. "chat" — 日常对话、打招呼、闲聊

领域识别：
- "software" — 编程、开发、技术相关
- "video" — 视频制作、剪辑、脚本
- "ecommerce" — 电商运营、商品、营销
- "general" — 通用/未明确指定

请严格按以下 JSON 格式返回，不要包含其他文字：
{
  "type": "directive|query|ambiguous|chat",
  "confidence": 0.0-1.0,
  "domain": "software|video|ecommerce|general",
  "goal": "简洁的目标描述",
  "entities": {},
  "reasoning": "简短的分析理由"
}`;

/**
 * IntentResolver — 意图解析器
 *
 * 职责：
 *   1. 构建 LLM 分类 prompt
 *   2. 调用 LLM 获取结构化分类结果
 *   3. 解析并验证响应
 *   4. 返回带置信度的 IntentResult
 *   5. (Phase 10.2) 多领域复杂意图拆解
 */
export class IntentResolver {
  private deps: IntentResolverDeps;
  private systemPrompt: string;

  /** Phase 5: Intent Intelligence modules */
  private goalExtractor = new GoalExtractor();
  private constraintAnalyzer = new ConstraintAnalyzer();
  private priorityEngine = new PriorityEngine();
  private riskDetector = new RiskDetector();
  private policyGenerator = new ExecutionPolicyGenerator();

  constructor(deps?: IntentResolverDeps, systemPrompt?: string) {
    this.deps = deps ?? {};
    this.systemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  /** Phase 13: MemoryActivationEngine for memory-aware intent resolution */
  private _memoryEngine: MemoryActivationEngine | null = null;

  /** Phase 13: Attach MemoryActivationEngine to intent resolution */
  attachMemoryEngine(engine: MemoryActivationEngine): void {
    this._memoryEngine = engine;
  }

  /** Phase 5: Enhanced intent resolution with structured analysis */
  async resolveEnhanced(
    input: string,
    memoryCtx?: Partial<ActivationContext>,
  ): Promise<{
    intent: IntentResult;
    goal: ReturnType<typeof this.goalExtractor.extract>;
    constraints: ReturnType<typeof this.constraintAnalyzer.analyze>;
    priority: ReturnType<typeof this.priorityEngine.evaluate>;
    risks: ReturnType<typeof this.riskDetector.detect>;
    policy: ReturnType<typeof this.policyGenerator.generate>;
    activatedMemories?: string[];
    memoryActivationScore?: number;
  }> {
    // Phase 13: Activate memories before intent resolution
    let activatedMemories: string[] | undefined;
    let memoryActivationScore: number | undefined;

    if (this._memoryEngine && memoryCtx) {
      const result = this._memoryEngine.activate(memoryCtx);
      activatedMemories = result.memories.map(m => m.content);
      memoryActivationScore = result.activationScore;
    }

    const intent = await this.resolve(input);
    const goal = this.goalExtractor.extract(input);
    const constraints = this.constraintAnalyzer.analyze(input);
    const priority = this.priorityEngine.calculate(goal, constraints);
    const risks = this.riskDetector.detect(goal, constraints);
    const policy = this.policyGenerator.generate(goal, constraints, priority, risks);

    return { intent, goal, constraints, priority, risks, policy, activatedMemories, memoryActivationScore };
  }

  /**
   * 解析用户输入，返回意图分类结果
   *
   * @param input - 用户原始输入
   * @returns IntentResult
   * @throws 如果 LLM 返回无效格式
   */
  async resolve(input: string): Promise<IntentResult> {
    const prompt = this.buildPrompt(input);
    let raw: string;

    try {
      raw = await LLMProvider.get()(prompt);
    } catch (err: unknown) {
      // LLM 调用失败时返回低置信度 unknown
      return {
        rawInput: input,
        type: 'ambiguous',
        confidence: 0.1,
        domain: 'general',
        goal: input,
        metadata: { error: (err as Error).message, fallback: true },
      };
    }

    const parsed = await this.parseResponse(raw, input);
    return parsed;
  }

  /**
   * 构建 LLM prompt
   * 结合系统提示词和用户输入，可选择加入领域提示
   */
  private buildPrompt(input: string): string {
    let prompt = `${this.systemPrompt}\n\n用户输入: "${input}"\n\n请分析以上用户输入并返回 JSON。`;

    if (this.deps.domainHints && this.deps.domainHints.length > 0) {
      prompt += `\n\n领域提示（可能相关）：${this.deps.domainHints.join(', ')}`;
    }

    return prompt;
  }

  /**
   * 解析 LLM 返回的 JSON 响应
   *
   * 优先使用 pi-ai 的 parseJsonWithRepair（更健壮的 JSON 修复），
   * 降级到手动提取 JSON 并 JSON.parse。
   *
   * 处理 LLM 可能返回的各种格式：
   * - 纯 JSON
   * - Markdown 代码块中的 JSON
   * - 包含额外解释的 JSON
   * - 带语法错误的 JSON（由 parseJsonWithRepair 自动修复）
   */
  private async parseResponse(raw: string, input: string): Promise<IntentResult> {
    // 尝试提取 JSON 字符串
    const jsonStr = extractJson(raw);

    if (!jsonStr) {
      console.warn('[IntentResolver] LLM 返回非 JSON 格式，使用 fallback');
      return {
        rawInput: input,
        type: 'ambiguous',
        confidence: 0.2,
        domain: 'general',
        goal: input,
        metadata: { parseError: true, raw },
      };
    }

    try {
      // 优先使用 pi-ai 的 parseJsonWithRepair（更健壮）
      const parseFn = await getParseJsonWithRepair();
      let data: any;

      if (parseFn) {
        // pi-ai 的 parseJsonWithRepair 自动修复常见 JSON 错误
        data = parseFn(jsonStr);
      } else {
        // 降级到标准 JSON.parse
        data = JSON.parse(jsonStr);
      }

      // 验证必要字段
      const type = this.validateType(data.type);
      const confidence = this.validateConfidence(data.confidence);
      const domain = this.validateDomain(data.domain);
      const goal = typeof data.goal === 'string' ? data.goal : input;

      return {
        rawInput: input,
        type,
        confidence,
        domain,
        goal: goal.substring(0, 500), // 防止超长
        entities: data.entities ?? {},
        metadata: { reasoning: data.reasoning ?? '' },
      };
    } catch (err: unknown) {
      console.warn('[IntentResolver] JSON 解析失败:', (err as Error).message);
      return {
        rawInput: input,
        type: 'ambiguous',
        confidence: 0.2,
        domain: 'general',
        goal: input,
        metadata: { parseError: (err as Error).message, raw: jsonStr },
      };
    }
  }

  /**
   * 验证并规范化意图类型
   */
  private validateType(type: string): IntentType {
    const valid: IntentType[] = ['directive', 'query', 'ambiguous', 'chat'];
    const lower = type?.toLowerCase().trim() as IntentType;
    return valid.includes(lower) ? lower : 'ambiguous';
  }

  /**
   * 验证并截取置信度到 0-1 区间
   */
  private validateConfidence(confidence: number): number {
    const c = typeof confidence === 'number' ? confidence : 0;
    return Math.max(0, Math.min(1, c));
  }

  /**
   * 验证并规范化领域
   */
  private validateDomain(domain: string): Domain {
    const valid: Domain[] = ['software', 'video', 'ecommerce', 'general'];
    const lower = domain?.toLowerCase().trim() as Domain;
    return valid.includes(lower) ? lower : 'general';
  }

  /**
   * 更新系统提示词（用于插件重新配置）
   */
  updateSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 更新领域提示词
   */
  updateDomainHints(hints: string[]): void {
    this.deps.domainHints = hints;
  }
}
