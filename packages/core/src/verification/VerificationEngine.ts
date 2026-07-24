import { QualityRule } from './QualityRule.js';
import { ExecutionVerifier } from './ExecutionVerifier.js';
import { RepairPlanner } from './RepairPlanner.js';
import type { Artifact } from '../contracts/artifact.js';
import type { VerificationResult } from './ExecutionVerifier.js';
import type { RepairPlan } from './RepairPlanner.js';

export class VerificationEngine {
  constructor() {
    QualityRule.init();
  }

  async verify(artifacts: Artifact[]): Promise<{ success: boolean; result: VerificationResult; repairs: RepairPlan[] }> {
    const result = await ExecutionVerifier.verify(artifacts);
    const repairs = result.success ? [] : RepairPlanner.planRepairs(result);
    return { success: result.success, result, repairs };
  }
}
