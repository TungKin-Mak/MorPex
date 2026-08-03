/**
 * scripts/verify-e2e.ts — MorPex 全链路验证脚本
 *
 * 验证目标（功能②+③ 闭环）：
 *   1. executeGoal 全链路（L1 门禁 → orchestrate → 统一规划 → 聚焦装配 6 Provider → 执行 → L6 → 抽离）
 *   2. 抽离：Mission 完成 → context.snapshot 完整快照带 taskRef 入 EventStore
 *   3. 召回：ContextArchive.loadByTaskRef 按 taskRef 精确还原
 *
 * 运行：npx tsx scripts/verify-e2e.ts
 * 依赖：.env 的 DEEPSEEK_API_KEY（真跑 LLM）
 */
import { bootstrapUnified } from '../packages/core/src/bootstrap-unified.js';
import { loadByTaskRef } from '../packages/core/src/knowledge/context/ContextArchive.js';

const GOAL = '为电商部门生成「商品价格合规检查」行动方案并执行：检查商品价格披露是否含税、有无虚假紧迫感，输出检查报告产物';

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════');
  console.log('  MorPex 全链路验证（功能②+③ 闭环）');
  console.log('══════════════════════════════════════════\n');

  // ── 0. bootstrap ──
  console.log('【0】bootstrapUnified（真实容器）...');
  const boot = await bootstrapUnified({ ceoId: 'verify-ceo' });
  const { container, companyFacade, departmentManager } = boot;
  const eventStore = container.eventStore;
  console.log('    ✅ bootstrap 完成（companyFacade + container + eventStore 就绪）');

  // 0.5 创建 ecommerce 部门（触发领域插件规则路由）
  console.log('【0.5】创建 ecommerce 部门...');
  try {
    await departmentManager.createDepartment({ name: 'ecommerce', type: 'project', ceoId: 'verify-ceo' });
    console.log('    ✅ 部门 ecommerce 已创建\n');
  } catch (err) {
    console.log(`    ⚠️ 部门创建: ${(err as Error).message}（可能已存在，继续）\n`);
  }

  // ── 1. executeGoal 全链路 ──
  console.log(`【1】executeGoal 全链路\n    目标: ${GOAL}`);
  console.log('    部门: ecommerce（触发领域插件 + 规则路由）');
  const start = Date.now();
  const result = await companyFacade.executeGoal(GOAL, { departmentName: 'ecommerce' });
  const dur = Date.now() - start;
  console.log(`\n    ⏱ 耗时 ${dur}ms ｜ ok=${result.ok}`);
  console.log(`    missionId = ${result.missionId ?? 'N/A'}`);
  console.log(`    executionId = ${result.executionId ?? 'N/A'}`);
  if (result.error) console.log(`    ❌ error: ${result.error}`);

  // ── 2. 抽离验证 ──
  console.log('\n【2】抽离验证（context.snapshot 完整快照带 taskRef 入 EventStore）');
  if (eventStore) {
    const snapshots = await eventStore.query({ type: 'context.snapshot' });
    const mine = snapshots.filter(
      (e) => (e.payload as Record<string, unknown>)?.taskRef === result.missionId
          || (e.payload as Record<string, unknown>)?.missionId === result.missionId,
    );
    console.log(`    context.snapshot 总数 = ${snapshots.length} ｜ 本任务 = ${mine.length}`);
    if (mine[0]) {
      const p = mine[0].payload as Record<string, unknown>;
      console.log('    快照关键字段:');
      console.log(`      taskRef=${p.taskRef} ｜ goal=${String(p.goal ?? '').slice(0, 50)}`);
      console.log(`      team=${JSON.stringify(p.team)} ｜ capabilitiesCount=${p.capabilitiesCount}`);
      console.log(`      score=${p.score} ｜ duration=${p.duration}ms ｜ result=${p.result}`);
      console.log(`      artifacts=${JSON.stringify(p.artifacts)}`);
    } else {
      console.log('    ⚠️ 本任务无快照（任务可能未完成/未触发抽离）');
    }
  } else {
    console.log('    ⚠️ eventStore 不可用');
  }

  // ── 3. 召回验证 ──
  console.log('\n【3】召回验证（ContextArchive.loadByTaskRef 按 taskRef 精确还原）');
  if (eventStore && result.missionId) {
    const archived = await loadByTaskRef(eventStore, result.missionId);
    if (archived) {
      console.log('    ✅ 按 taskRef 召回成功：');
      console.log(`      missionId=${archived.missionId} ｜ taskRef=${archived.taskRef}`);
      console.log(`      result=${archived.result} ｜ score=${archived.score} ｜ duration=${archived.duration}ms`);
      console.log(`      team.departments=${JSON.stringify(archived.team?.departments)} ｜ members=${archived.team?.members}`);
    } else {
      console.log('    ⚠️ 未召回到快照');
    }
  }

  // ── 4. 上下文片段 Provider 验证（6 真实 Provider 读真数据）──
  console.log('\n【4】聚焦装配 Provider 验证（6 真实 Provider 应返回 source=real）');
  try {
    const engine = (container as never as { _contextAssemblyEngine?: { getRegistry(): { getProvider(s: string): { collect(i: unknown): Promise<unknown> } | undefined } } })._contextAssemblyEngine;
    if (engine?.getRegistry) {
      const reg = engine.getRegistry();
      for (const src of ['goal_graph', 'mission_state', 'artifact_lineage', 'decision_history', 'user_profile', 'agent_status']) {
        const provider = reg.getProvider(src);
        if (!provider) { console.log(`    ${src}: ⚠️ 无 Provider`); continue; }
        try {
          const frag = await provider.collect({
            missionId: result.missionId ?? 'verify',
            goal: GOAL,
            currentTask: { missionId: result.missionId },
          } as never);
          const data = (frag as { data?: { source?: string } })?.data;
          console.log(`    ${src}: source=${data?.source ?? '?'} ｜ taskRef=${(frag as { taskRef?: string })?.taskRef ?? '?'}`);
        } catch (err) {
          console.log(`    ${src}: ⚠️ collect 失败 - ${(err as Error).message}`);
        }
      }
    } else {
      console.log('    ⚠️ engine 不可访问');
    }
  } catch (err) {
    console.log(`    ⚠️ Provider 验证跳过: ${(err as Error).message}`);
  }

  console.log('\n══════════════════════════════════════════');
  console.log('  验证结束');
  console.log('══════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\n❌ 验证失败:', err);
  process.exit(1);
});
