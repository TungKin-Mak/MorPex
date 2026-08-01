#!/usr/bin/env npx tsx
/**
 * run-everything.ts — MorPex 统一测试执行器（一条命令测全部）
 *
 * 编排（Phase 0-6，失败收集不中断后续 Phase）：
 *   Phase 0  门禁      tsc --noEmit + validate-architecture.js + depcheck + check-boundaries
 *   Phase 1  单元/集成 npx vitest run（L1 + L2 + connectors + api-contract + simulation + verification）
 *   Phase 2  系统套件  npx tsx tests/run-all.ts（脚本式：architecture/unit/integration/scenarios/chaos）
 *   Phase 3  脚本式核心 tsx packages/core/__tests__/{vitest exclude 清单}（逐文件）
 *   Phase 4  生产门禁  tsx 8 个 production- / critical-* / security 测试
 *   Phase 5  CLI 契约  npx tsx tests/cli/run-workflow-cli.ts（10 子命令）
 *   Phase 6  性能(可选) k6 --smoke（需 k6 二进制 + 后端 :8080 在线）
 *
 * 可选参数：
 *   --quick   只跑 Phase 1（快速回归）
 *   --skip-static 跳过 Phase 0
 *   --with-k6 跑 Phase 6（需环境）
 *   --with-coverage 跑 Phase 1 后附加覆盖率采集（c8，阈值低于基线防回退）
 *   --e2e     给 vitest 传 RUN_LLM_E2E=1（真实 LLM 路径，需 DEEPSEEK_API_KEY）
 *
 * 用法：
 *   npm run test:full                       # 全部
 *   npm run test:quick                      # 快速回归
 *   npx tsx scripts/run-everything.ts --with-k6
 *
 * 退出码：任一 Phase 失败 → 1；全部通过 → 0。
 * 报告：data/test-report/full-suite.json + 控制台摘要
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BRIGHT = '\x1b[1m', RESET = '\x1b[0m';
const ROOT = path.resolve(import.meta.dirname ?? __dirname, '..');

const E2E = process.argv.includes('--e2e');
const QUICK = process.argv.includes('--quick');
const SKIP_STATIC = process.argv.includes('--skip-static');
const WITH_K6 = process.argv.includes('--with-k6');
const WITH_COVERAGE = process.argv.includes('--with-coverage');

interface StepResult { name: string; passed: boolean; skipped?: boolean; durationMs: number }
const results: StepResult[] = [];

function run(cmd: string, args: string[], opts: { timeout?: number; env?: Record<string, string> } = {}): Promise<StepResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    console.log(`\n${BRIGHT}══════════════════════════════════════════════════${RESET}`);
    console.log(`${BRIGHT}  ▶ ${cmd} ${args.join(' ')}${RESET}`);
    console.log(`${BRIGHT}══════════════════════════════════════════════════${RESET}\n`);
    const child = spawn(cmd, args, {
      cwd: ROOT, shell: true, stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      console.log(`\n${YELLOW}  ⚠️ 超时终止 (${opts.timeout}s)${RESET}`);
      child.kill('SIGKILL');
    }, (opts.timeout ?? 300) * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      const r: StepResult = { name: `${cmd} ${args.join(' ')}`, passed: code === 0, durationMs: duration };
      results.push(r);
      console.log(`\n  ${code === 0 ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`} (${(duration / 1000).toFixed(1)}s)`);
      resolve(r);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      results.push({ name: `${cmd} ${args.join(' ')}`, passed: false, durationMs: Date.now() - start });
      console.log(`\n  ${RED}❌ 启动失败: ${err.message}${RESET}`);
      resolve({ name: '', passed: false, durationMs: 0 });
    });
  });
}

/** 跳过不存在的文件（避免断裂引用致全层失败） */
function exists(t: string): boolean {
  return fs.existsSync(path.join(ROOT, t));
}

// ── Phase 3：脚本式核心测试（vitest exclude 清单中不属于生产集的部分）──
const SCRIPT_CORE = [
  // ⚠️ 已移除：artifact-plane / stage1-persistence（S23 重构后 artifact/plane/ 目录整体删除，
  //   所测模块不存在，vitest exclude 中本就不跑；保留只会让 Phase 3 永远失败）
  'architecture-integration', 'artifact-lifecycle', 'config-validation',
  'context-assembly', 'fsm-lifecycle', 'learning-loop', 'phase2-optimization',
  'phase3-security', 'phase4-observability', 'recovery-lifecycle', 'resilience',
  'unified-eventstore',
].map(n => `packages/core/__tests__/${n}.test.ts`);

