/**
 * MorPex System Test Runner — 运行全部测试层，生成 System Health Report
 */
import { TestCase, TestResult, ReportGenerator, SystemHealthReport, PerformanceMetrics } from './framework.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 对无 default export / run() 的脚本式测试（node:test 风格），
 * 以子进程 `npx tsx <file>` 运行，用退出码判定通过/失败。
 */
async function runScriptStyle(dir: string, file: string, cat: string): Promise<TestResult> {
  const filePath = path.join(dir, file);
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', filePath], { cwd: process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', (code) => {
      const pass = code === 0;
      // 从 node:test 输出提取统计（可选）
      const passMatch = out.match(/ℹ pass (\d+)/);
      const failMatch = out.match(/ℹ fail (\d+)/);
      resolve({
        name: `${cat}/${file}`, category: cat, passed: pass, duration: Date.now() - start,
        assertions: passMatch ? parseInt(passMatch[1], 10) : (pass ? 1 : 0),
        assertionsPassed: passMatch ? parseInt(passMatch[1], 10) : (pass ? 1 : 0),
        errors: pass ? [] : out.split('\n').filter(l => l.includes('✖') || l.includes('not ok') || l.includes('Error')).slice(0, 5),
      });
    });
    child.on('error', (e) => {
      resolve({ name: `${cat}/${file}`, category: cat, passed: false, duration: Date.now() - start, assertions: 0, assertionsPassed: 0, errors: [e.message] });
    });
  });
}

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
          console.log(`  ▶ ${cat}/${file}: 脚本式(node:test)，走子进程运行`);
          const result = await runScriptStyle(dir, file, cat);
          const icon = result.passed ? '✅' : '❌';
          console.log(`  ${icon} ${result.name} (${result.assertionsPassed}/${result.assertions})`);
          allResults.push(result);
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
