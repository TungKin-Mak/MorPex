/**
 * Golden Benchmark 首次运行
 * 运行: npx tsx scripts/golden-benchmark-run.ts
 */
import { BenchmarkRunner } from '../packages/core/src/benchmark/runner.js';
import { ServiceContainer } from '../packages/core/src/runtime/ServiceContainer.js';

async function main() {
  const container = new ServiceContainer();
  await container.missionStore.init();
  await container.artifactStore.init();

  console.log('🏋️ Golden Benchmark 首次运行 (Mock 模式)\n');
  console.log('任务ID          | 状态   | 耗时(ms) | 产物 | 类别');
  console.log('-' .repeat(65));

  const runner = new BenchmarkRunner();
  const { summary, results } = await runner.runAll(async (task) => {
    const start = Date.now();
    const result = await container.runtime.run(task.goal);
    const duration = Date.now() - start;
    const icon = result.ok ? '✅' : '❌';
    console.log(`${task.id.padEnd(15)} | ${icon}   | ${String(duration).padEnd(7)} | ${result.artifacts.length}    | ${task.category}`);
    return {
      task,
      passed: result.ok,
      duration,
      coverage: { capabilities: task.expectedCapabilities.length, artifacts: result.artifacts.length },
    };
  });

  // 按类别汇总
  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const cat = r.task.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0 };
    byCategory[cat].total++;
    if (r.passed) byCategory[cat].passed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 基准汇总');
  console.log('='.repeat(50));
  console.log(`  总任务:   ${summary.total}`);
  console.log(`  通过:     ${summary.passed}/${summary.total}`);
  console.log(`  失败:     ${summary.failed}`);
  console.log(`  平均耗时: ${Math.round(summary.avgDuration)}ms`);
  console.log('');
  console.log('  按类别:');
  for (const [cat, stat] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(12)} ${stat.passed}/${stat.total} 通过`);
  }

  console.log('\n✅ Golden Benchmark 首次运行完成。');
  console.log(`   全部结果保存在 results (${results.length} 条).`);
  console.log('\n⚠️ 当前为 Mock 模式 (ExecutionFabric 模拟).');
  console.log('   接入真实 LLM 后重新运行获取生产基线:');
  console.log('   npx tsx scripts/golden-benchmark-run.ts');
}

main().catch(console.error);