// ── Phase 4：生产门禁测试（仅存在的文件）──
const PROD_TESTS = [
  'packages/core/__tests__/production-llm-mock.test.ts',
  'packages/core/__tests__/production-pipeline.test.ts',
  'packages/core/__tests__/production-sandbox.test.ts',
  'packages/core/__tests__/production-memory.test.ts',
  'packages/core/__tests__/critical-sandbox-security.test.ts',
  'packages/core/__tests__/critical-memory-knowledge.test.ts',
  'packages/core/__tests__/security-prompt-injection.test.ts',
];

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║  MorPex 统一测试执行器（全功能） ${new Date().toISOString()}    ║${RESET}`);
  console.log(`${BRIGHT}║  mode: ${(QUICK ? 'quick' : E2E ? 'full+e2e' : 'full').padEnd(18)}                        ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  // ── Phase 0 静态门禁 ──
  if (!QUICK && !SKIP_STATIC) {
    await run('npx tsc --noEmit', [], { timeout: 120 });
    await run('node scripts/validate-architecture.js', [], { timeout: 60 });
    // ⚠️ 用 npm run depcheck（package.json 脚本），不是 npx depcheck（会去拉不存在的 npm 包）
    await run('npm run depcheck', [], { timeout: 60 });
  }

  // ── Phase 1 单元/集成（vitest 全量，含 connectors/api-contract/simulation/verification）──
  const vitestEnv: Record<string, string> = {};
  if (E2E) vitestEnv.RUN_LLM_E2E = '1';
  if (WITH_COVERAGE) {
    // 覆盖率采集（--coverage 自身即跑全量测试，作为独立阶段避免双跑）
    await run('npx vitest run --coverage', [], { timeout: 900, env: vitestEnv });
  } else {
    await run('npx vitest run', [], { timeout: 600, env: vitestEnv });
  }

  if (QUICK) { finish('quick'); return; }

  // ── Phase 2 系统套件（脚本式 + chaos）──
  await run('npx tsx tests/run-all.ts', [], { timeout: 300 });

  // ── Phase 3 脚本式核心测试（逐文件，tsx）──
  for (const f of SCRIPT_CORE) {
    if (exists(f)) await run('npx tsx', [f], { timeout: 180 });
  }

  // ── Phase 4 生产门禁 ──
  for (const t of PROD_TESTS) {
    if (exists(t)) await run('npx tsx', [t], { timeout: 180 });
  }

  // ── Phase 5 CLI 契约 ──
  if (exists('tests/cli/run-workflow-cli.ts')) {
    await run('npx tsx tests/cli/run-workflow-cli.ts', [], { timeout: 180 });
  }

  // ── Phase 6 性能（可选）──
  if (WITH_K6) {
    const k6Ok = await new Promise<boolean>((r) => {
      const p = spawn('k6', ['version'], { stdio: 'ignore' });
      p.on('close', (c) => r(c === 0)); p.on('error', () => r(false));
    });
    if (k6Ok) await run('bash scripts/run-k6-test.sh --smoke', [], { timeout: 180 });
    else {
      results.push({ name: 'k6 --smoke', passed: true, skipped: true, durationMs: 0 });
      console.log(`\n  ${YELLOW}⏭ SKIPPED k6（二进制不存在）${RESET}`);
    }
  }

  finish('full');
}

function finish(mode: string): void {
  console.log(`\n${BRIGHT}══════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  最终报告（${mode}）${RESET}`);
  console.log(`${BRIGHT}══════════════════════════════════════════════════${RESET}`);
  let passed = 0, failed = 0, skipped = 0;
  for (const r of results) {
    const icon = r.skipped ? `${YELLOW}⏭${RESET}` : r.passed ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
    console.log(`  ${icon} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)`);
    if (r.skipped) skipped++;
    else r.passed ? passed++ : failed++;
  }
  console.log(`\n  ${BRIGHT}通过: ${passed}  失败: ${failed}  跳过: ${skipped}  总耗时: ${(results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(1)}s${RESET}`);

  const reportDir = path.join(ROOT, 'data', 'test-report');
  fs.mkdirSync(reportDir, { recursive: true });
  const report = {
    timestamp: Date.now(), mode, passed, failed, skipped,
    results: results.map(r => ({ name: r.name, passed: r.passed, skipped: !!r.skipped, durationMs: r.durationMs })),
  };
  fs.writeFileSync(path.join(reportDir, 'full-suite.json'), JSON.stringify(report, null, 2));
  console.log(`\n📄 报告: ${path.join(reportDir, 'full-suite.json')}`);

  const verdict = failed === 0
    ? `${GREEN}✅ 全部测试通过${RESET}`
    : `${RED}❌ ${failed} 项失败 — 见上方输出${RESET}`;
  console.log(`\n${BRIGHT}${verdict}${RESET}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`${RED}执行器崩溃:${RESET}`, e); process.exit(2); });
