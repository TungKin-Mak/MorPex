import { EventBus } from '../common/EventBus.js';

// ── Types ──

export interface BrainReflectionState {
  recentTasks: Array<{
    taskId: string;
    goal: string;
    result: 'success' | 'failure';
    duration: number;
    departmentId?: string;
  }>;
  currentPlan?: {
    id: string;
    goal: string;
    taskCount: number;
    riskLevel?: 'low' | 'medium' | 'high';
  };
  departmentId?: string;
  memorySnapshots?: Array<{
    content: string;
    relevance: number;
    source: string;
  }>;
}

export interface BrainReflectionResult {
  insights: Array<{
    type: 'improvement' | 'warning' | 'pattern' | 'suggestion';
    message: string;
    confidence: number;
  }>;
  risks: Array<{
    description: string;
    severity: 'low' | 'medium' | 'high';
    probability: number;
  }>;
  suggestions: string[];
  confidence: number;
}

export interface ReflectionEngineLike {
  reflect(state: BrainReflectionState): Promise<BrainReflectionResult>;
  readonly name: string;
}

// ── ReflectionEngine ──

export class ReflectionEngine {
  name = 'ReflectionEngine';
  version = '1.0.0';

  private eventBus: EventBus;
  private llmCaller: { generateText: (opts: { prompt: string; maxTokens?: number; temperature?: number }) => Promise<{ text: string }> } | null = null;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[ReflectionEngine] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setLLMCaller(caller: { generateText: (opts: { prompt: string; maxTokens?: number; temperature?: number }) => Promise<{ text: string }> }): void {
    this.llmCaller = caller;
  }

  async reflect(state: BrainReflectionState): Promise<BrainReflectionResult> {
    const startTime = Date.now();

    try {
      // 策略1: LLM 驱动的深度反思
      if (this.llmCaller) {
        return await this.deepReflect(state);
      }

      // 策略2: 基于规则的快速反思（降级）
      return this.ruleBasedReflect(state);
    } catch (err) {
      console.warn('[ReflectionEngine] 反思失败，使用降级策略:', (err as Error).message);
      return this.ruleBasedReflect(state);
    } finally {
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'brain.reflection.completed',
        timestamp: Date.now(),
        executionId: 'brain',
        source: 'reflection-engine',
        payload: {
          stateSnapshot: { recentCount: state.recentTasks.length, hasPlan: !!state.currentPlan },
          duration: Date.now() - startTime,
        },
      });
    }
  }

  private async deepReflect(state: BrainReflectionState): Promise<BrainReflectionResult> {
    const taskSummary = state.recentTasks.slice(-5).map(t =>
      `[${t.result}] ${t.goal.substring(0, 60)} (${t.duration}ms)`
    ).join('\n');

    const prompt = `你是一个 AI 公司的大脑，正在反思最近的执行表现。

最近任务:
${taskSummary || '(无)'}

当前计划: ${state.currentPlan ? `${state.currentPlan.goal} (${state.currentPlan.taskCount}个任务)` : '(无)'}

请分析:
1. 存在哪些风险？
2. 有什么改进建议？
3. 观察到什么模式？

返回 JSON 格式:
{
  "insights": [{"type": "improvement|warning|pattern|suggestion", "message": "...", "confidence": 0-1}],
  "risks": [{"description": "...", "severity": "low|medium|high", "probability": 0-1}],
  "suggestions": ["建议1", "建议2"]
}`;

    try {
      const response = await this.llmCaller!.generateText({ prompt, maxTokens: 800, temperature: 0.3 });
      const result = this.parseLLMResponse(response.text);
      if (result && result.insights.length > 0) {
        return result;
      }
    } catch {
      // 降级到规则反思
    }

    return this.ruleBasedReflect(state);
  }

  private parseLLMResponse(text: string): BrainReflectionResult | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        confidence: 0.7,
      };
    } catch {
      return null;
    }
  }

  private ruleBasedReflect(state: BrainReflectionState): BrainReflectionResult {
    const insights: BrainReflectionResult['insights'] = [];
    const risks: BrainReflectionResult['risks'] = [];
    const suggestions: string[] = [];

    // 分析失败任务
    const failures = state.recentTasks.filter(t => t.result === 'failure');
    if (failures.length > 0) {
      insights.push({
        type: 'warning',
        message: `最近 ${failures.length}/${state.recentTasks.length} 个任务失败`,
        confidence: 0.8,
      });
      risks.push({
        description: '连续失败可能表示方法或资源问题',
        severity: failures.length >= 3 ? 'high' : 'medium',
        probability: 0.6,
      });
      suggestions.push('审查失败任务的执行日志，识别共同模式');
    }

    // 分析计划复杂度
    if (state.currentPlan && state.currentPlan.taskCount > 5) {
      insights.push({
        type: 'suggestion',
        message: `当前计划包含 ${state.currentPlan.taskCount} 个任务，考虑拆分为更小的子计划`,
        confidence: 0.6,
      });
    }

    // 空状态
    if (state.recentTasks.length === 0) {
      insights.push({
        type: 'pattern',
        message: '系统刚启动，尚无执行历史',
        confidence: 1.0,
      });
    }

    return {
      insights,
      risks,
      suggestions,
      confidence: 0.6,
    };
  }
}
