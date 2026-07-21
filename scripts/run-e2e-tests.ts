#!/usr/bin/env npx tsx
/**
 * run-e2e-tests.ts — MorPex E2E 测试启动器
 *
 * 统一入口，运行可用的端到端测试。
 * 按可用性分层：core 测试 → UI playwright 测试 → 集成测试
 *
 * 用法:
 *   npx tsx scripts/run-e2e-tests.ts        # 运行所有可用测试
 *   npx tsx scripts/run-e2e-tests.ts --headed # Playwright 显示浏览器
 *   npx tsx scripts/run-e2e-tests.ts --quick  # 只运行核心测试（跳过 UI + 集成）
 *   npx tsx scripts/run-e2e-tests.ts --ci     # CI 模式（无头 + JUnit 报告）
 */

import { execSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BRIGHT = '\x1b[1m';
const RESET = '\x1b[0m';

const ROOT = path.resolve(import.meta.dirname ?? __dirname, '..');
const HEADED = process.argv.includes('--headed');
const QUICK = process.argv.includes('--quick');
const CI = process.argv.includes('--ci');

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
}

const results: TestResult[] = [];

async function runCommand(name: string, cmd: string, cwd: string = ROOT): Promise<TestResult> {
  const start = Date.now();
  const output: string[] = [];

  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  启动: ${name}${RESET}`);
  console.log(`${BRIGHT}  命令: ${cmd}${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}\n`);

  return new Promise<TestResult>((resolve) => {
    const proc = spawn(cmd, [], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    const onData = (chunk: string) => {
      process.stdout.write(chunk);
      output.push(chunk);
    };

    proc.stdout?.on('data', (data: Buffer) => onData(data.toString()));
    proc.stderr?.on('data', (data: Buffer) => onData(data.toString()));

    proc.on('close', (code) => {
      const durationMs = Date.now() - start;
      const passed = code === 0;
      const result: TestResult = { name, passed, durationMs, output: output.join('') };
      results.push(result);
      console.log(`\n${passed ? GREEN : RED}${BRIGHT}[${passed ? 'PASS' : 'FAIL'}] ${name} (${durationMs}ms)${RESET}`);
      resolve(result);
    });

    proc.on('error', (err: Error) => {
      const durationMs = Date.now() - start;
      const result: TestResult = { name, passed: false, durationMs, output: err.message };
      results.push(result);
      console.error(`\n${RED}[ERROR] ${name}: ${err.message}${RESET}`);
      resolve(result);
    });
  });
}

async function main(): Promise<void> {
  console.log(`${CYAN}${BRIGHT}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BRIGHT}║     MorPex E2E Test Runner                  ║${RESET}`);
  console.log(`${CYAN}${BRIGHT}╚══════════════════════════════════════════════╝${RESET}`);
  console.log(`  模式: ${CI ? 'CI' : HEADED ? 'Headed' : QUICK ? 'Quick' : 'Full'}\n`);

  // ── Tier 1: Core TypeScript 类型检查 ──
  await runCommand('[1/3] 类型检查 (core)', 'npx tsc --noEmit -p packages/core/tsconfig.json');

  if (QUICK) {
    // Quick 模式到此为止
    printSummary();
    process.exit(results.some(r => !r.passed) ? 1 : 0);
  }

  // ── Tier 2: Core 单元测试 ──
  const coreTestFiles = [
    'packages/core/__tests__/tc-1.1-toposort.ts',
    'packages/core/__tests__/tc-1.2-extractJson.ts',
    'packages/core/__tests__/tc-1.3-jsonl.ts',
    'packages/core/__tests__/tc-3.1-eventstore.ts',
    'packages/core/__tests__/tc-3.4-eventbus.ts',
  ];
  for (const testFile of coreTestFiles) {
    if (fs.existsSync(path.join(ROOT, testFile))) {
      await runCommand(`单元测试: ${path.basename(testFile)}`, `npx tsx ${testFile}`);
    } else {
      console.log(`${YELLOW}[SKIP] ${testFile} 不存在${RESET}`);
    }
  }

  // ── Tier 3: Core 集成测试 ──
  if (fs.existsSync(path.join(ROOT, 'packages/core/e2e-test.ts'))) {
    await runCommand('Core E2E 测试', 'cd packages/core && npx tsx e2e-test.ts');
  }

  if (fs.existsSync(path.join(ROOT, 'packages/memory/e2e/memory-bus-v2-audit.spec.ts'))) {
    await runCommand('Memory 审计测试', 'npx tsx packages/memory/e2e/memory-bus-v2-audit.spec.ts');
  }

  // ── Tier 4: UI 测试 (Playwright) ──
  const uiDir = path.join(ROOT, 'packages/studio/ui');
  const playwrightConfig = path.join(uiDir, 'e2e/playwright.config.ts');

  if (fs.existsSync(playwrightConfig)) {
    const headedFlag = HEADED ? '--headed' : '';
    await runCommand('UI E2E 测试 (Playwright)', `cd packages/studio/ui && npx playwright test e2e/ ${headedFlag} --reporter=list`);
  } else {
    console.log(`${YELLOW}[SKIP] Playwright 配置不存在，跳过 UI 测试${RESET}`);
  }

  // ── 汇总 ──
  printSummary();
  process.exit(results.some(r => !r.passed) ? 1 : 0);
}

function printSummary(): void {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalTime = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  测试汇总${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`  总计: ${total}  |  通过: ${passed}  |  失败: ${failed}  |  耗时: ${(totalTime / 1000).toFixed(1)}s`);

  if (failed > 0) {
    console.log(`\n${RED}${BRIGHT}  失败列表:${RESET}`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ${RED}❌ ${r.name}${RESET}`);
    }
  }
}

main();
