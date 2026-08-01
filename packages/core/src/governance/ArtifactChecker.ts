import { QualityRule } from './QualityRule.js';
import type { QualityCheck } from './QualityRule.js';

export interface CheckResult {
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; message?: string }>;
}

export class ArtifactChecker {
  static async check(artifactType: string, target: unknown): Promise<CheckResult> {
    const checks = QualityRule.getChecks(artifactType);
    const results = await Promise.all(checks.map(async (c: QualityCheck) => {
      const r = await c.check(target);
      return { name: c.name, pass: r.pass, message: r.message };
    }));
    return { pass: results.every(r => r.pass), checks: results };
  }
}
