import type { VerificationResult } from './ExecutionVerifier.js';

export interface RepairPlan {
  artifactId: string;
  action: 'regenerate' | 'fix' | 'escalate';
  reason: string;
}

export class RepairPlanner {
  static planRepairs(verification: VerificationResult): RepairPlan[] {
    if (verification.success) return [];
    return verification.artifactResults
      .filter(r => !r.pass)
      .map(r => ({
        artifactId: r.artifactId,
        action: 'regenerate' as const,
        reason: `质量检查未通过: ${r.failures.join(', ')}`,
      }));
  }
}
