/**
 * FeedbackAwareLearner — 消费反馈与查询失败的进化学习器
 *
 * 迭代3：将三类信号注入 Evolution / MetaLearner：
 *   1. Feedback（人工/评估反馈）
 *   2. OntologyQueryPerformed 事件（查询统计）
 *   3. OntologyReferenceValidationFailed 事件（引用失败）
 *
 * 输出：改进提案（Prompt 调整 / SOP 更新 / 强制规则加强）
 */

import type { OntologyObject } from '../ontology/types.js';
import type { IEventStore } from '../protocol/events/store/IEventStore.js';
import type { BaseEvent } from '../protocol/events/BaseEvent.js';
import type { SelfImprovementLoop } from './SelfImprovementLoop.js';

export interface EvolutionSignal {
  /** 反馈测试用例 */
  testCases: OntologyObject[];
  /** 最近查询事件统计 */
  queryStats: {
    totalQueries: number;
    avgToolsPerQuery: number;
    topQueriedTypes: Array<{ type: string; count: number }>;
  };
  /** 引用失败事件 */
  referenceFailures: Array<{
    executionId: string;
    missingIds: string[];
    timestamp: number;
  }>;
}

export interface ImprovementSuggestion {
  type: 'prompt_patch' | 'sop_update' | 'rule_strengthen' | 'training_case';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * FeedbackAwareLearner — 分析反馈与事件，生成改进建议
 *
 * 可被 SelfImprovementLoop.evolve() 或 MetaLearner 调用。
 */
export class FeedbackAwareLearner {
  constructor(
    private readonly eventStore?: IEventStore,
  ) {}

  /**
   * analyze — 分析反馈与事件，生成改进建议
   *
   * @param testCases - 测试用例列表（来自 FeedbackService.listTestCases）
   * @param limit - 最大分析事件数
   * @returns 改进建议列表
   */
  async analyze(
    testCases: OntologyObject[],
    limit = 100,
  ): Promise<{
    signals: EvolutionSignal;
    suggestions: ImprovementSuggestion[];
  }> {
    // 1. 收集事件
    const queryEvents = this.eventStore
      ? await this.eventStore.query({
          type: 'ontology.query.performed',
          limit,
        })
      : [];
    const refFailEvents = this.eventStore
      ? await this.eventStore.query({
          type: 'ontology.reference.validation_failed',
          limit: 20,
        })
      : [];

    // 2. 统计查询
    const queryStats = this.summarizeQueries(queryEvents);

    // 3. 提取引用失败
    const referenceFailures = refFailEvents.map((e) => ({
      executionId: e.executionId,
      missingIds: (e.payload?.missingIds as string[]) ?? [],
      timestamp: e.timestamp,
    }));

    const signals: EvolutionSignal = {
      testCases,
      queryStats,
      referenceFailures,
    };

    // 4. 生成建议
    const suggestions = this.generateSuggestions(signals);

    return { signals, suggestions };
  }

  /**
   * feedToEvolution — 将分析结果注入 SelfImprovementLoop
   *
   * 将 ImprovementSuggestion[] 转换为 Evolution 的 metrics 格式，
   * 调用 evolve() 走完整 8 阶段闭环。
   *
   * @param evolution - SelfImprovementLoop 实例
   * @param testCases - 测试用例列表
   */
  async feedToEvolution(
    evolution: SelfImprovementLoop,
    testCases: OntologyObject[],
  ): Promise<{ fed: number; results: Array<{ title: string; status: string }> }> {
    const { suggestions } = await this.analyze(testCases);

    const failurePatterns = suggestions.map(s => `[${s.type}] ${s.title}: ${s.description}`);
    const fed: Array<{ title: string; status: string }> = [];

    if (failurePatterns.length > 0) {
      const result = await evolution.evolve({
        taskSuccessRate: 1.0,
        avgLatency: 0,
        failurePatterns,
        artifactQuality: 0.9,
      });

      for (const p of result.proposals) {
        fed.push({ title: p.title, status: p.status });
      }
    }

    return { fed: fed.length, results: fed };
  }

