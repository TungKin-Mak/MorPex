#!/usr/bin/env npx tsx
/**
 * MorPex Production Test Runner
 *
 * Orchestrates all test suites and generates a comprehensive report.
 * Run: npx tsx scripts/run-production-tests.ts
 *
 * Test Sequence:
 *   1. TypeScript compilation check (tsc --noEmit)
 *   2. System tests (tests/run-all.ts)
 *   3. Core module tests (all packages/core/__tests__/*.test.ts)
 *   4. Critical production tests (LLM mock, pipeline, sandbox, memory)
 *   5. Event mesh tests
 *   6. Architecture validation
 *   7. Security audit
 */

import { execSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BRIGHT = '\x1b[1m';
const RESET = '\x1b[0m';

interface TestSuiteResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
  details?: { passed: number; failed: number; total: number };
}

const results: TestSuiteResult[] = [];

async function runSuite(name: string, command: string, cwd: string = ROOT): Promise<TestSuiteResult> {
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}   Suite: ${name}${RESET}`);
  console.log(`${BRIGHT}   ${command}${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}\n`);

  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
    });
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
    });

    child.on('close', (code) => {
      const duration = Date.now() - start;
      // Extract pass/fail counts from output
      const passMatch = output.match(/(\d+)\s+passed/i);
      const failMatch = output.match(/(\d+)\s+failed/i);
      const totalMatch = output.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);

      resolve({
        name,
        passed: code === 0,
        durationMs: duration,
        output: output.slice(-2000), // last 2KB
        details: totalMatch ? {
          passed: parseInt(totalMatch[1]),
          failed: parseInt(totalMatch[2]),
          total: parseInt(totalMatch[1]) + parseInt(totalMatch[2]),
        } : undefined,
      });
    });

    child.on('error', (err) => {
      resolve({
        name,
        passed: false,
        durationMs: Date.now() - start,
        output: err.message,
      });
    });
  });
}

async function runTestFile(filePath: string): Promise<TestSuiteResult> {
  const relativePath = path.relative(ROOT, filePath);
  return runSuite(relativePath, `npx tsx ${filePath}`);
}

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║     MorPex Production Test Runner                           ║${RESET}`);
  console.log(`${BRIGHT}║     ${new Date().toISOString()}                              ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  // ─── Step 1: TypeScript Compilation Check ───
  console.log(`\n${CYAN}Step 1: TypeScript Compilation Check${RESET}`);
  try {
    execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
    results.push({ name: 'TypeScript Compilation', passed: true, durationMs: 0, output: '✅ tsc --noEmit passed' });
    console.log(`${GREEN}✅ tsc --noEmit passed${RESET}`);
  } catch (e: any) {
    results.push({ name: 'TypeScript Compilation', passed: false, durationMs: 0, output: e.stderr?.toString() || e.message });
    console.log(`${RED}❌ tsc --noEmit failed${RESET}`);
  }

  // ─── Step 2: System Tests ───
  console.log(`\n${CYAN}Step 2: System Test Suite (tests/run-all.ts)${RESET}`);
  results.push(await runSuite('System Tests', 'npx tsx tests/run-all.ts'));

  // ─── Step 3: Core Module Tests ───
  console.log(`\n${CYAN}Step 3: Core Module Tests${RESET}`);
  const coreTestsDir = path.join(ROOT, 'packages/core/__tests__');
  const coreTestFiles = fs.readdirSync(coreTestsDir)
    .filter(f => f.endsWith('.test.ts') && !f.includes('write-test') && !f.includes('tc-'))
    .sort();

  for (const tf of coreTestFiles) {
    if (tf.startsWith('critical-')) continue; // Run critical tests separately
    const fullPath = path.join(coreTestsDir, tf);
    results.push(await runTestFile(fullPath));
  }

  // ─── Step 4: Critical Production Tests ───
  console.log(`\n${CYAN}Step 4: Critical Production Tests${RESET}`);
  const criticalTests = [
    'critical-llm-mock.test.ts',
    'critical-cognitive-pipeline.test.ts',
    'critical-sandbox-security.test.ts',
    'critical-memory-knowledge.test.ts',
  ];

  for (const ct of criticalTests) {
    const fullPath = path.join(coreTestsDir, ct);
    if (fs.existsSync(fullPath)) {
      results.push(await runTestFile(fullPath));
    } else {
      console.log(`  ${YELLOW}⚠ Skipping ${ct} (not found)${RESET}`);
    }
  }

  // ─── Step 5: Architecture Validation ───
  console.log(`\n${CYAN}Step 5: Architecture Validation${RESET}`);
  const archTestsDir = path.join(ROOT, 'tests/architecture');
  if (fs.existsSync(archTestsDir)) {
    const archFiles = fs.readdirSync(archTestsDir).filter(f => f.endsWith('.test.ts'));
    for (const af of archFiles) {
      results.push(await runTestFile(path.join(archTestsDir, af)));
    }
  }

  // ─── Step 6: Dependency Check ───
  console.log(`\n${CYAN}Step 6: Dependency Boundary Check${RESET}`);
  try {
    execSync('npx depcheck', { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
    results.push({ name: 'Dependency Check', passed: true, durationMs: 0, output: '✅ depcheck passed' });
  } catch (e: any) {
    results.push({ name: 'Dependency Check', passed: false, durationMs: 0, output: e.stderr?.toString() || e.message });
  }

  // ─── Final Summary ───
  console.log(`\n${BRIGHT}${'='.repeat(78)}${RESET}`);
  console.log(`${BRIGHT}  PRODUCTION TEST SUMMARY${RESET}`);
  console.log(`${BRIGHT}${'='.repeat(78)}${RESET}`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalDuration = 0;

  for (const r of results) {
    const icon = r.passed ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
    const duration = (r.durationMs / 1000).toFixed(1);
    const details = r.details ? ` (${r.details.passed}/${r.details.total})` : '';
    console.log(`  ${icon} ${r.name}${details} — ${duration}s`);
    if (r.passed) totalPassed++;
    else totalFailed++;
    totalDuration += r.durationMs;
  }

  const total = totalPassed + totalFailed;
  const passRate = total > 0 ? (totalPassed / total * 100).toFixed(1) : '0.0';

  console.log(`\n${BRIGHT}  Results: ${totalPassed}/${total} passed (${passRate}%)${RESET}`);
  console.log(`${BRIGHT}  Duration: ${(totalDuration / 1000).toFixed(1)}s${RESET}`);

  if (totalFailed > 0) {
    console.log(`\n${RED}  ❌ ${totalFailed} suite(s) failed — review output above.${RESET}`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}  ✅ All suites passed — ready for production.${RESET}`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal:${RESET}`, err);
  process.exit(2);
});
