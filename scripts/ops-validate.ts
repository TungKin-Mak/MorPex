#!/usr/bin/env npx tsx
/**
 * ops-validate.ts — 运营验证：真实目标跑完整链路，观测四类信号
 *
 * 用法:
 *   npx tsx scripts/ops-validate.ts "你的目标"      # 执行一个真实目标并出报告
 *   npx tsx scripts/ops-validate.ts                 # 使用默认目标
 *
 * 观测信号（对应评估关注点）:
 *   1. QueryMiss 率    = ontology.query.miss / ontology.query.performed
 *   2. 评分区分度      = evaluation.scored 的 qualityScore 分布（有无 low_score）
 *   3. 人类审批频率    = approval.required / approval_granted 事件数
 *   4. 成本曲线        = executionEngine.getExecutionCost + 执行耗时
 *
  * 依赖：GLM_API_KEY（.env）——真实 LLM 执行（仅 GLM-4.7-Flash）。
 */

import { bootstrapUnified } from '../packages/core/src/bootstrap-unified.js';

function count(hist: unknown[], type: string): number {
  return hist.filter((e) => (e as { type?: string }).type === type).length;
}

async function main() {
  const goal = process.argv[2] ?? '为一个电商网站生成一份商品库存管理方案的要点清单';
  console.log(`\n🎯 运营验证目标: ${goal}\n`);

  console.log('[1/3] 启动系统（bootstrapUnified）...');
  const { companyFacade, container } = await bootstrapUnified();
  const eventBus = container.eventBus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executionEngine = container.executionEngine as any;

  // 执行前基线（过滤历史残留）
  const base = (t: string) => count(eventBus.getHistory(t), t);
  const before = {
    miss: base('ontology.query.miss'),
    refFail: base('ontology.reference.validation_failed'),
    scored: base('evaluation.scored'),
    low: base('evaluation.low_score'),
    approvalReq: base('approval.required'),
    approvalGranted: base('approval_granted'),
  };

  console.log('[2/3] 执行真实目标（L1 授权 → L4 规划 → L5 执行 → L6 评价 → L7 演化事件）...');
  const t0 = Date.now();
  let result: { ok: boolean; missionId?: string; executionId?: string; error?: string };
  try {
    result = (await companyFacade.executeGoal(goal)) as typeof result;
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
  }
  const durationMs = Date.now() - t0;

  console.log('[3/3] 采集信号...');
  const after = {
    miss: base('ontology.query.miss'),
    refFail: base('ontology.reference.validation_failed'),
    scored: base('evaluation.scored'),
    low: base('evaluation.low_score'),
    approvalReq: base('approval.required'),
    approvalGranted: base('approval_granted'),
  };

  // 评分区分度：收集本次 evaluation.scored 的 qualityScore
  const scoredEvents = eventBus.getHistory('evaluation.scored') as Array<{ payload?: { qualityScore?: number; decision?: string } }>;
  const scores = scoredEvents.slice(scoredEvents.length - Math.max(0, after.scored - before.scored) - 3).map((e) => e.payload?.qualityScore).filter((s): s is number => typeof s === 'number').slice(-5);

  // 成本
  let cost = 0;
  try {
    if (result.executionId && executionEngine?.getExecutionCost) cost = executionEngine.getExecutionCost(result.executionId);
  } catch { /* cost 不可得则不报 */ }

  // ── 报告 ──
  const missDelta = Math.max(0, after.miss - before.miss);
  const refFailDelta = Math.max(0, after.refFail - before.refFail);
  console.log('\n' + '═'.repeat(62));
  console.log('📊 运营验证报告');
  console.log('═'.repeat(62));
  console.log(`🎯 目标: ${goal.slice(0, 60)}`);
  console.log(`✅ 执行结果: ${result.ok ? '成功' : '失败'}${result.error ? ` (${result.error.slice(0, 80)})` : ''}`);
  console.log(`⏱ 耗时: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`\n── ① QueryMiss 率 ──`);
  console.log(`   查询缺失(query.miss): ${missDelta} 次`);
  console.log(`   引用校验失败(reference.validation_failed): ${refFailDelta} 次`);
  console.log(`   本次执行知识缺口: ${missDelta + refFailDelta} 处（0 = 全部命中/引用有效）`);
  console.log(`\n── ② 评分区分度 ──`);
  console.log(`   evaluation.scored: +${after.scored - before.scored} 次`);
  console.log(`   evaluation.low_score: +${after.low - before.low} 次（<0.6 低分）`);
  console.log(`   最近 qualityScore: [${scores.join(', ')}]`);
  console.log(`\n── ③ 人类审批频率 ──`);
  console.log(`   approval.required: +${after.approvalReq - before.approvalReq} 次`);
  console.log(`   approval_granted: +${after.approvalGranted - before.approvalGranted} 次`);
  console.log(`\n── ④ 成本 ──`);
  console.log(`   本次执行成本(估算 tokens): ${cost}（注：成本为估算值，真实 token 计费未接入）`);
  console.log(`   missionId: ${result.missionId ?? 'N/A'}`);
  console.log('═'.repeat(62) + '\n');

  // 强制链完整性自检
  console.log('── 强制链完整性（本会话观测） ──');
  const evolutionActive = base('evolution.active_triggered');
  const proposalPending = base('evolution.proposal.pending_approval');
  console.log(`   evolution.active_triggered: ${evolutionActive}（事件驱动）`);
  console.log(`   evolution.proposal.pending_approval: ${proposalPending}（提案待审批=pending）`);
  console.log(`   注：晋升必须经 EvolutionSandbox.approveAndApply(Gate 凭证) —— 由 gate-context-runtime 测试保障\n`);
}

main().catch((e) => {
  console.error('❌ 运营验证失败:', (e as Error).message);
  process.exit(1);
});
