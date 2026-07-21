/**
 * MorPex System Test Runner — 运行全部测试层，生成 System Health Report
 */
import { TestCase, TestResult, ReportGenerator, SystemHealthReport, PerformanceMetrics } from './framework.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log('\n' + '='.repeat(78));
  console.log('  MorPex v7 System Test Suite');
  console.log('='.repeat(78) + '\n');

  const allResults: TestResult[] = [];
  const categories = ['architecture', 'unit', 'integration', 'scenarios', 'chaos'];

  for (const cat of categories) {
    const dir = path.join(import.meta.dirname || '.', cat);
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts'));
      for (const file of files) {
        const mod = await import(`./${cat}/${file}`);
        const runFn = mod.default || mod.run;
        if (typeof runFn !== 'function') {
          console.log(`  ⚠️ ${cat}/${file}: no default export found`);
          continue;
        }
        const start = Date.now();
        try {
          const result: TestResult = await runFn();
          result.duration = Date.now() - start;
          result.category = cat;
          const icon = result.passed ? '✅' : '❌';
          console.log(`  ${icon} ${result.name} (${result.assertionsPassed}/${result.assertions})`);
          allResults.push(result);
        } catch (e: any) {
          console.log(`  ❌ ${cat}/${file}: ${e.message}`);
          allResults.push({
            name: `${cat}/${file}`,
            category: cat,
            passed: false,
            duration: Date.now() - start,
            assertions: 0,
            assertionsPassed: 0,
            errors: [e.message],
          });
        }
      }
    } catch {
      // directory doesn't exist
    }
  }

  // Performance metrics (synthetic baseline)
  const metrics: PerformanceMetrics = {
    dagScale: { nodes: 10, executionTimeMs: 45 },
    agentCount: 3,
    memorySize: 500,
    eventThroughput: 120,
  };

  const report = ReportGenerator.generate(allResults, metrics);
  
  console.log('\n' + ReportGenerator.format(report));
  
  const dataDir = path.resolve('data');
  ReportGenerator.save(report, dataDir);
  console.log(`\n📄 Reports saved to ${dataDir}/system-health-report.{json,txt}\n`);
  
  process.exit(report.scenarioSuccessRate >= 0.8 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
