/**
 * Golden Benchmark — 真实 LLM 模式
 * 运行: npx tsx scripts/golden-benchmark-real.ts
 * 使用 PiBridge 真实 LLM 调用，非 Mock
 */
import { ServiceContainer } from '../packages/core/src/runtime/ServiceContainer.js';
import { GOLDEN_TASKS } from '../packages/core/src/benchmark/golden-tasks.js';

async function main() {
  console.log('🏋️ Golden Benchmark — 真实 LLM 模式\n');
  console.log(`任务总数: ${GOLDEN_TASKS.length}`);
  console.log(`执行模式: PiBridge (deepseek/deepseek-v4-flash)\n`);

  // 只跑前 10 个任务（首次运行限制）
  const tasks = GOLDEN_TASKS.slice(0, 10);

  const container = new ServiceContainer();
  await container.missionStore.init();
  await container.artifactStore.init();

  console.log('任务ID          | 耗时(ms) | 状态 | 类别');
  console.log('-' .repeat(50));

  const results: Array<{ id: string; duration: number; ok: boolean; category: string }> = [];
  const startAll = Date.now();

  for (const task of tasks) {
    const start = Date.now();
    const icon = results.length < 5 ? '▶' : ' ';  // first 5 show spinner
    process.stdout.write(`${task.id.padEnd(15)} | ${icon}     |      | ${task.category}\r`);

    try {
      const result = await container.runtime.run(task.goal);
      const duration = Date.now() - start;
      results.push({ id: task.id, duration, ok: result.ok, category: task.category });
      const mark = result.ok ? '✅' : '❌';
      console.log(`${task.id.padEnd(15)} | ${String(duration).padEnd(7)} | ${mark}   | ${task.category}`);
    } catch (err) {
      results.push({ id: task.id, duration: Date.now() - start, ok: false, category: task.category });
      console.log(`${task.id.padEnd(15)} | ${String(Date.now() - start).padEnd(7)} | ❌   | ${task.category}`);
    }
  }

  const totalDuration = Math.round((Date.now() - startAll) / 1000);
  const passed = results.filter(r => r.ok).length;

  console.log('\n' + '='.repeat(50));
  console.log('📊 基准结果（真实 LLM）');
  console.log('='.repeat(50));
  console.log(`  任务:     ${results.length}`);
  console.log(`  通过:     ${passed}/${results.length}`);
  console.log(`  总耗时:   ${totalDuration}s`);
  if (results.length > 0) {
    const avg = results.reduce((s, r) => s + r.duration, 0) / results.length;
    console.log(`  平均:     ${Math.round(avg)}ms`);
  }
  console.log(`  模型:     deepseek/deepseek-v4-flash`);

  // 更新 performance-checklist
  const avgMs = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.duration, 0) / results.length) : 0;

  console.log('\n✅ 基准采集完成');
  console.log(`\n建议更新 docs/performance-checklist.md 的基准表:`);
  console.log(`| 平均执行时间 | ${avgMs}ms (Mock: 8ms) | <30s |`);
  console.log(`| 通过率 (${results.length}任务) | ${passed}/${results.length} | >95% |`);
}

main().catch(e => console.error('FATAL:', e));
