/**
 * GoalIntelligenceFacade — 目标理解引擎入口
 * v14: 用户一句话目标 → 可执行的 GoalContext
 * v17e: 接入 IntentClassifier（闲聊 vs 任务）+ 可选 LLM 注入
 */
import { GoalParser } from './GoalParser.js';
import { RequirementExtractor } from './RequirementExtractor.js';
import { ConstraintAnalyzer } from './ConstraintAnalyzer.js';
import { GoalValidator } from './GoalValidator.js';
import { IntentClassifier } from './IntentClassifier.js';
import type { GoalContext } from '../../../infrastructure/protocol/contracts/goal.js';

type LLMFn = (system: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;

let llmProvider: LLMFn | null = null;

export class GoalIntelligenceFacade {
  /** 注入 LLM（歧义意图判定用；bootstrap 装配时调用） */
  static setLLM(fn: LLMFn): void {
    llmProvider = fn;
  }

  static async understandGoal(rawGoal: string, userContext?: Record<string, unknown>): Promise<GoalContext> {
    let ctx: Partial<GoalContext> = {
      goalId: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    ctx = await GoalParser.parse(rawGoal, ctx);
    // ═══ 意图判别：闲聊 → chat；任务 → task（不建 Mission 的入口层开关）═══
    ctx.intent = await IntentClassifier.classify(rawGoal, llmProvider ?? undefined);
    ctx = await RequirementExtractor.extract(ctx as GoalContext);
    ctx = await ConstraintAnalyzer.analyze(ctx as GoalContext, userContext);
    const result = GoalValidator.validate(ctx as GoalContext);
    if (!result.valid) {
      (ctx as GoalContext).missingInformation = [...(ctx as GoalContext).missingInformation, ...result.issues];
    }
    return ctx as GoalContext;
  }
}
