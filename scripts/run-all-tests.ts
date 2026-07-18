#!/usr/bin/env npx tsx
/**
 * run-all-tests.ts — MorPex v2.5 全量集成测试启动器
 *
 * 功能:
 *   1. 检查 embedding server (BGE-M3 on :3100)
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

async function checkEmbeddingServer(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:3100/health', { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    try {
      const resp = await fetch('http://localhost:3100/', { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║     MorPex v2.5 全量集成测试启动器                           ║${RESET}`);
  console.log(`${BRIGHT}║     ${new Date().toISOString()}                       ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  // 检查 embedding 服务器
  if (!QUICK) {
    console.log(`\n${CYAN}检查 BGE-M3 embedding 服务器 (localhost:3100)...${RESET}`);
    const available = await checkEmbeddingServer();
    if (available) {
      console.log(`${GREEN}✓ Embedding 服务器可用${RESET}`);
    } else {
      console.log(`${YELLOW}⚠ Embedding 服务器不可用 — 向量测试将跳过${RESET}`);
      console.log(`  启动方式: cd tools-python && python embedding-server.py --model-path data/models/bge-m3 --mode http --port 3100`);
    }
  } else {
    console.log(`\n${YELLOW}快速模式: 跳过 embedding 依赖测试${RESET}`);
  }

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
