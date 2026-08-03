/**
 * scripts/batch-run.ts — 50 个真实任务批量闭环测试 + 数据流函数调用报告
 *
 * 用法：
 *   npx tsx scripts/batch-run.ts            # 跑全部 50 个任务
 *   npx tsx scripts/batch-run.ts --limit 3  # 只跑前 3 个（验证用）
 *   npx tsx scripts/batch-run.ts --only xjmcu  # 只跑指定行业
 *
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
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ── 参数解析 ──
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : TASKS.length;
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

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

  // 5. 循环执行
  const results: TaskResult[] = [];
  const startAll = Date.now();
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const num = i + 1;
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
    try {
      const result = await companyFacade.executeGoal(task.goal, { departmentName: task.departmentName });
      ok = result.ok;
      missionId = result.missionId;
      error = result.error;
    } catch (err) {
      error = (err as Error).message;
    }
    const durationMs = Date.now() - t0;
    const calls = trace.report();

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

    results.push({ index: num, task, ok, missionId, durationMs, error, calls, snapshot });
    console.log(`  ➜ ok=${ok} 耗时=${(durationMs / 1000).toFixed(1)}s 调用=${calls.length} ${missionId ? `mission=${missionId}` : ''}`);
    if (error) console.log(`  ⚠️ error: ${error.slice(0, 120)}`);
    console.log('');
  }

  // 6. 生成报告
  mkdirSync(REPORT_DIR, { recursive: true });
  for (const r of results) {
    writeFileSync(resolve(REPORT_DIR, `task-${String(r.index).padStart(3, '0')}.md`), renderReport(r, autoApprovals));
  }
  console.log(`[report] ✅ ${results.length} 份报告已生成 → ${REPORT_DIR}`);

  // 7. 汇总
  const okCount = results.filter((r) => r.ok).length;
  const totalMs = Date.now() - startAll;
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  汇总: 成功 ${okCount}/${results.length} ｜ 总耗时 ${(totalMs / 1000).toFixed(0)}s`);
  console.log(`  自动审批 ${autoApprovals.length} 次 ｜ 平均每任务调用 ${(results.reduce((s, r) => s + r.calls.length, 0) / Math.max(results.length, 1)).toFixed(0)} 个函数`);
  console.log('══════════════════════════════════════════════════');
  process.exit(okCount === results.length ? 0 : 1);
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

main().catch((err) => {
  console.error('❌ 批量运行失败:', err);
  process.exit(1);
});
