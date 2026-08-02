import { QualityScorer, type SystemScore } from './QualityScorer.js';
import {
  scoreOntologyCompliance,
  type OntologyComplianceScore,
} from './ontologyCompliance.js';
import type { ForcedQueryGuard } from '../gate/ForcedQueryGuard.js';
import type { EventBus } from '../infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../infrastructure/common/types.js';
import { SYSTEM_EVENT_TYPES } from '../infrastructure/protocol/events/EventTypes.js';

export interface EvaluationInput {
  /** 关联 Mission ID（可选，事件 payload 携带） */
  missionId?: string;
  /** 关联部门 ID（可选，事件 payload 携带，L7 ActiveEvolutionTrigger 依赖 payload.departmentId） */
  departmentId?: string;
  plan?: { steps: number; capabilities: string[] };
  agents?: Array<{ name: string; successRate: number }>;
  tools?: Array<{ name: string; successCount: number; failureCount: number }>;
  artifacts?: Array<{ type: string; status: string }>;
  memory?: { recallCount: number; avgRelevance: number };
  executionResult?: { ok: boolean; duration: number; errors: string[] };

  // ── Ontology 迭代2 ──
  ontologyCompliance?: {
    guard: ForcedQueryGuard;
    executionId: string;
    referencedIds: string[];
  };
}

export interface EvaluationReport {
  missionQuality: number;
  systemScore: SystemScore;
  decision: 'continue' | 'retry' | 'replan' | 'abort';

  // ── Ontology 迭代2 ──
  ontologyCompliance?: OntologyComplianceScore;
  needsHumanReview?: boolean;
}

export interface EvaluationEngineOptions {
  /** missionQuality（0-1 归一化后）低于此值发射 evaluation.low_score（默认 0.6，与 L7 ActiveEvolutionTrigger 的 0.4 退化阈值同刻度） */
  lowScoreThreshold?: number;
}

/**
 * evaluation.scored / evaluation.low_score 事件 payload
 * L7 演化层只消费事件，禁止被 L4 直接触发生产变更。
 */
export interface EvaluationScoredPayload {
  missionId?: string;
  departmentId?: string;
  qualityScore: number;
  decision: 'continue' | 'retry' | 'replan' | 'abort';
  needsHumanReview: boolean;
  /** 仅 evaluation.low_score：低分原因 */
  reason?: 'below_threshold';
  /** 仅 evaluation.low_score：触发阈值 */
  threshold?: number;
}

export class EvaluationEngine {
  private scorer = new QualityScorer();
  private readonly eventBus?: EventBus;
  private readonly lowScoreThreshold: number;

  constructor(eventBus?: EventBus, options?: EvaluationEngineOptions) {
    this.eventBus = eventBus;
    this.lowScoreThreshold = options?.lowScoreThreshold ?? 0.6;
  }

  /**
   * 系统级评价（v16 Phase 1-2）
   * 保持纯函数返回值不变；若注入了 EventBus，额外发射
   * evaluation.scored（总是）与 evaluation.low_score（低于阈值时）。
   */
  evaluate(input: EvaluationInput): EvaluationReport {
    const report = this.computeReport(input);
    this.emitEvaluationEvents(input, report);
    return report;
  }

