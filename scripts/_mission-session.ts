/**
 * scripts/_mission-session.ts — 生成类任务走 Mission 的完整会话诊断
 * 打印 Mission 各阶段状态/事件/耗时，供检查 Mission 流程卡在哪。
 */
import { bootstrapUnified } from '../packages/core/src/bootstrap-unified.js';

async function main(): Promise<void> {
  const boot = await bootstrapUnified({ ceoId: 'mission-diag' });
  const { container, companyFacade, departmentManager } = boot;
  try {
    await departmentManager.createDepartment({ name: 'software', type: 'project', ceoId: 'mission-diag' });
  } catch { /* 已存在 */ }

  console.log('\n════════ Mission 会话追踪开始 ════════');

  // 订阅 Mission 生命周期事件（打印每阶段）
  const bus = container.eventBus as { on(t: string, h: (e: { type?: string; payload?: Record<string, unknown>; executionId?: string; timestamp?: number }) => void): void };
  const t0 = Date.now();
  const stage = (t: string, p?: Record<string, unknown>) =>
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] EVENT ${t} ${p ? JSON.stringify(p).slice(0, 120) : ''}`);
  for (const t of ['mission.created', 'mission.updated', 'mission.completed', 'mission.failed', 'mission.blocked', 'execution.started', 'execution.completed', 'evaluation.completed', 'planner.plan.started', 'planner.plan.completed', 'rule.violation.detected', 'runtime.completed']) {
    bus.on(t, (e) => stage(t, e.payload));
  }

  console.log('\n── executeGoal 开始（生成类任务）──');
  const start = Date.now();
  const r = await companyFacade.executeGoal('生成软件系统架构设计方案文档', { departmentName: 'software' });
  console.log(`\n── executeGoal 返回：ok=${r.ok} 耗时=${((Date.now() - start) / 1000).toFixed(1)}s`);
  if (r.error) console.log(`  error: ${r.error.slice(0, 200)}`);

  // 打印最终 Mission 状态
  console.log('\n════════ 最终 Mission 状态 ════════');
  const missions = container.missionController.getAllMissions();
  for (const m of missions.slice(-3)) {
    const mm = m as { missionId?: string; state?: string; status?: string; phase?: string; blocks?: Array<{ reason: string; description: string }>; timeline?: Array<{ event: string }> };
    console.log(`  mission=${mm.missionId} state=${mm.state ?? mm.status} phase=${mm.phase}`);
    console.log(`    blocks=${JSON.stringify(mm.blocks ?? [])}`);
    console.log(`    timeline(最后5): ${(mm.timeline ?? []).slice(-5).map((x) => x.event).join(' | ')}`);
  }
}

main().catch((e) => {
  console.error('❌ 诊断异常:', (e as Error).message);
  process.exit(1);
});
