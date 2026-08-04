/**
 * scripts/batch-run.ts — 50 个真实任务批量闭环测试 + 数据流函数调用报告
 *
 * 用法：
 *   npx tsx scripts/batch-run.ts            # 跑全部 50 个任务
 *   npx tsx scripts/batch-run.ts --limit 3  # 只跑前 3 个（验证用）
 *   npx tsx scripts/batch-run.ts --only xjmcu  # 只跑指定行业
 *
 * 容错参数（grok2api 限流/无响应）：
 *   --timeout <ms>    单任务 LLM 超时（默认 180000，无响应抛错）
 *   --retries <n>     429/5XX 自动重试次数（默认 2）
 *   --delay <ms>      任务间限流退避延时（默认 3000）
 *
 * 容错：检测 HTTP 错误码——429（限流）/5XX（服务器错误）→ 自动退避重试；
 *      其他错误直接记录跳过；无人工介入（全自动）。
 * 特性：
 *   - 所有人工审核环节由测试脚本自动决定（LLM 审核模拟）：
 *       · 审批（approval.wait_human）→ 自动 decide('APPROVED', 'llm-auto')
 *       · pending 规则 → 自动激活（模拟 LLM 确认 pending→active）
 *       · needsHumanReview 标记 → 接受结果（不阻塞执行）
 *   - 每任务一个追踪会话：包装核心服务实例方法，记录完整数据流调用链
 *   - 每任务生成一份报告：data/trace-reports/task-{NNN}.md
 *
 * 不改产品代码；config/morpex.yaml 保持默认（deepseek）。
 */
import { bootstrapUnified } from '../packages/core/src/bootstrap-unified.js';
import { RuleRegistry } from '../packages/core/src/gate/rules/RuleRegistry.js';
import { createTraceSession, renderCallChain, type TraceCall } from './tracing/TraceRecorder.js';
import { TASKS, type BatchTask } from './batch-tasks.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── 参数解析 ──
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : TASKS.length;
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
// grok2api 容错参数（限流/无响应处理）
const delayIdx = args.indexOf('--delay');
const delayMs = delayIdx >= 0 ? parseInt(args[delayIdx + 1], 10) : 3000; // 任务间限流退避
const timeoutIdx = args.indexOf('--timeout');
const timeoutMs = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1], 10) : 180_000; // 单任务超时
const autoRetryIdx = args.indexOf('--retries');
const autoRetries = autoRetryIdx >= 0 ? parseInt(args[autoRetryIdx + 1], 10) : 2; // 429/5XX 自动重试次数
const concurrencyIdx = args.indexOf('--concurrency');
const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1], 10) : 5; // 并发数

/** 延时 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * retryableWaitMs — 判断错误是否可重试（限流/过载），返回重试等待时长(ms)；不可重试返回 0
 *
 * 覆盖：
 *   - HTTP 429（限流）/ 5xx（服务器错误）→ 15s
 *   - GLM-4.7-Flash 限流/过载（业务码 1305 "该模型当前访问量过大，请您稍后再试"）→ 30s
 *   - 关键词：限流/过载/访问量过大/稍后再试/rate limit/too many/overload
 */
export function retryableWaitMs(err: string | undefined): number {
  if (!err) return 0;
  const m = err.match(/\b(429|5\d\d)\b/);
  if (m) return 15000;
  if (/1305|访问量过大|稍后再试|限流|过载|rate limit|too many|overload/i.test(err)) {
    return 30000;
  }
  return 0;
}

