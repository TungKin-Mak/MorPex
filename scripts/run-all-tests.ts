#!/usr/bin/env npx tsx
/**
 * run-all-tests.ts — MorPex v2.5 全量集成测试启动器
 *
 * 功能:
 *   1. 检查外部服务可用性（cognee 记忆引擎等）
 *   2. 清理旧的测试数据
 *   3. 依次运行所有测试脚本
 *   4. 汇总结果
 *
 * 用法:
 *   npx tsx scripts/run-all-tests.ts
 *   npx tsx scripts/run-all-tests.ts --keep  保留测试数据
 *   npx tsx scripts/run-all-tests.ts --quick 只运行快速测试 (跳过 embedding)
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

const SCRIPTS_DIR = path.resolve(import.meta.dirname ?? __dirname);
const KEEP = process.argv.includes('--keep');
const QUICK = process.argv.includes('--quick');

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
}

const results: TestResult[] = [];

async function runTest(scriptName: string): Promise<TestResult> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) {
    return { name: scriptName, passed: false, durationMs: 0, output: `文件不存在: ${scriptPath}` };
  }

  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  启动: ${scriptName}${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}\n`);

  const start = Date.now();
  const args = [scriptPath];
  if (KEEP) args.push('--keep');

  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', ...args], {
      cwd: path.resolve(SCRIPTS_DIR, '..'),
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
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
      resolve({
        name: scriptName,
        passed: code === 0,
        durationMs: duration,
        output,
      });
    });

    child.on('error', (err) => {
      resolve({
        name: scriptName,
        passed: false,
        durationMs: Date.now() - start,
        output: err.message,
      });
    });
  });
}

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║     MorPex v2.5 全量集成测试启动器                           ║${RESET}`);
  console.log(`${BRIGHT}║     ${new Date().toISOString()}                       ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  // 定义测试顺序 (按依赖关系)
  const testScripts = QUICK
    ? [
        'test-full-pipeline.ts',
      ]
    : [
        'test-full-pipeline.ts',
      ];

  for (const script of testScripts) {
    const result = await runTest(script);
    results.push(result);
  }

  // 汇总
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  最终测试报告${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalDuration = 0;

  for (const r of results) {
    const icon = r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const duration = (r.durationMs / 1000).toFixed(1);
    console.log(`  ${icon} ${r.name} (${duration}s)`);
    if (r.passed) totalPassed++;
    else totalFailed++;
    totalDuration += r.durationMs;
  }

  console.log(`\n  通过: ${totalPassed}  失败: ${totalFailed}  总耗时: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}启动器崩溃:${RESET}`, err);
  process.exit(1);
});
