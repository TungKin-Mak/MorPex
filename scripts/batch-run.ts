/**
 * scripts/batch-run.ts — 50 个真实任务批量闭环测试 + 数据流函数调用报告
 *
 * 用法：
 *   npx tsx scripts/batch-run.ts            # 跑全部 50 个任务
 *   npx tsx scripts/batch-run.ts --limit 3  # 只跑前 3 个（验证用）
 *   npx tsx scripts/batch-run.ts --only xjmcu  # 只跑指定行业
 *
 * 容错参数（grok2api 限流/无响应）：
 *   --timeout <ms>    单任务超时（默认 0=不设限；LLM 任务长短不一，复杂任务可能数小时，
 *                     需要限时防御时显式传入——会话 11c 起默认不再硬限时）
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
  * 不改产品代码；config/morpex.yaml 默认 GLM-4.7-Flash。
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
const excludeIdx = args.indexOf('--exclude');
// 会话 12：--exclude <dept[,dept2]> 排除行业（如 xjmcu 需真实 MCU 硬件，无设备时预期失败）
const excludeDepts = excludeIdx >= 0
  ? String(args[excludeIdx + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  : [];
// grok2api 容错参数（限流/无响应处理）
const delayIdx = args.indexOf('--delay');
const delayMs = delayIdx >= 0 ? parseInt(args[delayIdx + 1], 10) : 3000; // 任务间限流退避
const timeoutIdx = args.indexOf('--timeout');
// ═══ 会话 11c：LLM 任务默认不设限时（复杂任务可能数小时）；仅显式 --timeout 才限时防御 ═══
const timeoutMs = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1], 10) : 0; // 0 = 不超时
const autoRetryIdx = args.indexOf('--retries');
const autoRetries = autoRetryIdx >= 0 ? parseInt(args[autoRetryIdx + 1], 10) : 2; // 429/5XX 自动重试次数
const concurrencyIdx = args.indexOf('--concurrency');
const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1], 10) : 5; // 并发数
// ═══ P2-9（会话 16l·3）：并发自适应开关（--adaptive 显式启用；显式 --concurrency 时自适应不生效）
const adaptiveIdx = args.indexOf('--adaptive');
const adaptiveEnabled = adaptiveIdx >= 0 && concurrencyIdx < 0; // 显式 concurrency → 尊重用户
const adaptiveMin = adaptiveIdx >= 0 ? parseInt(String(args[adaptiveIdx + 1] ?? '2'), 10) : 2;

// ═══ P2-9（会话 16l·3）：并发自适应——内存感知 + 限流感知，防并行 OOM / 限流风暴 ═══
// 曾 OOM（关键教训 #5）：batch + vitest 并行堆爆。自适应在每批前根据可用内存动态降并发；
// 批内大量限流 → 下批自动降并发（减少配额风暴），恢复后回升。
import { freemem } from 'node:os';

export interface AdaptiveConcurrencyConfig {
  enabled: boolean;
  maxConcurrency: number;
  minConcurrency: number;
}

/**
 * currentAdaptiveConcurrency — 计算本批应使用的并发数（纯函数，可测试）
 *
 * @param cfg 自适应配置（enabled/maxConcurrency/minConcurrency）
 * @param batchIdx 当前批序号（0 起）
 * @param rateLimitedInLastBatch 上一批限流任务数
 * @param batchSize 上一批大小（用于限流占比计算）
 */
export function currentAdaptiveConcurrency(
  cfg: AdaptiveConcurrencyConfig,
  batchIdx: number,
  rateLimitedInLastBatch: number,
  batchSize: number,
): number {
  const { enabled, maxConcurrency, minConcurrency } = cfg;
  if (!enabled) return maxConcurrency;
  let eff = maxConcurrency;

  // 1. 内存感知：可用内存 < 1.5GB → 降为 2；< 3GB → 降为 3；堆占用 > 80% → 降为 2
  const freeMemGb = freemem() / (1024 ** 3);
  const heapUsedRatio = process.memoryUsage().heapUsed / (process.memoryUsage().heapTotal || 1);
  if (freeMemGb < 1.5 || heapUsedRatio > 0.8) eff = Math.min(eff, 2);
  else if (freeMemGb < 3) eff = Math.min(eff, 3);

  // 2. 限流感知：上一批 >50% 限流 → 下批减半（不低于 min）；上一批零限流 → 回升
  if (batchIdx > 0 && rateLimitedInLastBatch / Math.max(batchSize, 1) > 0.5) {
    eff = Math.max(Math.floor(eff / 2), minConcurrency);
  } else if (batchIdx > 0 && rateLimitedInLastBatch === 0) {
    eff = Math.min(eff + 1, maxConcurrency); // 恢复上限
  }

  return Math.max(minConcurrency, Math.min(eff, maxConcurrency));
}

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

/** 超时包装：ms<=0（默认）→ 不设限，让 LLM 任务自然跑完（复杂任务可能数小时） */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!ms || ms <= 0) return p;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} 超时(${ms}ms)——疑似 LLM 无响应`)), ms);
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

  // 4. 筛选任务（会话 12：--exclude 排除硬件依赖行业）
  const tasks = TASKS.filter((t) => {
    if (only && t.departmentName !== only) return false;
    if (excludeDepts.length > 0 && excludeDepts.includes(t.departmentName)) return false;
    return true;
  }).slice(0, limit);
  console.log(`[run] 任务数: ${tasks.length}${excludeDepts.length ? `（排除 ${excludeDepts.join(', ')}）` : ''}\n`);

  // 5. 单任务执行（抽取为函数，支持并发）
  async function runOneTask(num: number, task: BatchTask): Promise<TaskResult> {
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




  // 5'. 并发执行（默认 5 并发；--adaptive 时内存/限流自适应防 OOM 与限流风暴）
  const results: TaskResult[] = [];
  const startAll = Date.now();
  let batchIdx = 0;
  let rateLimitedInLastBatch = 0;
  for (let i = 0; i < tasks.length; i += concurrency) {
    // ═══ P2-9（会话 16l·3）：每批动态并发（内存/限流感知）═══
    const effConcurrency = currentAdaptiveConcurrency(
      { enabled: adaptiveEnabled, maxConcurrency: concurrency, minConcurrency: adaptiveMin },
      batchIdx,
      rateLimitedInLastBatch,
      concurrency,
    );
    const batch = tasks.slice(i, i + effConcurrency);
    const batchResults = await Promise.all(
      batch.map((task, j) => runOneTask(i + j + 1, task)),
    );
    if (adaptiveEnabled) {
      const rl = batchResults.filter(r => !r.ok && r.error?.startsWith('RATE_LIMITED')).length;
      rateLimitedInLastBatch = rl;
      if (batchIdx === 0 || rl > 0) {
        console.log(`  [batch] 第 ${batchIdx + 1} 批：并发 ${effConcurrency}（限流 ${rl}/${batch.length}，可用内存 ${(freemem() / 1024 ** 3).toFixed(1)}GB）`);
      }
      batchIdx++;
    }
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
