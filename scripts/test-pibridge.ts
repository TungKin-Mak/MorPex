/**
 * PiBridge 连接测试
 * 运行: npx tsx scripts/test-pibridge.ts
 */
async function main() {
  console.log('🔌 PiBridge 连接测试\n');

  // 1. 加载
  console.log('1. 加载 PiBridge...');
  const { PiBridge } = await import('../packages/core/src/adapters/pi-bridge/PiBridge.js');
  console.log('   ✅ 加载成功\n');

  // 2. 初始化
  console.log('2. 初始化 PiBridge (deepseek/deepseek-v4-flash)...');
  const bridge = new PiBridge('deepseek/deepseek-v4-flash');
  await bridge.init();
  console.log('   ✅ 初始化成功\n');

  // 3. 简单调用
  console.log('3. 测试 LLM 调用...');
  const start = Date.now();
  const result = await bridge.generateText({ prompt: '用一句话回答: 1+1等于几?', maxTokens: 50, temperature: 0.1 });
  const duration = Date.now() - start;
  console.log(`   ✅ 调用成功 (${duration}ms)`);
  console.log(`   响应: ${result.text?.substring(0, 200)}`);

  // 4. 性能采样
  console.log('\n4. 性能采样 (5 次调用)...');
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    await bridge.generateText({ prompt: '回复一个词: ok', maxTokens: 10, temperature: 0.1 });
    times.push(Date.now() - t);
    process.stdout.write('.');
  }
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  console.log(`\n   平均: ${Math.round(avg)}ms, 最快: ${Math.min(...times)}ms, 最慢: ${Math.max(...times)}ms`);

  console.log('\n✅ PiBridge 测试完成');
  console.log(`   模型: deepseek/deepseek-v4-flash`);
  console.log(`   平均延迟: ${Math.round(avg)}ms`);
}

main().catch(e => console.error('❌ 失败:', e instanceof Error ? e.message : e));
