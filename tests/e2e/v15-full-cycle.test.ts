/**
 * v15 端到端闭环测试
 * Stabilization: 追踪 "输入目标→动态组队→调用工作流→执行→验证→交付→学习" 完整链路
 *
 * 运行: npx tsx tests/e2e/v15-full-cycle.test.ts
 */

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  v15 端到端闭环测试                              ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const { ServiceContainer } = await import('../../packages/core/src/runtime/ServiceContainer.js');
  const container = new ServiceContainer();
  await container.missionStore.init();
  await container.artifactStore.init();

  const goal = '设计智能空气检测设备并销售到 Amazon';
  console.log(`🎯 目标: "${goal}"\n`);

  interface StepResult { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; duration: number; detail?: string }
  const steps: StepResult[] = [];
  let allPassed = true;

  // Step 1: Goal Understanding
  let t = Date.now();
  try {
    const { GoalIntelligenceFacade } = await import('../../packages/core/src/goal-intelligence/GoalIntelligenceFacade.js');
    const ctx = await GoalIntelligenceFacade.understandGoal(goal);
    steps.push({ name: 'GoalUnderstanding', status: 'PASS', duration: Date.now() - t, detail: `domain=${ctx.domain}, caps=${ctx.requiredCapabilities.length}` });
    console.log(`  ✅ GoalUnderstanding: domain=${ctx.domain}, ${ctx.requiredCapabilities.length} 项能力`);
  } catch (e) {
    steps.push({ name: 'GoalUnderstanding', status: 'FAIL', duration: Date.now() - t, detail: (e as Error).message });
    allPassed = false;
  }

  // Step 2: Pipeline (Mission→Team→Workflow)
  t = Date.now();
  try {
    const pipeline = container.runtime['pipeline'];
    const result = await pipeline.orchestrate(goal);
    steps.push({ name: 'PipelineOrchestration', status: 'PASS', duration: Date.now() - t, detail: `mission=${result.context.mission.missionId}, team=${result.context.team.name}` });
    console.log(`  ✅ Pipeline: mission=${result.context.mission.missionId}, team=${result.context.team.name}`);
  } catch (e) {
    steps.push({ name: 'PipelineOrchestration', status: 'FAIL', duration: Date.now() - t, detail: (e as Error).message });
    allPassed = false;
  }

  // Step 3: Full Runtime Execution
  t = Date.now();
  try {
    const result = await container.runtime.run(goal);
    steps.push({ name: 'FullExecution', status: result.ok ? 'PASS' : 'FAIL', duration: Date.now() - t, detail: `ok=${result.ok}, artifacts=${result.artifacts.length}` });
    if (result.ok) console.log(`  ✅ FullExecution: ${result.artifacts.length} artifacts`);
    else { console.log(`  ❌ FullExecution: ${result.errors.join(';')}`); allPassed = false; }
  } catch (e) {
    steps.push({ name: 'FullExecution', status: 'FAIL', duration: Date.now() - t, detail: (e as Error).message });
    allPassed = false;
  }

  // Step 4: Mission Persistence
  t = Date.now();
  try {
    const count = container.missionStore.getAll().length;
    steps.push({ name: 'MissionPersistence', status: count > 0 ? 'PASS' : 'FAIL', duration: Date.now() - t, detail: `${count} missions` });
    console.log(`  ✅ MissionPersistence: ${count} missions`);
  } catch (e) {
    steps.push({ name: 'MissionPersistence', status: 'FAIL', duration: Date.now() - t, detail: (e as Error).message });
    allPassed = false;
  }

  // Step 5: Mission Recovery
  t = Date.now();
  try {
    const missions = container.missionStore.getAll();
    if (missions.length > 0) {
      const recovery = container.missionController.recover(missions[0].missionId);
      steps.push({ name: 'MissionRecovery', status: 'PASS', duration: Date.now() - t, detail: `recovered=${recovery.recovered}, recommended=${recovery.recommended}` });
      console.log(`  ✅ MissionRecovery: ${recovery.recovered ? '可恢复' : '需人工'}, 建议=${recovery.recommended}`);
    } else {
      steps.push({ name: 'MissionRecovery', status: 'SKIP', duration: 0, detail: '无 Mission' });
    }
  } catch (e) {
    steps.push({ name: 'MissionRecovery', status: 'FAIL', duration: Date.now() - t, detail: (e as Error).message });
  }

  // Report
  console.log('\n' + '═'.repeat(50));
  console.log('📊 测试报告');
  console.log('═'.repeat(50));
  console.log(`  目标: "${goal}"`);
  const total = steps.length;
  const passed = steps.filter(s => s.status === 'PASS').length;
  const failed = steps.filter(s => s.status === 'FAIL').length;
  for (const s of steps) {
    const icon = s.status === 'PASS' ? '✅' : s.status === 'SKIP' ? '⏭️' : '❌';
    console.log(`  ${icon} ${s.name} (${s.duration}ms)`);
    if (s.detail) console.log(`     ${s.detail}`);
  }
  console.log(`\n  结果: ${passed}/${total} 通过, ${failed} 失败`);
  console.log(`  整体: ${allPassed ? '✅ 通过' : '❌ 失败'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
