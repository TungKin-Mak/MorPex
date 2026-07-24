import { QualityScorer, type SystemScore } from './QualityScorer.js';

export interface EvaluationInput {
  plan?: { steps: number; capabilities: string[] };
  agents?: Array<{ name: string; successRate: number }>;
  tools?: Array<{ name: string; successCount: number; failureCount: number }>;
  artifacts?: Array<{ type: string; status: string }>;
  memory?: { recallCount: number; avgRelevance: number };
  executionResult?: { ok: boolean; duration: number; errors: string[] };
}

export interface EvaluationReport {
  missionQuality: number;
  systemScore: SystemScore;
  decision: 'continue' | 'retry' | 'replan' | 'abort';
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
    const missionQuality = systemScore.overall;
    const decision = this.scorer.decide(missionQuality);

    return { missionQuality, systemScore, decision };
  }
}
