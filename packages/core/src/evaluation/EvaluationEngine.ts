import { QualityScorer } from './QualityScorer.js';
import type { ScoreReport } from './QualityScorer.js';

export class EvaluationEngine {
  private scorer = new QualityScorer();

  evaluate(result: { ok: boolean; duration: number; artifacts: unknown[]; errors: string[] }): {
    report: ScoreReport;
    decision: 'continue' | 'retry' | 'replan' | 'abort';
  } {
    const report = this.scorer.score({
      taskSuccessRate: result.ok ? 1.0 : 0.0,
      avgLatency: result.duration,
      artifactQuality: result.artifacts.length > 0 ? 0.9 : 0.0,
      retryCount: result.errors.length,
      costEfficiency: result.ok ? 0.8 : 0.3,
    });
    const decision = this.scorer.decide(report.overall);
    return { report, decision };
  }
}