  private computeReport(input: EvaluationInput): EvaluationReport {
    const planQuality = input.plan
      ? Math.min(1, input.plan.steps / 10)
      : 0.5;
    const agentQuality =
      input.agents && input.agents.length > 0
        ? input.agents.reduce((s, a) => s + a.successRate, 0) /
          input.agents.length
        : 0.5;
    const toolQuality =
      input.tools && input.tools.length > 0
        ? input.tools.reduce(
            (s, t) =>
              s +
              t.successCount /
                Math.max(1, t.successCount + t.failureCount),
            0,
          ) / input.tools.length
        : 0.5;
    const outputQuality =
      input.artifacts && input.artifacts.length > 0
        ? input.artifacts.filter(
            a => a.status === 'APPROVED' || a.status === 'RELEASED',
          ).length / input.artifacts.length
        : 0.5;
    const memoryQuality = input.memory
      ? Math.min(1, input.memory.avgRelevance)
      : 0.5;

    const systemScore = this.scorer.scoreSystem({
      planQuality,
      agentQuality,
      toolQuality,
      outputQuality,
      memoryQuality,
    });

    // ── Ontology 迭代2: 合规评分 ──
    let ontologyCompliance: OntologyComplianceScore | undefined;
    let needsHumanReview = false;

    if (input.ontologyCompliance) {
      const { guard, executionId, referencedIds } = input.ontologyCompliance;
      ontologyCompliance = scoreOntologyCompliance(guard, executionId, referencedIds);

      // ═══════════════════════════════════════════════════════
      // P1.3 硬门禁：不依赖权重，queryScore=0 直接强制 replan
      // ═══════════════════════════════════════════════════════
      if (ontologyCompliance.queryScore < 1) {
        needsHumanReview = true;
        systemScore.suggestions.push('🚫 Ontology 未查询 → 强制 replan');
        return {
          missionQuality: 0,
          systemScore,
          decision: 'replan',
          ontologyCompliance,
          needsHumanReview: true,
        };
      }
      // 有引用但引用无效 → needs_human_review，降 decision
      if (
        ontologyCompliance.referenceScore < 1 &&
        ontologyCompliance.referencedCount > 0
      ) {
        needsHumanReview = true;
        systemScore.suggestions.push('⚠️ 引用无效，建议人工审查');
        if (ontologyCompliance.missingIds.length > 0) {
          systemScore.suggestions.push(`  缺失 ID: ${ontologyCompliance.missingIds.join(', ')}`);
        }
        // 引用无效时降 decision
        const currentDecision = this.scorer.decide(systemScore.overall);
        if (currentDecision === 'continue') {
          return {
            missionQuality: systemScore.overall,
            systemScore,
            decision: 'retry',
            ontologyCompliance,
            needsHumanReview: true,
          };
        }
      }

      // 正常情况：在 systemScore 中添加额外维度信息（仅参考，不参与加权）
      systemScore.dimensions.push({
        name: 'Ontology Query Compliance',
        score: ontologyCompliance.queryScore * 100,
        weight: 0,
        details: `工具调用 ${ontologyCompliance.callCount} 次`,
      });
      systemScore.dimensions.push({
        name: 'Reference Validity',
        score: ontologyCompliance.referenceScore * 100,
        weight: 0,
        details: `引用 ${ontologyCompliance.referencedCount} 个 ID, 缺失 ${ontologyCompliance.missingIds.length}`,
      });
    }

    const missionQuality = systemScore.overall;
    const decision = this.scorer.decide(missionQuality);

    return {
      missionQuality,
      systemScore,
      decision,
      ontologyCompliance,
      needsHumanReview,
    };
  }

  /**
   * emitEvaluationEvents — L6 → L7 事件桥（Wave 3a 修复：此前 evaluation.scored 全仓无人 emit）
   * 低分只发事件，不直接触发任何生产变更；L7 自行订阅消费。
   */
  private emitEvaluationEvents(input: EvaluationInput, report: EvaluationReport): void {
    if (!this.eventBus) return;

    const base: Pick<MorPexEvent, 'id' | 'timestamp' | 'executionId' | 'source' | 'type'> = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      executionId: input.missionId ?? `eval_${Date.now()}`,
      source: 'evaluation-engine',
      type: SYSTEM_EVENT_TYPES.EVALUATION_SCORED,
    };

    const payload: EvaluationScoredPayload = {
      missionId: input.missionId,
      departmentId: input.departmentId,
      // 归一化到 0-1：QualityScorer.overall 是 0-100，而 L7 订阅方（ActiveEvolutionTrigger）按 0-1 处理
      qualityScore: report.missionQuality / 100,
      decision: report.decision,
      needsHumanReview: report.needsHumanReview ?? false,
    };

    this.eventBus.emit({ ...base, payload });

    if (report.missionQuality / 100 < this.lowScoreThreshold) {
      this.eventBus.emit({
        ...base,
        type: SYSTEM_EVENT_TYPES.EVALUATION_LOW_SCORE,
        payload: {
          ...payload,
          reason: 'below_threshold',
          threshold: this.lowScoreThreshold,
        },
      });
    }
  }
}
