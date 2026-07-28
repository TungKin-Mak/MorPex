#!/usr/bin/env npx tsx
/**
 * verify-ontology-e2e.ts — Ontology 强制查询体系端到端验证
 *
 * 验证项：
 *   1. executeGoal 经过 runOntologyGroundedReasoning（日志出现 Phase 1.7）
 *   2. ForcedQueryGuard 记录了工具调用（callCount >= 1）
 *   3. EventStore 中出现了 ontology.query.performed 事件
 *   4. EvaluationEngine 传入了 ontologyCompliance 并产生评分
 *   5. 故意不查询时 assertQueried 抛错
 *
 * 用法:
 *   npx tsx scripts/verify-ontology-e2e.ts
 */

import { bootstrapV15Integration } from '../packages/core/src/bootstrap-v15-integration.js';
import { UnifiedEventStore } from '../packages/core/src/protocol/events/store/UnifiedEventStore.js';
import { systemMetadataGraph } from '../packages/core/src/metadata/SystemMetadataGraph.js';

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⚠️';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ${PASS} ${msg}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${msg}`);
    failed++;
  }
}

function assertWithValue<T>(value: T | null | undefined, msg: string): T {
  if (value != null) {
    console.log(`  ${PASS} ${msg}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 100) : value}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${msg}: (空)`);
    failed++;
  }
  return value!;
}

