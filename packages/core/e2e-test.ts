/**
 * MorPexCore — 全链路端到端测试
 *
 * 完整路径：user.input → Intent Plugin → LLM Bridge → DeepSeek API
 *
 * 运行：
 *   npx tsx src/morpex-core/e2e-test.ts
 */

import { MorPexKernel } from './src/common/Kernel.js';
import { IntentPlugin } from './src/planes/control-plane/intent/plugin.js';
import type { IntentResult } from './src/planes/control-plane/intent/types.js';

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  全链路端到端测试');
  console.log('  user.input → Intent Plugin → LLM → DeepSeek');
  console.log('═══════════════════════════════════════════════\n');

  // 1. 创建 Kernel + 启动 Mirror
  const kernel = new MorPexKernel({ mirrorBasePath: './data/mirror' });
  await kernel.start();
  console.log('[OK] Kernel 已启动');

  // 2. 注册 Intent Plugin
  const intentPlugin = new IntentPlugin();
  await intentPlugin.initialize({
    eventBus: kernel.eventBus,
    executionIdentity: kernel.executionIdentity,
    config: {
      callLLM: undefined, // 让插件走默认的 EventBus 桥接
      intent: {
        directThreshold: 0.85,
        clarifyThreshold: 0.6,
      },
    },
  });
  await intentPlugin.start();
  console.log('[OK] Intent Plugin 已启动\n');

  // 4. 发送一条用户输入，走完整 Intent 链路
  const testInput = '帮我写一个 Python 脚本，读取 CSV 文件并生成统计报告';
  console.log(`📤 用户输入: "${testInput}"\n`);

  // 在 EventBus 上等待 Intent Plugin 的输出
  const result = await new Promise<{ type: string; payload: any }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('全链路测试超时 (60s)')), 60_000);

    // 监听 intent.resolved — 意图明确
    kernel.eventBus.once('intent.resolved', (event) => {
      clearTimeout(timeout);
      resolve({ type: 'intent.resolved', payload: event.payload });
    });

    // 监听 intent.needs_clarification — 需要澄清
    kernel.eventBus.once('intent.needs_clarification', (event) => {
      clearTimeout(timeout);
      resolve({ type: 'intent.needs_clarification', payload: event.payload });
    });

    // 监听 intent.rejected — 无法理解
    kernel.eventBus.once('intent.rejected', (event) => {
      clearTimeout(timeout);
      resolve({ type: 'intent.rejected', payload: event.payload });
    });

    // 发射用户输入 → Intent Plugin 会处理它
    kernel.eventBus.emit({
      id: kernel.executionIdentity.createEventId(),
      type: 'intent.input',
      timestamp: Date.now(),
      executionId: kernel.executionIdentity.createExecutionId(),
      source: 'e2e-test',
      payload: { input: testInput },
    });

    console.log('⏳ 等待 LLM 响应...\n');
  });

  // 5. 输出结果
  console.log(`\n📥 结果类型: ${result.type}`);
  const intent = result.payload?.intent ?? result.payload?.partialIntent ?? result.payload;

  if (result.type === 'intent.resolved') {
    console.log(`\n📋 意图解析结果:`);
    console.log(`  类型:       ${intent.type}`);
    console.log(`  置信度:     ${(intent.confidence * 100).toFixed(1)}%`);
    console.log(`  领域:       ${intent.domain}`);
    console.log(`  目标:       ${intent.goal}`);
    console.log(`  耗时:       ${result.payload.processingTime}ms`);
  } else if (result.type === 'intent.needs_clarification') {
    console.log(`\n📋 需要澄清:`);
    console.log(`  会话 ID:    ${result.payload.sessionId}`);
    console.log(`  问题数:     ${result.payload.questions?.length}`);
    for (const q of (result.payload.questions ?? [])) {
      console.log(`   - ${q.question}`);
    }
  } else {
    console.log(`\n📋 被拒绝:`);
    console.log(`  原因:       ${result.payload.reason}`);
  }

  // 6. Mirror 统计
  const stats = kernel.mirror.getStats();
  console.log(`\n📊 Mirror 统计:`);
  console.log(`  事件:       ${stats.totalEvents}`);
  console.log(`  执行轨迹:   ${stats.totalExecutions}`);
  console.log(`  存储:       ${stats.storageSizeBytes} bytes`);

  // 7. 查看 Mirror 原始记录
  if (stats.totalEvents > 0) {
    console.log(`\n📁 原始事件记录 (cat data/mirror/events.jsonl):`);
    const fs = await import('node:fs');
    const lines = fs.readFileSync('./data/mirror/events.jsonl', 'utf-8').trim().split('\n');
    for (const line of lines.slice(-5)) {
      try {
        const evt = JSON.parse(line);
        console.log(`  [${evt.type}] ${JSON.stringify(evt.payload).substring(0, 120)}`);
      } catch {}
    }
  }

  // 8. 清理
  await intentPlugin.stop();
  await kernel.stop();

  // 清理 Mirror 测试数据
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.rmSync('./data/mirror', { recursive: true, force: true });

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  ✅ 全链路测试完成`);
  console.log(`═══════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(`\n❌ 全链路测试失败:`, err.message);
  // 清理
  try {
    const fs = require('node:fs');
    fs.rmSync('./data/mirror', { recursive: true, force: true });
  } catch {}
  process.exit(1);
});
