/**
 * RuntimeValidator — Phase 9 验证套件协调器
 *
 * 运行所有验证器，汇总结果，生成 ValidationReport
 */
import type { ValidationReport, TestResult } from './types.js';
import { FSMValidator } from './FSMValidator.js';
import { DAGValidator } from './DAGValidator.js';
import { RecoveryValidator } from './RecoveryValidator.js';
import { ReplayValidator } from './ReplayValidator.js';
import { ExecutionScenarioRunner } from './ExecutionScenarioRunner.js';
import { LearningValidator } from './LearningValidator.js';

export class RuntimeValidator {
  async runAll(): Promise<ValidationReport> {
    const startedAt = Date.now();
    console.log('\n' + '='.repeat(78));
    console.log('  Phase 9 — Runtime Validation Suite');
    console.log('='.repeat(78) + '\n');

    const validators = [
      { name: 'FSMValidator', run: () => new FSMValidator().run() },
      { name: 'DAGValidator', run: () => new DAGValidator().run() },
      { name: 'RecoveryValidator', run: () => new RecoveryValidator().run() },
      { name: 'ReplayValidator', run: () => new ReplayValidator().run() },
      { name: 'ExecutionScenarioRunner', run: () => new ExecutionScenarioRunner().run() },
      { name: 'LearningValidator', run: () => new LearningValidator().run() },
    ];

    const results: TestResult[] = [];
    let totalAssertions = 0;
    let totalPassed = 0;

    for (const v of validators) {
      console.log(`\n  ▶ ${v.name}...`);
      try {
        const result = await v.run();
        results.push(result);
        totalAssertions += result.assertions;
        totalPassed += result.passedAssertions;

        const icon = result.status === 'passed' ? '✅' : result.status === 'skipped' ? '⏭️' : '❌';
        console.log(`  ${icon} ${result.name}: ${result.status.toUpperCase()}`);
        console.log(`     Assertions: ${result.passedAssertions}/${result.assertions} passed`);
        if (result.errors.length > 0) {
          console.log(`     Errors: ${result.errors.length}`);
          for (const e of result.errors.slice(0, 5)) {
            console.log(`       - ${e}`);
          }
        }
        if (result.duration > 100) {
          console.log(`     Duration: ${result.duration}ms`);
        }
      } catch (e: any) {
        results.push({
          name: v.name,
          category: 'Runtime',
          status: 'error',
          duration: 0,
          assertions: 0,
          passedAssertions: 0,
          details: [],
          errors: [e.message],
        });
        console.log(`  💥 ${v.name}: ERROR - ${e.message}`);
      }
    }

    // Summary
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errored = results.filter(r => r.status === 'error').length;

    // Health score calculation
    const passRate = total > 0 ? passed / total : 0;
    const assertRate = totalAssertions > 0 ? totalPassed / totalAssertions : 0;
    const healthScore = Math.round((passRate * 0.5 + assertRate * 0.5) * 100);

    // Recommendations
    const recommendations: string[] = [];
    if (failed > 0) recommendations.push(`Fix ${failed} failed validator(s)`);
    if (errored > 0) recommendations.push(`Fix ${errored} crashed validator(s)`);
    
    const failedResults = results.filter(r => r.status === 'failed');
    for (const fr of failedResults) {
      recommendations.push(`${fr.name}: ${fr.errors.slice(0, 2).join('; ')}`);
    }

    if (healthScore < 70) recommendations.push('Improve validation coverage - core runtime not fully validated');
    if (healthScore >= 90) recommendations.push('Validation suite healthy - proceed to Phase 10-14');

    const report: ValidationReport = {
      suite: 'Phase 9 Runtime Validation',
      timestamp: Date.now(),
      summary: {
        total,
        passed,
        failed: failed + errored,
        skipped,
        duration: Date.now() - startedAt,
      },
      results,
      healthScore,
      recommendations,
    };

    this.printReport(report);
    return report;
  }

  private printReport(report: ValidationReport): void {
    console.log('\n' + '='.repeat(78));
    console.log('  📊 Validation Report');
    console.log('='.repeat(78));
    console.log(`  Suite: ${report.suite}`);
    console.log(`  Timestamp: ${new Date(report.timestamp).toISOString()}`);
    console.log('');
    console.log(`  Summary:`);
    console.log(`    Total:    ${report.summary.total}`);
    console.log(`    Passed:   ${report.summary.passed}`);
    console.log(`    Failed:   ${report.summary.failed}`);
    console.log(`    Skipped:  ${report.summary.skipped}`);
    console.log(`    Duration: ${report.summary.duration}ms`);
    console.log('');
    console.log(`  Health Score: ${report.healthScore}/100`);
    console.log('');
    console.log(`  Results:`);
    for (const r of report.results) {
      const icon = r.status === 'passed' ? ' ✅' : r.status === 'skipped' ? ' ⏭️' : ' ❌';
      console.log(`  ${icon} ${r.name} (${r.category})` +
        ` — ${r.passedAssertions}/${r.assertions} assertions passed`);
    }
    console.log('');
    if (report.recommendations.length > 0) {
      console.log('  Recommendations:');
      for (const rec of report.recommendations) {
        console.log(`    → ${rec}`);
      }
      console.log('');
    }
    console.log('='.repeat(78) + '\n');
  }
}

export { ExecutionScenarioRunner } from './ExecutionScenarioRunner.js';
export { FSMValidator } from './FSMValidator.js';
export { DAGValidator } from './DAGValidator.js';
export { RecoveryValidator } from './RecoveryValidator.js';
export { ReplayValidator } from './ReplayValidator.js';
export { LearningValidator } from './LearningValidator.js';