/** 超时包装：LLM 无响应/挂起时抛错 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} 超时(${ms}ms)——疑似 grok2api 无响应`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const REPORT_DIR = resolve(process.cwd(), 'data/trace-reports');

interface TaskResult {
  index: number;
  task: BatchTask;
  ok: boolean;
  missionId?: string;
  durationMs: number;
  error?: string;
  calls: TraceCall[];
  snapshot?: { taskRef: string; result?: string; artifacts?: string[] };
}

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════');
  console.log(`  MorPex 批量闭环测试（${only ? `行业=${only}，` : ''}共 ${limit} 个任务）`);
  console.log('══════════════════════════════════════════════════\n');

  // 0. bootstrap
  const boot = await bootstrapUnified({ ceoId: 'batch-ceo' });
  const { container, companyFacade, departmentManager } = boot;
  const eventStore = container.eventStore;
  console.log('[bootstrap] ✅ 容器就绪');

  // 1. 创建部门
  for (const dept of ['ecommerce', 'hardware', 'software', 'xjmcu']) {
    try {
      await departmentManager.createDepartment({ name: dept, type: 'project', ceoId: 'batch-ceo' });
    } catch {
      /* 已存在 */
    }
  }
  console.log('[setup] ✅ 4 个部门已创建');

  // 2. 自动审批 hook（LLM 审核模拟：approval.wait_human → 自动 APPROVED）
  const autoApprovals: Array<{ at: string; reason: string }> = [];
  container.eventBus.on('approval.wait_human', (ev: { type: string; payload?: { id?: string } }) => {
    const pending = container.approvalGate.getPending();
    const target = pending[pending.length - 1];
    const id = target?.id ?? ev.payload?.id;
    if (id) {
      container.approvalGate.decide(id, 'APPROVED', 'llm-auto-test');
      autoApprovals.push({ at: new Date().toISOString(), reason: `auto-approve ${id}` });
    }
  });
  container.eventBus.on('approval.required', (ev: { type: string; payload?: { id?: string } }) => {
    const pending = container.approvalGate.getPending();
    const target = pending[pending.length - 1];
    const id = target?.id ?? ev.payload?.id;
    if (id) {
      container.approvalGate.decide(id, 'APPROVED', 'llm-auto-test');
      autoApprovals.push({ at: new Date().toISOString(), reason: `auto-approve(required) ${id}` });
    }
  });
  console.log('[setup] ✅ 自动审批 hook 已挂载（approval.wait_human/required → llm-auto）');

  // 3. 激活 pending 规则（LLM 审核模拟：规则确认闸）
  const activated: string[] = [];
  for (const rule of RuleRegistry.getAll()) {
    if (rule.status === 'pending') {
      RuleRegistry.setStatus(rule.id, 'active');
      activated.push(`${rule.id}(${rule.domain})`);
    }
  }
  console.log(`[setup] ✅ 规则激活 ${activated.length} 条: ${activated.join(', ') || '无'}\n`);

  // 4. 筛选任务
  const tasks = TASKS.filter((t) => (only ? t.departmentName === only : true)).slice(0, limit);
  console.log(`[run] 任务数: ${tasks.length}\n`);

  // 5. 单任务执行（抽取为函数，支持并发）
  async function runOneTask(num: number, task: BatchTask): Promise<TaskResult> {
  // 5. 循环执行
  const results: TaskResult[] = [];
  const startAll = Date.now();

    console.log(`─── 任务 ${num}/${tasks.length} ───`);
    console.log(`  [${task.departmentName}] ${task.goal.slice(0, 60)}…`);

    const trace = createTraceSession(`task-${num}`);
    // 包装核心服务实例（覆盖全功能模块）
    trace.wrap(companyFacade, 'CompanyFacade', ['executeGoal']);
    trace.wrap(container.controlPlane, 'ControlPlane');
    trace.wrap(container.runtime, 'MorPexRuntime');
    trace.wrap(container.missionController, 'MissionController');
    trace.wrap(container.executionEngine, 'UnifiedExecutionEngine');
    trace.wrap(container.approvalGate, 'ApprovalGate');
    trace.wrap(container.artifactFacade, 'ArtifactFacade');
    trace.wrap(container.experienceMiner, 'ExperienceMiner');
    trace.wrap(container.verificationEngine, 'VerificationEngine');
    trace.wrap(container.complianceChecker, 'ComplianceChecker');
    trace.wrap(container.simulator, 'ExecutionSimulator');
    trace.wrap(container.teamOrchestrator, 'TeamOrchestrator');
    trace.wrap(container.learningEngine, 'LearningEngine');
    trace.wrap(boot.ontology, 'OntologyService');
    // ContextAssemblyEngine（container 私有字段，反射读取不破坏类型债原则）
    const engine = Reflect.get(container, '_contextAssemblyEngine') as object | undefined;
    if (engine) trace.wrap(engine, 'ContextAssemblyEngine');

    const t0 = Date.now();
    let ok = false;
    let missionId: string | undefined;
    let error: string | undefined;

    // ══ 执行（LLM 容错：429/5XX/GLM 限流 1305 → 自动退避重试；其他失败记录）══
    // 规则：限流/过载（429/5xx/1305/访问量过大）→ 退避重试；耗尽标记 RATE_LIMITED；其余错误不重试
    const maxAttempts = autoRetries + 1; // 总尝试次数（默认 3）
    let rateLimited = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await withTimeout(
          companyFacade.executeGoal(task.goal, { departmentName: task.departmentName }),
          timeoutMs,
          `任务${num}`,
        );
        ok = result.ok;
        missionId = result.missionId;
        error = result.error;
      } catch (err) {
        error = (err as Error).message;
      }

      if (ok) break;

      const wait = retryableWaitMs(error);
      if (wait > 0 && attempt < maxAttempts) {
        const backoff = wait * attempt; // 递增退避（GLM 限流等更久）
        console.log(`  ⚠️ 限流/过载（${attempt}/${maxAttempts - 1} 重试）: ${(error ?? '').slice(0, 100)}`);
        console.log(`     → 等待 ${(backoff / 1000).toFixed(1)}s 后重试...`);
        await sleep(backoff);
        continue;
      }
      if (wait > 0) {
        // 重试耗尽 → 标记 RATE_LIMITED（非普通失败），不误判为业务失败
        rateLimited = true;
        error = `RATE_LIMITED: ${error}`;
        console.log(`  ⚠️ 任务 ${num} 持续限流/过载（已重试 ${maxAttempts - 1} 次），标记限流跳过`);
      }
      break;
    }
    const durationMs = Date.now() - t0;
    const calls = trace.report();
    void rateLimited;

    // 闭环验证：snapshot + 召回
    let snapshot: TaskResult['snapshot'];
    if (eventStore && missionId) {
      try {
        const snaps = await eventStore.query({ type: 'context.snapshot' });
        const mine = snaps.find(
          (e) => (e.payload as Record<string, unknown>)?.taskRef === missionId,
        );
        if (mine) {
          const p = mine.payload as Record<string, unknown>;
          snapshot = {
            taskRef: String(p.taskRef ?? ''),
            result: String(p.result ?? ''),
            artifacts: Array.isArray(p.artifacts) ? (p.artifacts as string[]) : [],
          };
        }
      } catch {
        /* snapshot 查询失败不阻断 */
      }
    }

    console.log(`  ➜ ok=${ok} 耗时=${(durationMs / 1000).toFixed(1)}s 调用=${calls.length} ${missionId ? `mission=${missionId}` : ''}`);
    if (error) console.log(`  ⚠️ error: ${error.slice(0, 120)}`);
    console.log('');
    return { index: num, task, ok, missionId, durationMs, error, calls, snapshot };
  };




  // 5'. 并发执行（默认 5 并发；每批 Promise.all）
  const results: TaskResult[] = [];
  const startAll = Date.now();
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((task, j) => runOneTask(i + j + 1, task)),
    );
    results.push(...batchResults);
  }
  // 6. 生成报告
  mkdirSync(REPORT_DIR, { recursive: true });
  for (const r of results) {
    writeFileSync(resolve(REPORT_DIR, `task-${String(r.index).padStart(3, '0')}.md`), renderReport(r, autoApprovals));
  }
  console.log(`[report] ✅ ${results.length} 份报告已生成 → ${REPORT_DIR}`);

  // 7. 汇总
  const okCount = results.filter((r) => r.ok).length;
  const rateLimitedCount = results.filter((r) => !r.ok && r.error?.startsWith('RATE_LIMITED')).length;
  const failCount = results.length - okCount - rateLimitedCount;
  const totalMs = Date.now() - startAll;
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  汇总: 成功 ${okCount}/${results.length} ｜ 限流跳过 ${rateLimitedCount} ｜ 失败 ${failCount} ｜ 总耗时 ${(totalMs / 1000).toFixed(0)}s`);
  console.log(`  自动审批 ${autoApprovals.length} 次 ｜ 平均每任务调用 ${(results.reduce((s, r) => s + r.calls.length, 0) / Math.max(results.length, 1)).toFixed(0)} 个函数`);
  console.log('══════════════════════════════════════════════════');
  // 退出码：全成功 0；仅限流跳过视为可接受（退出码 2）；有真实失败 1
  process.exit(okCount === results.length ? 0 : failCount > 0 ? 1 : 2);
}

function renderReport(r: TaskResult, approvals: Array<{ at: string; reason: string }>): string {
  const lines: string[] = [];
  lines.push(`# 任务 ${r.index} 数据流报告`);
  lines.push('');
  lines.push(`- 行业: ${r.task.departmentName}`);
  lines.push(`- 目标: ${r.task.goal}`);
  lines.push(`- 标签: ${r.task.tags?.join(', ') ?? '-'}`);
  lines.push(`- 结果: ${r.ok ? '✅ 成功' : '❌ 失败'}${r.error ? `（${r.error.slice(0, 150)}）` : ''}`);
  lines.push(`- 耗时: ${(r.durationMs / 1000).toFixed(1)}s`);
  lines.push(`- missionId: ${r.missionId ?? 'N/A'}`);
  lines.push(`- 函数调用总数: ${r.calls.length}`);
  lines.push(`- 自动审批次数（本任务期间累计）: ${approvals.length}`);
  lines.push('');
  lines.push('## 数据流调用链');
  lines.push('');
  lines.push('```');
  lines.push(renderCallChain(r.calls));
  lines.push('```');
  lines.push('');
  lines.push('## 函数调用明细');
  lines.push('');
  lines.push('| # | 函数 | 耗时(ms) | 成败 | 入参摘要 | 出参摘要 |');
  lines.push('|---|------|---------|------|---------|---------|');
  const sorted = [...r.calls].sort((a, b) => a.seq - b.seq);
  for (const c of sorted) {
    lines.push(
      `| ${c.seq} | ${c.fn} | ${c.durationMs} | ${c.ok ? '✅' : '❌'} | ${escapeMd(c.args)} | ${escapeMd(c.result)} |`,
    );
  }
  lines.push('');
  lines.push('## 抽离/召回');
  lines.push('');
  if (r.snapshot) {
    lines.push(`- context.snapshot: ✅ taskRef=${r.snapshot.taskRef} result=${r.snapshot.result} artifacts=${r.snapshot.artifacts?.length ?? 0}`);
  } else {
    lines.push(`- context.snapshot: ⚠️ 未找到（任务可能失败或未触发抽离）`);
  }
  return lines.join('\n');
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
}

// 仅直接运行时执行（import 供测试时不启动批次）
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('❌ 批量运行失败:', err);
    process.exit(1);
  });
}
