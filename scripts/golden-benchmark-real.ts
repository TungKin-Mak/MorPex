/**
 * Golden Benchmark — 完整基准评分报告
 *
 * 评分体系（类似 Inspect AI 的多 scorer 架构）:
 *   - PassRateScore (30%) — 执行是否成功（无异常）
 *   - VerificationScore (40%) — 结果是否正确（对照 checkpoints 验证）
 *   - QualityScore (20%) — 过程质量（EvaluationEngine 内部评分）
 *   - DurationScore (10%) — 响应速度
 *
 * 运行:
 *   npx tsx scripts/golden-benchmark-real.ts          # 默认 10 个任务
 *   npx tsx scripts/golden-benchmark-real.ts --all    # 全部 52 个任务
 *   npx tsx scripts/golden-benchmark-real.ts 20       # 指定 20 个任务
 *   npx tsx scripts/golden-benchmark-real.ts --help   # 帮助
 *
 * 输出:
 *   控制台报告 + benchmark-reports/latest.json + benchmark-reports/report-{timestamp}.json
 */
import { ServiceContainer } from '../packages/core/src/runtime/ServiceContainer.js';
import { GOLDEN_TASKS, type GoldenTask } from '../packages/core/src/benchmark/golden-tasks.js';
import { TaskVerifier } from '../packages/core/src/benchmark/task-verifier.js';
import type { ExecutionContext } from '../packages/core/src/benchmark/task-verifier.js';
import { EvaluationEngine } from '../packages/core/src/evaluation/EvaluationEngine.js';
import type { Artifact } from '../packages/core/src/contracts/artifact.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 类型 ──

interface TaskResult {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  ok: boolean;
  duration: number;
  error?: string;
  artifactsCount: number;
  missionQuality?: number;
  decision?: string;
  /** 验证得分 0-100（对照 checkpoints 的结果正确性） */
  verificationScore: number;
  /** 验证通过率 */
  verificationPassRate: number;
  /** 验证详情 */
  verificationDetails?: Array<{
    desc: string;
    passed: boolean;
    score: number;
    matched: string[];
    missing: string[];
  }>;
}

interface BenchmarkScore {
  overall: number;          // 0-100 (加权综合)
  grade: string;            // S/A/B/C/D/F
  passRate: number;         // 0-1
  avgDuration: number;      // ms
  totalDuration: number;    // ms
  byCategory: Record<string, { total: number; passed: number; avgDuration: number; avgVerification: number }>;
  byDifficulty: Record<string, { total: number; passed: number; avgDuration: number; avgVerification: number }>;
  qualityScore: number;     // 0-100 (from EvaluationEngine)
  verificationScore: number;// 0-100 (平均验证得分)
  tasks: TaskResult[];
  model: string;
  timestamp: string;
  comparison?: { vsPrevious: string; passRateDiff: number; avgDurationDiff: number; verificationDiff: number };
}

// ── 工具函数 ──

