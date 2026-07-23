/**
 * Architecture: Module Graph — uses Auditor to verify module health
 */
import { ArchitectureAuditor } from '../../packages/core/src/auditor/ArchitectureAuditor.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const assert = new AssertionContext();

  const auditor = new ArchitectureAuditor();
  const report = await auditor.runFullAudit();

  assert.assert(report.modules.length >= 150, `Module count >= 150: ${report.modules.length}`);
  assert.assert(report.architectureScore >= 85, `Score >= 85: ${report.architectureScore}`);
  assert.assert(report.runtimeCoverage.coverage >= 0.8, `Runtime coverage >= 80%`);
  assert.assert(report.criticalIssues.length === 0, `Zero critical issues: ${report.criticalIssues.length}`);
  assert.assert(report.missingEdges.length <= 1, `Missing edges <= 1: ${report.missingEdges.length}`);

  return {
    name: 'Architecture: Module Graph', category: 'architecture',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
