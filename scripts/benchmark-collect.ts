/**
 * 性能基准采集脚本 — 首次运行
 * 运行: npx tsx scripts/benchmark-collect.ts
 */
import { ServiceContainer } from '../packages/core/src/runtime/ServiceContainer.js';

interface BenchmarkSample {
  id: string;
  goal: string;
  ok: boolean;
  duration: number;
  artifacts: number;
  errors: string[];
  phase: string;
}

async function main() {
  console.log('📊 MorPex 性能基准采集 (首次)\n');

  const container = new ServiceContainer();
  await container.missionStore.init();
  await container.artifactStore.init();

  const samples: BenchmarkSample[] = [];
  const goals = [
    { id: 'sw-001', goal: '开发一个 Todo 管理 SaaS 应用' },
    { id: 'hw-001', goal: '设计一个智能温控器' },
    { id: 'ec-001', goal: '将硬件产品上架到 Amazon US 站点' },
    { id: 'bz-001', goal: '分析智能家居市场趋势和竞争格局' },
    { id: 'ct-001', goal: '规划一个科技评测 YouTube 频道' },
  ];

  console.log('任务ID          | 耗时(ms) | 产物 | 状态 | 阶段');
  console.log('-' .repeat(65));

  for (const g of goals) {
    const start = Date.now();
    const result = await container.runtime.run(g.goal);
    const duration = Date.now() - start;

    const sample: BenchmarkSample = {
      ...g,
      ok: result.ok,
      duration,
      artifacts: result.artifacts.length,
      errors: result.errors,
      phase: result.context?.mission?.phase || 'unknown',
    };
    samples.push(sample);

    const icon = result.ok ? '✅' : '❌';
    console.log(`${g.id.padEnd(15)} | ${String(duration).padEnd(7)} | ${result.artifacts.length}    | ${icon}   | ${sample.phase}`);
  }

  // 汇总
  const total = samples.length;
  const passed = samples.filter(s => s.ok).length;
  const avgDuration = Math.round(samples.reduce((s, r) => s + r.duration, 0) / total);

  console.log('\n' + '='.repeat(55));
  console.log('📈 基准汇总');
  console.log('='.repeat(55));
  console.log(`  总任务:     ${total}`);
  console.log(`  通过:       ${passed}/${total}`);
  console.log(`  平均耗时:   ${avgDuration}ms`);
  console.log(`  最快:       ${Math.min(...samples.map(s => s.duration))}ms`);
  console.log(`  最慢:       ${Math.max(...samples.map(s => s.duration))}ms`);
  console.log(`  Artifact:   ${samples.reduce((s, r) => s + r.artifacts, 0)} 个`);
  console.log(`  总耗时:     ${samples.reduce((s, r) => s + r.duration, 0)}ms`);

  console.log('\n✅ 基准采集完成。');
  console.log('  数据已就绪，可填入 docs/performance-checklist.md 的基准表。');
}

main().catch(console.error);
