import { QualityScorer, type SystemScore } from './QualityScorer.js';
import {
  scoreOntologyCompliance,
  type OntologyComplianceScore,
} from './ontologyCompliance.js';
import type { ForcedQueryGuard } from '../ontology/ForcedQueryGuard.js';

export interface EvaluationInput {
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

export class EvaluationEngine {
  private scorer = new QualityScorer();

  /** 系统级评价（v16 Phase 1-2） */
  evaluate(input: EvaluationInput): EvaluationReport {
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

      // 查询分为 0 → needs_human_review
      if (ontologyCompliance.queryScore < 1) {
        needsHumanReview = true;
      }
      // 有引用但引用无效 → needs_human_review
      if (
        ontologyCompliance.referenceScore < 1 &&
        ontologyCompliance.referencedCount > 0
      ) {
        needsHumanReview = true;
      }

      // 在 systemScore 中添加额外维度信息
      systemScore.dimensions.push({
        name: 'Ontology Query Compliance',
        score: ontologyCompliance.queryScore * 100,
        weight: 0.05,
        details: `工具调用 ${ontologyCompliance.callCount} 次`,
      });
      systemScore.dimensions.push({
        name: 'Reference Validity',
        score: ontologyCompliance.referenceScore * 100,
        weight: 0.05,
        details: `引用 ${ontologyCompliance.referencedCount} 个 ID, 缺失 ${ontologyCompliance.missingIds.length}`,
      });

      // 重新计算 overall 分数（包含 ontology 维度）
      const totalWeight = systemScore.dimensions.reduce((s, d) => s + d.weight, 0);
      systemScore.overall = Math.round(
        systemScore.dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight,
      );

      if (needsHumanReview) {
        systemScore.suggestions.push('⚠️ Ontology 查询合规不通过，建议人工审查');
        if (ontologyCompliance.missingIds.length > 0) {
          systemScore.suggestions.push(`  缺失 ID: ${ontologyCompliance.missingIds.join(', ')}`);
        }
      }
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
}
