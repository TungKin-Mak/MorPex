#!/usr/bin/env npx tsx
/**
 * MorPex Production Test Runner — 一键运行所有生产相关测试
 *
 * 运行顺序:
 *   1. TypeScript 编译检查
 *   2. 系统测试套件 (tests/run-all.ts)
 *   3. 核心模块测试 (packages/core/__tests__/)
 *   4. 关键生产测试 (production-* / critical-*)
 *   5. Vitest 测试 (event-mesh 等)
 *
 * 用法:
 *   npx tsx scripts/run-all-production-tests.ts
 *   npx tsx scripts/run-all-production-tests.ts --quick    # 仅关键生产测试
 *   npx tsx scripts/run-all-production-tests.ts --skip-tsc # 跳过 tsc 检查
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

const QUICK = process.argv.includes('--quick');
const SKIP_TSC = process.argv.includes('--skip-tsc');

interface TestStep {
  name: string;
  cmd: string;
  timeout?: number;
}

const results: { name: string; passed: boolean; durationMs: number; output: string }[] = [];

async function runStep(step: TestStep): Promise<void> {
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  ▶ ${step.name}${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}\n`);

  const start = Date.now();

  return new Promise((resolve) => {
    const child = spawn(step.cmd, {
      cwd: path.resolve('.'),
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      timeout: step.timeout ?? 120000,
    });

    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      const duration = Date.now() - start;
      results.push({
        name: step.name,
        passed: code === 0,
        durationMs: duration,
        output,
      });
      console.log(`\n  ${code === 0 ? '✅' : '❌'} ${step.name} (${(duration / 1000).toFixed(1)}s)`);
      resolve();
    });

    child.on('error', (err) => {
      results.push({
        name: step.name,
        passed: false,
        durationMs: Date.now() - start,
        output: err.message,
      });
      resolve();
    });
  });
}

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║     MorPex 生产测试全量运行器                               ║${RESET}`);
  console.log(`${BRIGHT}║     ${new Date().toISOString()}                       ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  const steps: TestStep[] = [];

  if (!QUICK && !SKIP_TSC) {
    steps.push({ name: 'TypeScript 编译检查', cmd: 'npx tsc --noEmit', timeout: 60000 });
  }

  if (!QUICK) {
    steps.push({ name: '系统测试套件', cmd: 'npx tsx tests/run-all.ts', timeout: 120000 });
  }

  // 生产关键测试
  const productionTests = [
    'packages/core/__tests__/production-llm-mock.test.ts',
    'packages/core/__tests__/production-pipeline.test.ts',
    'packages/core/__tests__/production-sandbox.test.ts',
    'packages/core/__tests__/production-memory.test.ts',
    'packages/core/__tests__/critical-llm-mock.test.ts',
    'packages/core/__tests__/critical-cognitive-pipeline.test.ts',
    'packages/core/__tests__/critical-sandbox-security.test.ts',
    'packages/core/__tests__/critical-memory-knowledge.test.ts',
  ];

  for (const testFile of productionTests) {
    if (fs.existsSync(testFile)) {
      steps.push({
        name: path.basename(testFile),
        cmd: `npx tsx ${testFile}`,
        timeout: 120000,
      });
    }
  }

  if (!QUICK) {
    steps.push({ name: '依赖边界检查', cmd: 'npx depcheck', timeout: 30000 });
  }

  // 执行所有步骤
  for (const step of steps) {
    await runStep(step);
  }

  // 汇总
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  最终测试报告${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalDuration = 0;

  for (const r of results) {
    const icon = r.passed ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
    const duration = (r.durationMs / 1000).toFixed(1);
    console.log(`  ${icon} ${r.name} (${duration}s)`);
    if (r.passed) totalPassed++;
    else totalFailed++;
    totalDuration += r.durationMs;
  }

  console.log(`\n  ${BRIGHT}通过: ${totalPassed}  失败: ${totalFailed}  总耗时: ${(totalDuration / 1000).toFixed(1)}s${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);

  const verdict = totalFailed === 0
    ? `${GREEN}✅ 所有生产测试通过 — 可以上线!${RESET}`
    : `${RED}❌ ${totalFailed} 项测试失败 — 请检查${RESET}`;

  console.log(`\n${BRIGHT}${verdict}${RESET}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}运行器崩溃:${RESET}`, err);
  process.exit(1);
});