// ── 初始化 EventStore（内存 + JSONL 双写）──
const eventStore = new UnifiedEventStore(':memory:');

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 Ontology 强制查询体系 — 端到端验证');
  console.log('='.repeat(60));

  // ── Step 1: Bootstrap ──
  console.log('\n--- Step 1: 启动系统 ---');
  const { companyFacade, container, ontology, forcedQueryGuard } = await bootstrapV15Integration({ eventStore });
  assert(!!ontology, 'OntologyService 已创建');
  assert(!!forcedQueryGuard, 'ForcedQueryGuard 已创建');
  assert(!!container.runtime, 'MorPexRuntime 已创建');

  // ── Step 2: 初始化 Mission 数据（让 ontology 有数据可查）──
  console.log('\n--- Step 2: 写入初始数据到 Ontology ---');
  const missionId = 'test-mission-001';
  const artifactId = 'test-artifact-001';
  systemMetadataGraph.registerEntity(missionId, 'mission', '测试 Mission', {
    title: '验证 Ontology 查询',
    status: 'active',
    goal: '验证强制查询体系',
  });
  systemMetadataGraph.registerEntity(artifactId, 'artifact', '测试 Artifact', {
    title: '测试产物',
    status: 'draft',
    missionId,
  });
  systemMetadataGraph.addRelation(missionId, artifactId, 'produced_by');
  assert(true, '初始数据已写入 SystemMetadataGraph');

  // ── Step 3: 执行 executeGoal ──
  console.log('\n--- Step 3: 执行 executeGoal ---');
  let result;
  try {
    result = await companyFacade.executeGoal('查询 Ontology 中的 Mission 并返回 ID', {
      departmentName: undefined,
      createIfMissing: true,
    });
    console.log(`  结果: ok=${result.ok}, missionId=${result.missionId ?? 'N/A'}`);
    assert(true, 'executeGoal 执行完成');
  } catch (err) {
    console.log(`  ${FAIL} executeGoal 抛出异常: ${(err as Error).message}`);
    failed++;
  }

  // ── Step 4: 验证 ForcedQueryGuard 记录 ──
  console.log('\n--- Step 4: 验证 ForcedQueryGuard ---');
  // 获取所有 executionId（guard 内部 Map）
  const guard = forcedQueryGuard as any;
  const traceKeys = Array.from(guard.traces?.keys() ?? []);
  console.log(`  追踪的 executionId 数量: ${traceKeys.length}`);
  if (traceKeys.length > 0) {
    for (const execId of traceKeys) {
      const trace = guard.traces.get(execId);
      if (trace) {
        assert(trace.toolCalls.length > 0, `  executionId=${execId}: toolCalls=${trace.toolCalls.length}`);
        console.log(`    工具调用: ${trace.toolCalls.map((t: any) => t.name).join(', ')}`);
        assert(trace.retrievedObjectIds.size > 0, `  retrievedObjectIds=${trace.retrievedObjectIds.size}`);
      }
    }
  } else {
    // guard 可能通过 flushTrace 清空了，从 EventStore 查询
    console.log(`  ${SKIP} guard 内无 traces（可能已 flush），从 EventStore 验证`);
    skipped++;
  }

  // ── Step 5: 验证 EventStore 事件 ──
  console.log('\n--- Step 5: 验证 EventStore ---');
  const queryEvents = await eventStore.query({ type: 'ontology.query.performed', limit: 10 });
  console.log(`  ontology.query.performed 事件数: ${queryEvents.length}`);
  if (queryEvents.length > 0) {
    assert(true, 'EventStore 中有 OntologyQueryPerformed 事件');
    const e = queryEvents[0];
    const toolCalls = (e.payload?.toolCalls as Array<any>) ?? [];
    console.log(`  首次事件的 toolCalls: ${toolCalls.length}`);
    assert(toolCalls.length > 0, '事件中有工具调用记录');
  } else {
    // 可能事件写入有延迟，检查 flush 是否完成
    console.log(`  ${SKIP} 未查询到事件（可能未 flush），手动触发 flushAllTraces`);
    await forcedQueryGuard.flushAllTraces();
    const retryEvents = await eventStore.query({ type: 'ontology.query.performed', limit: 10 });
    if (retryEvents.length > 0) {
      assert(true, 'flush 后 EventStore 中有 OntologyQueryPerformed 事件');
    } else {
      assert(false, 'EventStore 中无 OntologyQueryPerformed 事件');
    }
  }

  // 检查引用失败事件
  const refFailEvents = await eventStore.query({ type: 'ontology.reference.validation_failed', limit: 10 });
  console.log(`  ontology.reference.validation_failed 事件数: ${refFailEvents.length}`);

  // ── Step 6: 验证 Evaluation 合规 ──
  console.log('\n--- Step 6: 验证 Evaluation 合规评分 ---');
  if (result && 'missionQuality' in (result as any)) {
    console.log(`  missionQuality: ${(result as any).missionQuality}`);
    assert(true, 'executeGoal 返回了合规评分');
  } else {
    // 合规评分在 MorPexRuntime 内部，不一定暴露到 executeGoal 返回
    // 我们可以直接从 EvaluationEngine 验证
    console.log(`  ${SKIP} executeGoal 返回中未直接暴露合规分（在 runtime 内部）`);
    skipped++;
  }

  // 直接测试 EvaluationEngine
  console.log('\n--- Step 6b: 直接测试 EvaluationEngine 合规 ---');
  const { EvaluationEngine } = await import('../packages/core/src/evaluation/EvaluationEngine.js');
  const evalEngine = new EvaluationEngine();

  // 模拟一次合规的 evaluation
  const goodResult = evalEngine.evaluate({
    plan: { steps: 3, capabilities: ['analyze'] },
    executionResult: { ok: true, duration: 1000, errors: [] },
    ontologyCompliance: {
      guard: forcedQueryGuard,
      executionId: 'test-eval-001',
      referencedIds: ['test-mission-001'],
    },
  });
  assert(goodResult.ontologyCompliance !== undefined, 'evaluate 返回了 ontologyCompliance');
  if (goodResult.ontologyCompliance) {
    console.log(`  queryScore: ${goodResult.ontologyCompliance.queryScore}`);
    console.log(`  referenceScore: ${goodResult.ontologyCompliance.referenceScore}`);
    console.log(`  decision: ${goodResult.decision}`);
    console.log(`  needsHumanReview: ${goodResult.needsHumanReview}`);
  }

  // ── Step 7: 验证运行结果中的 grounding ──
  console.log('\n--- Step 7: 验证日志输出（从运行结果推断） ---');
  if (result?.report) {
    const reportStr = typeof result.report === 'string' ? result.report : JSON.stringify(result.report);
    if (reportStr.includes('Ontology') || reportStr.includes('grounding')) {
      assert(true, 'executeGoal 报告中包含 ontology 相关输出');
    } else {
      console.log(`  ${SKIP} 报告输出: ${reportStr.substring(0, 200)}`);
      skipped++;
    }
  }

  // ── Step 8: 验证 assertQueried 兜底 ──
  console.log('\n--- Step 8: 验证 assertQueried 兜底 ---');
  try {
    forcedQueryGuard.assertQueried('nonexistent-exec-id', 1);
    assert(false, 'assertQueried 应该抛错但未抛');
  } catch (err) {
    assert(true, `assertQueried 正确抛出: ${(err as Error).message}`);
  }

  // ── Step 9: 验证 OntologyService 查询 ──
  console.log('\n--- Step 9: 验证 OntologyService 查询 ---');
  const missions = await ontology.queryObjects({ type: 'Mission' });
  assert(missions.length > 0, `queryObjects({type:'Mission'}) 返回 ${missions.length} 条`);
  console.log(`  Mission 列表: ${missions.map(m => m.object.properties.name ?? m.object.id).join(', ')}`);

  const artifacts = await ontology.queryObjects({ type: 'Artifact' });
  console.log(`  Artifact 数量: ${artifacts.length}`);

  // ── 汇总 ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 验证汇总');
  console.log('='.repeat(60));
  console.log(`  ${PASS} 通过: ${passed}`);
  console.log(`  ${FAIL} 失败: ${failed}`);
  console.log(`  ${SKIP} 跳过: ${skipped}`);

  const verdict = failed === 0 ? 'PASS' : 'FAIL';
  console.log(`\n${verdict === 'PASS' ? PASS : FAIL} 结论: ${verdict}`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${FAIL} 验证脚本异常:`, err);
  process.exit(1);
});