  /**
   * generateSuggestions — 基于信号生成改进建议
   */
  private generateSuggestions(signals: EvolutionSignal): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // 分析测试用例中的失败模式
    const downCases = signals.testCases.filter(
      (tc) => Number(tc.properties.rating ?? 0) < 0.5,
    );
    if (downCases.length >= 3) {
      // 提取 common target types
      const targetTypes = new Map<string, number>();
      for (const tc of downCases) {
        const targetId = String(tc.properties.targetId ?? '');
        const type = targetId.includes('artifact')
          ? 'Artifact'
          : targetId.includes('mission')
            ? 'Mission'
            : 'other';
        targetTypes.set(type, (targetTypes.get(type) ?? 0) + 1);
      }
      const topType = [...targetTypes.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (topType) {
        suggestions.push({
          type: 'rule_strengthen',
          title: `加强 ${topType[0]} 类的 Ontology 查询强制`,
          description: `最近有 ${downCases.length} 条负面反馈，其中 ${topType[0]} 类 ${topType[1]} 条。建议在 ${topType[0]} 相关规划前增加额外的 ontology 查询步骤。`,
          priority: 'high',
        });
      }
    }

    // 分析引用失败
    if (signals.referenceFailures.length >= 2) {
      const allMissing = signals.referenceFailures.flatMap(
        (r) => r.missingIds,
      );
      const idPatterns = new Map<string, number>();
      for (const id of allMissing) {
        const prefix = id.split('_')[0] ?? 'unknown';
        idPatterns.set(prefix, (idPatterns.get(prefix) ?? 0) + 1);
      }
      const topPattern = [...idPatterns.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (topPattern) {
        suggestions.push({
          type: 'prompt_patch',
          title: '强化 Prompt 中的 ID 引用规范',
          description: `引用失败中出现最多的 ID 前缀为 "${topPattern[0]}"（${topPattern[1]} 次）。建议在 System Prompt 中增加针对该类 ID 的查询示例。`,
          priority: 'medium',
        });
      }
    }

    // 分析查询覆盖
    if (signals.queryStats.totalQueries > 0) {
      const topTypes = signals.queryStats.topQueriedTypes;
      const lowQueryTypes = ['SOP', 'Feedback'].filter(
        (t) => !topTypes.some((qt) => qt.type === t),
      );
      if (lowQueryTypes.length > 0) {
        suggestions.push({
          type: 'sop_update',
          title: '增加低查询类型的检索提示',
          description: `以下类型查询较少：${lowQueryTypes.join(', ')}。建议在相关任务的 Prompt 中显式提示 LLM 查询这些类型。`,
          priority: 'low',
        });
      }
    }

    // 如果没有足够数据，给出通用建议
    if (suggestions.length === 0) {
      suggestions.push({
        type: 'training_case',
        title: '收集更多反馈数据',
        description: `当前仅有 ${signals.testCases.length} 条测试用例和 ${signals.referenceFailures.length} 条引用失败，数据不足以生成具体建议。继续收集。`,
        priority: 'low',
      });
    }

    return suggestions;
  }

  /**
   * summarizeQueries — 统计查询事件
   */
  private summarizeQueries(events: BaseEvent[]): EvolutionSignal['queryStats'] {
    if (events.length === 0) {
      return {
        totalQueries: 0,
        avgToolsPerQuery: 0,
        topQueriedTypes: [],
      };
    }

    const typeCount = new Map<string, number>();
    let totalTools = 0;

    for (const e of events) {
      const toolCalls = (e.payload?.toolCalls as Array<{ name: string }>) ?? [];
      totalTools += toolCalls.length;

      for (const tc of toolCalls) {
        // 从工具名推断查询类型
        const inferredType = tc.name.replace('ontology_', '');
        typeCount.set(inferredType, (typeCount.get(inferredType) ?? 0) + 1);
      }
    }

    const topQueriedTypes = [...typeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    return {
      totalQueries: events.length,
      avgToolsPerQuery: Math.round(totalTools / events.length),
      topQueriedTypes,
    };
  }
}