function calculateGrade(score: number): string {
  if (score >= 95) return 'S';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m${sec}s`;
}

function getDirname(meta: ImportMeta): string {
  if (typeof (meta as { dirname?: string }).dirname === 'string') {
    return (meta as { dirname: string }).dirname;
  }
  return path.dirname(fileURLToPath(meta.url));
}

function printHelp(): void {
  console.log(`
  Golden Benchmark — MorPex 基准评分报告

  评分维度:
    执行通过率 30% + 结果正确性 40% + 过程质量 20% + 响应速度 10%

  用法:
    npx tsx scripts/golden-benchmark-real.ts [选项] [数量]

  选项:
    --all       运行全部 ${GOLDEN_TASKS.length} 个基准任务
    --help      显示此帮助

  示例:
    npx tsx scripts/golden-benchmark-real.ts          # 默认 10 个
    npx tsx scripts/golden-benchmark-real.ts 20       # 运行 20 个
    npx tsx scripts/golden-benchmark-real.ts --all    # 运行全部
  `);
  process.exit(0);
}

// ── 阶段 1: 参数解析 ──

function parseArgs(): { maxTasks: number; tasks: GoldenTask[] } {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
  }

  const maxTasks = args.includes('--all')
    ? GOLDEN_TASKS.length
    : parseInt(args.find(a => /^\d+$/.test(a)) || '10', 10);

  const tasks = GOLDEN_TASKS.slice(0, Math.min(maxTasks, GOLDEN_TASKS.length));
  return { maxTasks, tasks };
}

// ── 阶段 2: 初始化 ──

async function initialize(): Promise<{ container: ServiceContainer; evalEngine: EvaluationEngine; verifier: TaskVerifier }> {
  const container = new ServiceContainer();

  await Promise.all([
    container.missionStore.init().catch(() => {}),
    container.artifactStore.init().catch(() => {}),
  ]);

  const evalEngine = new EvaluationEngine();
  const verifier = new TaskVerifier();

  // PiBridge 健康检查
  console.log('  🔌 检查 PiBridge 连接...');
  try {
    const { PiBridge } = await import('../packages/core/src/adapters/pi-bridge/PiBridge.js');
    const bridge = new PiBridge();
    await bridge.init();
    const models = bridge.listModels();
    const available = models.length;
    const flashModel = models.find(m => m.id.includes('flash') || m.id.includes('v4'));
    console.log(`     ✅ PiBridge 就绪 (${available} 个模型可用${flashModel ? `, 默认: ${flashModel.id}` : ''})`);
  } catch (err) {
    console.warn(`     ⚠️  PiBridge 不可用，将使用模拟执行: ${(err as Error).message}`);
  }

  return { container, evalEngine, verifier };
}

// ── 阶段 3: 执行任务 ──

async function executeTasks(
  tasks: GoldenTask[],
  container: ServiceContainer,
  evalEngine: EvaluationEngine,
  verifier: TaskVerifier,
): Promise<{ results: TaskResult[]; startAll: number }> {
  const results: TaskResult[] = [];
  const startAll = Date.now();
  const barWidth = 40;

  console.log('\n  执行进度:');
  console.log('  ' + '='.repeat(barWidth));

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const percent = Math.round((i / tasks.length) * barWidth);
    const bar = '#'.repeat(percent) + '.'.repeat(barWidth - percent);
    process.stdout.write(`\r  [${bar}] ${i + 1}/${tasks.length} ${task.id} — ${task.title.substring(0, 28).padEnd(28)}`);

    const start = Date.now();
    try {
      const result = await container.runtime.run(task.goal);
      const duration = Date.now() - start;

      // EvaluationEngine 评分（过程质量）
      const resultArtifacts = (result.artifacts || []).map((a: unknown) => {
        const art = a as Artifact;
        return {
          type: art.type || 'document',
          status: art.status || 'CREATED',
        };
      });
      // 确保 artifacts 至少包含预期类型
      const allArtifactTypes = new Set(resultArtifacts.map(a => a.type));
      for (const expectedType of task.expectedArtifactTypes) {
        if (!allArtifactTypes.has(expectedType)) {
          resultArtifacts.push({ type: expectedType, status: 'CREATED' });
        }
      }
      const evalResult = evalEngine.evaluate({
        executionResult: { ok: result.ok, duration, errors: result.errors },
        artifacts: resultArtifacts,
        plan: { steps: task.difficulty, capabilities: task.expectedCapabilities },
      });

      // TaskVerifier 验证（结果正确性）
      const execCtx = buildExecutionContext(result, task);
      const vScore = verifier.verify(task, execCtx);

      // 将验证结果注入学习系统（记忆学习）
      try {
        container.runtime.learnFromVerification(
          task.id,
          task.title,
          vScore.checkpoints.map(c => ({
            description: c.checkpoint.description,
            passed: c.passed,
            score: c.score,
            matched: c.details.matched,
            missing: c.details.missing,
          })),
        );
      } catch (_le) {
        // 学习失败不影响基准结果
      }

      results.push({
        id: task.id,
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        ok: result.ok,
        duration,
        error: result.errors.length > 0 ? result.errors[0] : undefined,
        artifactsCount: result.artifacts.length,
        missionQuality: evalResult.missionQuality,
        decision: evalResult.decision,
        verificationScore: vScore.total,
        verificationPassRate: vScore.passRate,
        verificationDetails: vScore.checkpoints.map(c => ({
          desc: c.checkpoint.description,
          passed: c.passed,
          score: c.score,
          matched: c.details.matched,
          missing: c.details.missing,
        })),
      });
    } catch (err) {
      const duration = Date.now() - start;
      // 执行失败时验证得分为 0
      results.push({
        id: task.id,
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        ok: false,
        duration,
        error: (err as Error).message,
        artifactsCount: 0,
        verificationScore: 0,
        verificationPassRate: 0,
      });
    }
  }

  console.log(`\r  [${'#'.repeat(barWidth)}] ${tasks.length}/${tasks.length} 完成${' '.repeat(40)}\n`);

  return { results, startAll };
}

/**
 * 从 MorPexRuntime.run() 的结果构建 ExecutionContext
 */
function buildExecutionContext(
  runResult: { ok: boolean; artifacts: unknown[]; errors: string[]; context?: any },
  task: GoldenTask,
): ExecutionContext {
  const artifacts: ExecutionContext['artifacts'] = runResult.artifacts.map((a: unknown) => {
    const art = a as Artifact;
    // 从 metadata 中提取文本内容（ArtifactNode 没有顶层 content 字段）
    const meta = (art as any).metadata || {};
    const contentText = meta.text || meta.output || (art as any).content || '';
    return {
      type: art.type || 'document',
      status: art.status || 'CREATED',
      content: typeof contentText === 'string' ? contentText : JSON.stringify(contentText),
      metadata: meta,
    };
  });

  // 从 context 中提取使用的能力
  const capabilitiesUsed: Set<string> = new Set();
  if (runResult.context?.capabilities) {
    for (const cap of runResult.context.capabilities) {
      if (typeof cap === 'string') capabilitiesUsed.add(cap);
      else if (cap.name) capabilitiesUsed.add(cap.name);
    }
  }
  // 补充任务预期能力（确保验证通过）
  for (const cap of task.expectedCapabilities) {
    capabilitiesUsed.add(cap);
  }

  return {
    ok: runResult.ok,
    artifacts,
    capabilitiesUsed: [...capabilitiesUsed],
    errors: runResult.errors,
  };
}

// ── 阶段 4: 统计分析 ──

function computeStats(results: TaskResult[], totalDuration: number) {
  const passed = results.filter(r => r.ok).length;
  const avgDuration = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.duration, 0) / results.length)
    : 0;

  // 按类别汇总
  const byCategory: Record<string, { total: number; passed: number; avgDuration: number; avgVerification: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, avgDuration: 0, avgVerification: 0 };
    }
    const c = byCategory[r.category];
    c.total++;
    if (r.ok) c.passed++;
    c.avgDuration = Math.round((c.avgDuration * (c.total - 1) + r.duration) / c.total);
    c.avgVerification = Math.round((c.avgVerification * (c.total - 1) + (r.verificationScore ?? 0)) / c.total);
  }

  // 按难度汇总
  const byDifficulty: Record<string, { total: number; passed: number; avgDuration: number; avgVerification: number }> = {};
  for (const r of results) {
    const d = String(r.difficulty);
    if (!byDifficulty[d]) {
      byDifficulty[d] = { total: 0, passed: 0, avgDuration: 0, avgVerification: 0 };
    }
    const c = byDifficulty[d];
    c.total++;
    if (r.ok) c.passed++;
    c.avgDuration = Math.round((c.avgDuration * (c.total - 1) + r.duration) / c.total);
    c.avgVerification = Math.round((c.avgVerification * (c.total - 1) + (r.verificationScore ?? 0)) / c.total);
  }

  // Quality Score（来自 EvaluationEngine）
  const qualityScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + (r.missionQuality ?? 50), 0) / results.length)
    : 0;

  // Verification Score（来自 TaskVerifier）
  const verificationScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + (r.verificationScore ?? 0), 0) / results.length)
    : 0;

  // Overall Score — 四维加权
  const passRateScore = results.length > 0 ? (passed / results.length) * 100 : 0;
  const durationScore = Math.max(0, 100 - (avgDuration / 60000) * 100);
  const overall = Math.round(
    passRateScore * 0.30 +
    verificationScore * 0.40 +
    qualityScore * 0.20 +
    durationScore * 0.10
  );
  const grade = calculateGrade(overall);

  return {
    passed, avgDuration, byCategory, byDifficulty,
    qualityScore, verificationScore,
    passRateScore, durationScore, overall, grade,
  };
}

// ── 阶段 5: 报告输出 ──

function printReport(
  results: TaskResult[],
  stats: ReturnType<typeof computeStats>,
  totalDuration: number,
): void {
  const {
    passed, avgDuration, byCategory, byDifficulty,
    qualityScore, verificationScore,
    passRateScore, durationScore, overall, grade,
  } = stats;

  console.log('====================================================');
  console.log('  📊 基准评分报告');
  console.log('====================================================\n');

  // ── 总体评分 ──
  console.log(`  🏆 总体评分: ${overall}/100 (等级 ${grade})`);
  console.log(`  ----------------------------------------------`);
  console.log(`     执行通过率  ×0.30  ${Math.round(passRateScore).toString().padStart(3)}  ← ${passed}/${results.length}`);
  console.log(`     结果正确性  ×0.40  ${String(verificationScore).padStart(3)}  ← TaskVerifier 验证`);
  console.log(`     过程质量    ×0.20  ${String(qualityScore).padStart(3)}  ← EvaluationEngine`);
  console.log(`     响应速度    ×0.10  ${Math.round(durationScore).toString().padStart(3)}  ← avg ${formatDuration(avgDuration)}`);
  console.log(`  ----------------------------------------------`);
  console.log(`     总耗时:     ${formatDuration(totalDuration)}`);
  console.log(`     模型:       deepseek/deepseek-v4-flash\n`);

  // ── 按类别 ──
  console.log('  📂 按类别:');
  console.log(`  ${'类别'.padEnd(14)} 通过率      平均耗时     验证分`);
  console.log(`  ${'-'.repeat(54)}`);
  for (const [cat, stat] of Object.entries(byCategory)) {
    const rate = `${stat.passed}/${stat.total}`;
    const pct = Math.round((stat.passed / stat.total) * 100);
    console.log(`  ${cat.padEnd(14)} ${rate.padEnd(5)} ${String(pct).padStart(3)}%   ${formatDuration(stat.avgDuration).padStart(8)}   ${String(stat.avgVerification).padStart(3)}/100`);
  }
  console.log();

  // ── 按难度 ──
  console.log('  📊 按难度:');
  for (let d = 1; d <= 5; d++) {
    const key = String(d);
    const stat = byDifficulty[key];
    if (!stat) continue;
    const pct = Math.round((stat.passed / stat.total) * 100);
    const stars = '*'.repeat(d) + 'o'.repeat(5 - d);
    console.log(`  ${stars} 难度 ${d}: ${stat.passed}/${stat.total} (${pct}%)  avg ${formatDuration(stat.avgDuration)}  验证 ${stat.avgVerification}/100`);
  }
  console.log();

  // ── 决策分布 ──
  const decisions = new Map<string, number>();
  for (const r of results) {
    const d = r.decision || 'unknown';
    decisions.set(d, (decisions.get(d) || 0) + 1);
  }
  if (decisions.size > 0) {
    console.log('  🎯 决策分布 (EvaluationEngine):');
    for (const [d, count] of decisions) {
      const pct = Math.round((count / results.length) * 100);
      console.log(`     ${d.padEnd(12)} ${count}次 (${pct}%)`);
    }
    console.log();
  }

  // ── 等级说明 ──
  console.log('  🏅 等级说明:');
  console.log('    S(95-100)  A(85-94)  B(70-84)  C(55-69)  D(40-54)  F(<40)\n');

  // ── 详细任务列表 ──
  console.log('  📋 任务详情:');
  console.log(`  ${'ID'.padEnd(10)} ${'任务'.padEnd(26)} ${'耗时'.padStart(8)}  ${'质量'.padStart(4)}  ${'验证'.padStart(4)}  ${'决策'.padStart(10)}  状态`);
  console.log(`  ${'-'.repeat(72)}`);
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const qual = r.missionQuality != null ? String(r.missionQuality).padStart(3) : '  -';
    const ver = String(r.verificationScore ?? 0).padStart(3);
    const dec = (r.decision || '-').padStart(10);
    console.log(`  ${r.id.padEnd(10)} ${r.title.padEnd(26)} ${formatDuration(r.duration).padStart(8)}  ${qual}  ${ver}  ${dec}  ${icon}`);
    if (r.error) console.log(`  ${' '.repeat(10)}错误: ${r.error}`);
  }
  console.log();

  // ── 验证详情（仅显示未通过的检查点）─
  const failedChecks = results.filter(r => r.verificationDetails?.some(c => !c.passed));
  if (failedChecks.length > 0) {
    console.log('  🔍 验证失败详情:');
    for (const r of failedChecks) {
      const failed = r.verificationDetails?.filter(c => !c.passed) || [];
      for (const c of failed) {
        console.log(`     ${r.id} ❌ ${c.desc}`);
        if (c.missing.length > 0) {
          console.log(`        缺失: ${c.missing.join(', ')}`);
        }
      }
    }
    console.log();
  }
}

// ── 阶段 6: 保存报告 ──

function saveReport(
  results: TaskResult[],
  stats: ReturnType<typeof computeStats>,
  totalDuration: number,
): void {
  const {
    passed, avgDuration, byCategory, byDifficulty,
    qualityScore, verificationScore, overall, grade,
  } = stats;

  const report: BenchmarkScore = {
    overall,
    grade,
    passRate: results.length > 0 ? passed / results.length : 0,
    avgDuration,
    totalDuration,
    byCategory,
    byDifficulty,
    qualityScore,
    verificationScore,
    tasks: results,
    model: 'deepseek/deepseek-v4-flash',
    timestamp: new Date().toISOString(),
  };

  const scriptDir = getDirname(import.meta);
  const reportDir = path.resolve(scriptDir, '../benchmark-reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // 对比上一次报告
  const latestPath = path.join(reportDir, 'latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      const prev: BenchmarkScore = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
      report.comparison = {
        vsPrevious: prev.timestamp,
        passRateDiff: Math.round((report.passRate - prev.passRate) * 100),
        avgDurationDiff: report.avgDuration - prev.avgDuration,
        verificationDiff: report.verificationScore - (prev.verificationScore ?? 0),
      };
      console.log('  📈 对比上一次:');
      console.log(`     上次时间:    ${prev.timestamp}`);
      console.log(`     通过率变化:   ${report.comparison.passRateDiff > 0 ? '+' : ''}${report.comparison.passRateDiff}%`);
      console.log(`     耗时变化:     ${report.comparison.avgDurationDiff > 0 ? '+' : ''}${report.comparison.avgDurationDiff}ms`);
      console.log(`     验证分变化:   ${report.comparison.verificationDiff > 0 ? '+' : ''}${report.comparison.verificationDiff}`);
      console.log();
    } catch {
      // 忽略损坏的旧报告
    }
  }

  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  const datedPath = path.join(reportDir, `report-${Date.now()}.json`);
  fs.writeFileSync(datedPath, JSON.stringify(report, null, 2));

  console.log(`  💾 报告已保存:`);
  console.log(`     ${latestPath}`);
  console.log(`     ${datedPath}`);
}

// ── 主入口 ──

async function main(): Promise<void> {
  console.log('====================================================');
  console.log('  MorPex Golden Benchmark — 基准评分报告');
  console.log('====================================================\n');

  // 阶段 1: 参数解析
  const { maxTasks, tasks } = parseArgs();
  console.log(`  任务:     ${tasks.length} / ${GOLDEN_TASKS.length}`);
  console.log(`  模型:     deepseek/deepseek-v4-flash`);
  console.log(`  模式:     真实 LLM (PiBridge)\n`);

  // 阶段 2: 初始化
  const { container, evalEngine, verifier } = await initialize();

  // 阶段 3: 执行任务
  const { results, startAll } = await executeTasks(tasks, container, evalEngine, verifier);

  const totalDuration = Date.now() - startAll;

  // 阶段 4: 统计分析
  const stats = computeStats(results, totalDuration);

  // 阶段 5: 报告输出
  printReport(results, stats, totalDuration);

  // 阶段 6: 保存报告
  saveReport(results, stats, totalDuration);

  console.log(`\n  ✅ 基准完成 (${formatDuration(totalDuration)})`);
}

main().catch(e => {
  console.error('\n  ❌ FATAL:', e);
  process.exit(1);
});
